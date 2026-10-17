// EHLİYET: veri katmanı. İki mod:
//   live → arka uç (src/server.ts) /api/* uçlarını sunuyorsa
//   mock → arka uç yoksa ya da URL'de ?mock=1 varsa (sahte veri)
// Arayüzün geri kalanı hangi modda olduğunu bilmez; entegrasyon için kod değişmez.
import * as M from "./mock/mock.js";

const params = new URLSearchParams(location.search);
let mode = null;
const mockRuns = new Map(); // mock modda başlatılan sınavların sonuçları
const mockEvents = new Map(); // mock modda sınavların olay geçmişi

export async function init() {
  if (params.has("mock")) return (mode = "mock");
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (typeof j?.ok === "boolean") return (mode = "live");
    }
  } catch {
    /* arka uç yok → sahte veri */
  }
  return (mode = "mock");
}

export const getMode = () => mode;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new ApiError(r.status, (await safeJson(r))?.error ?? `${path} → ${r.status}`);
  return r.json();
}

async function safeJson(r) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}

export async function getHealth() {
  if (mode === "mock") return M.HEALTH;
  return getJson("/api/health");
}

export async function getAgents() {
  if (mode === "mock") return M.AGENTS;
  return getJson("/api/agents");
}

export async function getScenarios() {
  if (mode === "mock") return M.SCENARIOS;
  return getJson("/api/scenarios");
}

export async function getRuns() {
  if (mode === "mock") {
    const finished = [...mockRuns.values()].filter((r) => r.runId).reverse();
    return [...finished, ...M.SHOWCASE].map(toSummary);
  }
  return getJson("/api/runs");
}

export async function getRun(runId) {
  if (mode === "mock") {
    const r = mockRuns.get(runId) ?? M.SHOWCASE.find((s) => s.runId === runId);
    if (!r) throw new ApiError(404, "Sınav bulunamadı");
    return r;
  }
  return getJson(`/api/runs/${encodeURIComponent(runId)}`);
}

// Bitmiş bir sınavın olay geçmişi (ayrıntılı kayıt). Bulunamazsa null.
// Canlı modda sunucu, bellekteki olayları SSE ile baştan gönderir ve run_finished'tan sonra akışı kapatır.
export async function getRunEvents(runId) {
  if (mode === "mock") {
    if (mockEvents.has(runId)) return mockEvents.get(runId);
    const r = M.SHOWCASE.find((s) => s.runId === runId);
    if (!r) return null;
    const events = M.buildEvents(r.agent.id, runId, r.scenarios.map((s) => s.id), r.agent.model);
    events[events.length - 1] = { ...events[events.length - 1], result: r };
    mockEvents.set(runId, events);
    return events;
  }
  return new Promise((resolve) => {
    const events = [];
    let done = false;
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      es.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 3000);
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        events.push(ev);
        if (ev.type === "run_finished") finish(events);
      } catch {
        /* bozuk satırı atla */
      }
    };
    es.onerror = () => finish(null);
  });
}

// body: StartRunRequest { agentId, model?, scenarioIds? }
export async function startRun(body, pin) {
  if (mode === "mock") {
    const runId = "mock-" + Math.random().toString(36).slice(2, 10);
    mockRuns.set(runId, { __pending: true, body });
    return { runId };
  }
  const r = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-pin": pin },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new ApiError(401, "PIN yanlış.");
  if (r.status === 409) throw new ApiError(409, "Şu an başka bir sınav sürüyor. Birazdan tekrar dene.");
  if (!r.ok) throw new ApiError(r.status, (await safeJson(r))?.error ?? "Sınav başlatılamadı.");
  return r.json();
}

// Olayları dinler. Dönen fonksiyon dinlemeyi durdurur.
export function subscribe(runId, onEvent, onConnectionError) {
  if (mode === "mock") return mockReplay(runId, onEvent);

  const seen = new Set();
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  es.onmessage = (msg) => {
    let ev;
    try {
      ev = JSON.parse(msg.data);
    } catch {
      return;
    }
    const key = [ev.type, ev.scenarioId, ev.callId, ev.checkId, ev.at].join("|");
    if (seen.has(key)) return; // yeniden bağlanınca tekrar gelen olaylar
    seen.add(key);
    onEvent(ev);
    if (ev.type === "run_finished") es.close();
  };
  es.onerror = () => onConnectionError?.();
  return () => es.close();
}

const DELAYS = {
  run_started: 300,
  scenario_started: 900,
  setup: 900,
  user_message: 1300,
  agent_message: 1500,
  tool_call: 650,
  tool_result: 750,
  crash: 1800,
  check_result: 450,
  scenario_finished: 900,
  cleanup: 700,
  run_finished: 600,
};

function mockReplay(runId, onEvent) {
  const pending = mockRuns.get(runId);
  const { agentId, scenarioIds, model } = pending?.body ?? { agentId: "acemi" };
  const events = M.buildEvents(agentId, runId, scenarioIds, model);
  mockEvents.set(runId, events);
  const speed = Number(params.get("speed")) || 1;
  let i = 0;
  let timer = null;
  let stopped = false;
  const next = () => {
    if (stopped || i >= events.length) return;
    const ev = events[i++];
    if (ev.type === "run_finished") mockRuns.set(runId, ev.result);
    onEvent(ev);
    timer = setTimeout(next, (DELAYS[ev.type] ?? 600) / speed);
  };
  timer = setTimeout(next, 200);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function toSummary(r) {
  return {
    runId: r.runId,
    agentName: r.agent.name,
    model: r.agent.model,
    score: r.score,
    total: r.total,
    licenseClass: r.licenseClass,
    finishedAt: r.finishedAt,
    showcase: !!r.showcase,
  };
}
