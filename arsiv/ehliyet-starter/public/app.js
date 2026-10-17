// Ehliyet: arayüz. Veriler api.js'ten gelir (canlı sunucu ya da önizleme verisi).
// Bu dosya sayfaları çizer, adres çubuğundaki #/... yolunu izler ve canlı sınav olaylarını ekrana işler.
import * as api from "/api.js";

// ───────────── Yardımcılar ─────────────
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const enc = encodeURIComponent;
const pad2 = (n) => String(n).padStart(2, "0");
const fmtUsd = (n) => `${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} USD`;
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtShort = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};
const fmtSec = (ms) => `${(ms / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn`;
const fmtDur = (ms) => {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 60000) return fmtSec(ms);
  return `${Math.floor(ms / 60000)} dk ${Math.round((ms % 60000) / 1000)} sn`;
};

// ───────────── Simgeler ─────────────
const svg = (body, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const I = {
  passed: svg('<circle cx="8" cy="8" r="7" fill="#1a7f37"/><path d="M5 8.2 7.1 10.3 11 6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  failed: svg('<circle cx="8" cy="8" r="7" fill="#cf2235"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>'),
  running: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="#c9d7fb" stroke-width="2"/><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#1f4fd1" stroke-width="2" stroke-linecap="round"/>', "ic-spin"),
  idle: svg('<circle cx="8" cy="8" r="6.25" fill="none" stroke="#848d9e" stroke-width="1.5" stroke-dasharray="2.6 2.2"/>'),
  partial: svg('<circle cx="8" cy="8" r="6.25" fill="none" stroke="#848d9e" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="#848d9e"/>'),
  warn: svg('<circle cx="8" cy="8" r="7" fill="#9a6700"/><path d="M8 4.6v4.1" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".9" fill="#fff"/>'),
  alert: svg('<path d="M8 1.6 15 14.2H1L8 1.6Z" fill="currentColor"/><path d="M8 6.2v3.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.8" r=".85" fill="#fff"/>'),
  chev: svg('<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>', "chev"),
  check: svg('<path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  x: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" fill="none" stroke="currentColor" stroke-width="1.4"/>'),
  download: svg('<path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  back: svg('<path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
};
const BRAND_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1f4fd1"/><rect x="7" y="10" width="18" height="13" rx="2" fill="none" stroke="#fff" stroke-width="2"/><rect x="10" y="13" width="5" height="7" rx="1" fill="#e03444"/></svg>`;

const STATUS_TEXT = { idle: "Sırada", running: "Sürüyor", passed: "Geçti", failed: "Kaldı" };
const TRAP_TEXT = { poisoned_news: "zehirli haber", fake_error: "sahte hata", silent_fail: "sessiz başarısızlık" };

// ───────────── Durum ─────────────
const state = {
  agents: [],
  scenarios: [],
  runs: [],
  views: new Map(), // runId → sınav görünümü (canlı ya da yüklenmiş)
  liveRunId: null,
  route: null,
  routeSeq: 0,
  follow: true,
};

const scenarioById = (id) => state.scenarios.find((s) => s.id === id);
const scenarioNo = (id) => pad2(state.scenarios.findIndex((s) => s.id === id) + 1);
const isMock = () => api.getMode() === "mock";

// ───────────── Açılış ─────────────
async function boot() {
  const mode = await api.init();
  $("previewBar").hidden = mode !== "mock";
  const [health, agents, scenarios, runs] = await Promise.all([
    api.getHealth().catch(() => null),
    api.getAgents().catch(() => []),
    api.getScenarios().catch(() => []),
    api.getRuns().catch(() => []),
  ]);
  state.agents = agents;
  state.scenarios = scenarios;
  state.runs = runs;
  renderEnv(health);
  if (mode === "live") setInterval(async () => renderEnv(await api.getHealth().catch(() => null)), 30000);

  const legacy = new URLSearchParams(location.search).get("run");
  if (legacy && !location.hash) location.replace(`#/sinav/${enc(legacy)}`);

  window.addEventListener("hashchange", route);
  setInterval(tickClock, 1000);
  route();
}

function renderEnv(h) {
  const el = $("envStatus");
  const text = el.querySelector(".env-text");
  el.className = "env";
  if (isMock()) {
    el.classList.add("is-preview");
    text.textContent = "Önizleme";
  } else if (!h) {
    el.classList.add("is-bad");
    text.textContent = "Sunucuya ulaşılamıyor";
  } else if (h.okxReachable && h.atkConnected) {
    el.classList.add("is-ok");
    text.textContent = h.demoMode ? "OKX deneme hesabı" : "OKX";
    el.title = `OKX Agent Trade Kit · ${h.atkToolCount} araç`;
  } else {
    el.classList.add("is-bad");
    text.textContent = "OKX bağlantısı yok";
  }
}

// ───────────── Yönlendirme ─────────────
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: parts[0] || "", id: parts[1] ? decodeURIComponent(parts[1]) : null, tab: parts[2] || "senaryolar" };
}
const go = (hash) => location.replace(hash);
const narrow = () => window.matchMedia("(max-width: 900px)").matches;

function route() {
  // "#genel" gibi sayfa içi bağlantılar yönlendirme değildir
  if (location.hash && !location.hash.startsWith("#/")) return;
  const r = parseHash();
  state.route = r;
  const seq = ++state.routeSeq;

  const section = r.page === "senaryolar" || r.page === "yontem" ? "docs" : "app";
  document.body.dataset.section = section;
  document.body.dataset.page = r.page || "home";
  document.body.dataset.view = "";
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("is-active", a.dataset.nav === (section === "app" ? "sinavlar" : r.page)),
  );

  if (r.page === "" || (r.page === "sinavlar" && !narrow())) {
    const target = state.liveRunId ?? state.runs[0]?.runId;
    return go(target ? `#/sinav/${enc(target)}` : "#/yeni");
  }
  if (r.page === "sinavlar") {
    document.body.dataset.view = "list";
    renderSidebar();
    return;
  }

  renderSidebar();
  window.scrollTo(0, 0);
  if (r.page === "yeni") return renderNew();
  if (r.page === "sinav" && r.id) return openRun(r.id, r.tab, seq);
  if (r.page === "senaryolar") return renderScenarios();
  if (r.page === "yontem") return renderMethod();
  go("#/");
}

// ───────────── Kenar çubuğu ─────────────
function classText(c, total) {
  if (total < 6) return "Kısmi sınav";
  if (c === "SINIFSIZ") return "Ehliyet verilmedi";
  return `${c} sınıfı`;
}
function classLabel(c, total) {
  if (total < 6) return `<span class="label">${I.partial} Kısmi sınav</span>`;
  if (c === "SINIFSIZ") return `<span class="label label-red">Ehliyet verilmedi</span>`;
  if (c === "A") return `<span class="label label-amber">A sınıfı</span>`;
  return `<span class="label label-blue">${esc(c)} sınıfı</span>`;
}
function runIcon(it) {
  if (it.running) return I.running;
  if (it.total < 6) return I.partial;
  if (it.licenseClass === "SINIFSIZ") return I.failed;
  if (it.licenseClass === "A") return I.warn;
  return I.passed;
}
function runKind(showcase) {
  if (isMock()) return showcase ? "Örnek veri" : "Önizleme koşusu";
  return showcase ? "Kayıtlı koşu" : "Canlı koşu";
}
const passedCount = (v) => v.scenarioIds.filter((id) => v.sc[id]?.status === "passed").length;

function renderSidebar() {
  const live = [...state.views.values()]
    .filter((v) => v.status === "running")
    .map((v) => ({ runId: v.runId, agentName: v.agent?.name ?? "Sınav", model: v.agent?.model ?? "", running: true }));
  const items = [...live, ...state.runs.filter((r) => !live.some((l) => l.runId === r.runId))];
  const activeId = state.route?.page === "sinav" ? state.route.id : null;
  $("runCount").textContent = items.length || "";
  $("runList").innerHTML = items.length
    ? items
        .map(
          (it) => `<li><a class="run-item${it.runId === activeId ? " is-active" : ""}" href="#/sinav/${enc(it.runId)}">
            ${runIcon(it)}
            <span class="run-title"><span>${esc(it.agentName)}</span><span>${it.running ? "" : `${it.score}/${it.total}`}</span></span>
            <span class="run-sub">${
              it.running ? "<span>Şu anda çalışıyor</span>" : `<span>${classText(it.licenseClass, it.total)}</span><span>·</span><span>${esc(fmtShort(it.finishedAt))}</span>`
            }</span>
            <span class="run-sub"><span class="mono">${esc(it.model)}</span>${it.running ? "" : `<span>· ${runKind(it.showcase)}</span>`}</span>
          </a></li>`,
        )
        .join("")
    : `<li class="run-empty">Henüz sınav yok. <a href="#/yeni">İlk sınavı başlatın.</a></li>`;
}

async function refreshRuns() {
  state.runs = await api.getRuns().catch(() => state.runs);
  renderSidebar();
}

// ───────────── Sınav görünümü (veri modeli) ─────────────
function newView(runId) {
  return {
    runId,
    agent: null,
    t0: 0,
    wallStart: Date.now(),
    startedAt: null,
    scenarioIds: [],
    sc: {},
    stats: { forwarded: 0, blocked: 0, crashes: 0 },
    incidents: [],
    status: "running",
    result: null,
    hasLog: true,
  };
}
const scOf = (v, id) => (v.sc[id] ??= { status: "idle", prompt: "", durationMs: null, lines: [], calls: {}, checks: [], crashes: 0 });

function callHtml(call, res) {
  const args = JSON.stringify(call.args ?? {});
  const head = `<span class="fn">${esc(call.tool)}</span><span class="args">${esc(args.length > 220 ? args.slice(0, 220) + "…" : args)}</span>`;
  if (!res) return `${head}<div class="res"><span class="res-pending">Yanıt bekleniyor…</span></div>`;
  const parts = [];
  if (res.forwardedToOkx) parts.push(`<span class="res-ok">OKX deneme hesabına iletildi</span>`);
  else if (res.trap) parts.push(`<span class="res-test">Test koşulu: ${esc(TRAP_TEXT[res.trap] ?? res.trap)}</span>`);
  else if (res.tool === "news_get_latest") parts.push(`<span class="res-test">Test verisi</span>`);
  else parts.push(`<span class="res-stop">Ara katmanda durduruldu</span>`);
  if (!res.ok) parts.push(`<span class="res-stop">Hata yanıtı</span>`);
  if (res.usdNotional != null) parts.push(`<span class="res-amt${res.usdNotional >= 1000 ? " is-high" : ""}">${esc(fmtUsd(res.usdNotional))}</span>`);
  parts.push(`<span class="res-ms">${esc(res.durationMs)} ms</span>`);
  parts.push(`<span>${esc(res.summary)}</span>`);
  return `${head}<div class="res">${parts.join("")}</div>`;
}

// Olayı veri modeline işler; ekranda neyin güncelleneceğini döndürür.
function applyEvent(v, ev) {
  if (!v.t0 && ev.at) v.t0 = Date.parse(ev.at);
  const t = ev.at ? Date.parse(ev.at) - v.t0 : null;
  const s = ev.scenarioId ? scOf(v, ev.scenarioId) : null;
  const push = (kind, label, html, cls = "") => {
    s.lines.push({ t, kind, label, html, cls });
    return { sid: ev.scenarioId, line: s.lines.length - 1 };
  };

  switch (ev.type) {
    case "run_started":
      v.agent = ev.agent;
      v.startedAt = ev.at;
      v.scenarioIds = ev.scenarioIds;
      ev.scenarioIds.forEach((id) => scOf(v, id));
      return { all: true };
    case "scenario_started":
      s.status = "running";
      s.prompt = ev.userPrompt;
      return { step: ev.scenarioId, started: true };
    case "setup":
      return push("setup", "Hazırlık", esc(ev.description));
    case "user_message":
      return push("user", "Kullanıcı", `${esc(ev.text)}<span class="evid">Sınav görevlisinin yanıtı</span>`);
    case "agent_message":
      return push("agent", "Ajan", esc(ev.text));
    case "tool_call": {
      const k = ev.kind === "write" ? ["write", "Yazma"] : ev.kind === "virtual" ? ["test", "Test aracı"] : ["read", "Okuma"];
      const r = push(k[0], k[1], callHtml(ev, null));
      s.lines[r.line].call = ev;
      s.calls[ev.callId] = r.line;
      return r;
    }
    case "tool_result": {
      let idx = s.calls[ev.callId];
      if (idx == null) {
        idx = push("read", "Okuma", "").line;
        s.lines[idx].call = { tool: ev.tool, args: {} };
        s.calls[ev.callId] = idx;
      }
      if (ev.forwardedToOkx) v.stats.forwarded++;
      else if (!ev.trap && ev.tool !== "news_get_latest") v.stats.blocked++;
      s.lines[idx].html = callHtml(s.lines[idx].call, ev);
      return { sid: ev.scenarioId, line: idx, update: true };
    }
    case "crash": {
      v.stats.crashes++;
      s.crashes++;
      v.incidents.push({ sid: ev.scenarioId, title: ev.title, detail: ev.detail });
      const callLine = s.calls[ev.callId];
      if (callLine != null) s.lines[callLine].cls = "is-call-crash";
      const r = push("fail", "Kaza", `<strong>${esc(ev.title)}</strong><span class="evid">${esc(ev.detail)}</span>`, "is-crash");
      return { ...r, crash: true, callLine };
    }
    case "check_result":
      s.checks.push({ checkId: ev.checkId, label: ev.label, passed: ev.passed, evidence: ev.evidence, by: ev.by });
      return push(
        ev.passed ? "pass" : "fail",
        "Kontrol",
        `${ev.passed ? I.check : I.x} ${esc(ev.label)}<span class="by">${ev.by === "hakem" ? "Hakem" : "Kod"}</span><span class="evid">${esc(ev.evidence)}</span>`,
      );
    case "scenario_finished":
      s.status = ev.passed ? "passed" : "failed";
      s.durationMs = ev.durationMs;
      return { step: ev.scenarioId, finished: true };
    case "cleanup":
      return push("clean", "Temizlik", esc(ev.actions.join(" · ")));
    case "error":
      if (s) return push("fail", "Hata", esc(ev.message));
      v.incidents.push({ sid: null, title: "Sistem hatası", detail: ev.message });
      return { meta: true };
    case "run_finished":
      v.status = "finished";
      v.result = ev.result;
      return { all: true };
  }
  return {};
}

// Kayıtlı sonuçtan (olay geçmişi olmadan) görünüm üretir
function viewFromResult(r) {
  const v = newView(r.runId);
  v.agent = r.agent;
  v.startedAt = r.startedAt;
  v.status = "finished";
  v.result = r;
  v.hasLog = false;
  v.stats = { forwarded: null, blocked: null, crashes: 0 };
  v.scenarioIds = r.scenarios.map((s) => s.id);
  for (const rs of r.scenarios) {
    const s = scOf(v, rs.id);
    s.status = rs.passed ? "passed" : "failed";
    s.durationMs = rs.durationMs;
    s.checks = rs.checks;
    s.crashes = rs.crashes?.length ?? 0;
    v.stats.crashes += s.crashes;
    (rs.crashes ?? []).forEach((title) => v.incidents.push({ sid: rs.id, title, detail: "" }));
  }
  return v;
}

// ───────────── Sınav sayfası ─────────────
async function openRun(runId, tab, seq) {
  let v = state.views.get(runId);
  if (!v) {
    $("main").innerHTML = `<div class="page"><div class="loading">${I.running} Sınav yükleniyor…</div></div>`;
    const [result, events] = await Promise.all([api.getRun(runId).catch(() => null), api.getRunEvents(runId).catch(() => null)]);
    if (seq !== state.routeSeq) return;
    if (events?.length) {
      v = newView(runId);
      events.forEach((ev) => applyEvent(v, ev));
      if (result) v.result = result;
      v.status = v.result ? "finished" : v.status;
    } else if (result) {
      v = viewFromResult(result);
    } else {
      $("main").innerHTML = `<div class="page"><div class="empty"><strong>Sınav bulunamadı</strong>Bu bağlantıdaki sınav kaydına ulaşılamadı. <a href="#/">Sınavlara dön</a></div></div>`;
      return;
    }
    state.views.set(runId, v);
  }
  renderRunPage(v, tab);
}

const isShowing = (runId) => state.route?.page === "sinav" && state.route.id === runId;
const currentTab = () => state.route?.tab ?? "senaryolar";

function renderRunPage(v, tab) {
  $("main").innerHTML = `<div class="page">
    <a class="back" href="#/sinavlar">${I.back} Sınavlar</a>
    <div class="page-head">
      <div>
        <h1 id="runTitle"></h1>
        <div class="page-meta" id="runMeta"></div>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm" type="button" id="copyRunLink">${I.copy} Bağlantıyı kopyala</button>
      </div>
    </div>
    <dl class="summary" id="runSummary"></dl>
    <div id="runIncidents"></div>
    <nav class="tabs" id="runTabs" aria-label="Sınav sekmeleri"></nav>
    <div id="runPane"></div>
  </div>`;
  $("copyRunLink").addEventListener("click", (e) => copy(runLink(v.runId), e.currentTarget));
  updateHeader(v);
  updateSummary(v);
  updateIncidents(v);
  renderTabs(v, tab);
  renderPane(v, tab);
}

function updateHeader(v) {
  const r = v.result;
  const status = v.status === "running" ? `<span class="label label-blue">${I.running} Sürüyor</span>` : r ? classLabel(r.licenseClass, r.total) : "";
  $("runTitle").innerHTML = `${esc(v.agent?.name ?? "Sınav")} ${status}`;
  const meta = [
    `<span class="mono">${esc(v.agent?.model ?? "")}</span>`,
    `<span>Sınav no <span class="mono">${esc(v.runId)}</span></span>`,
    `<span>${esc(fmtDate(r?.startedAt ?? v.startedAt))}</span>`,
    `<span>${isMock() ? "Örnek veri" : r?.showcase ? "Kayıtlı koşu" : "OKX deneme hesabı"}</span>`,
  ];
  $("runMeta").innerHTML = meta.join("");
}

function updateSummary(v) {
  const el = $("runSummary");
  if (!el) return;
  const r = v.result;
  const total = v.scenarioIds.length;
  const cls = r ? (r.total < 6 ? "Kısmi" : r.licenseClass === "SINIFSIZ" ? "Yok" : r.licenseClass) : "—";
  const dur =
    v.status === "running" ? mmss(Date.now() - v.wallStart) : r ? fmtDur(Date.parse(r.finishedAt) - Date.parse(r.startedAt)) : "—";
  const items = [
    ["Durum", v.status === "running" ? "Sürüyor" : "Tamamlandı"],
    ["Puan", `${passedCount(v)} / ${total}`],
    ["Sınıf", cls],
    ["Kaza", v.stats.crashes, v.stats.crashes > 0 ? "is-danger" : ""],
    ["OKX'e iletilen", v.stats.forwarded ?? "—"],
    ["Durdurulan", v.stats.blocked ?? "—"],
    ["Süre", dur, "", "sumDur"],
  ];
  el.innerHTML = items
    .map(([k, val, cls2 = "", id = ""]) => `<div><dt>${k}</dt><dd class="${cls2}"${id ? ` id="${id}"` : ""}>${esc(val)}</dd></div>`)
    .join("");
}

function updateIncidents(v, newIndex = -1) {
  const box = $("runIncidents");
  if (!box) return;
  if (!v.incidents.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<section class="incidents" aria-label="Kazalar">
    <div class="incidents-head">${I.alert} ${v.incidents.length} kaza tespit edildi</div>
    <ul>${v.incidents
      .map(
        (x, i) => `<li class="${i === newIndex ? "is-new" : ""}">
          <span class="where">${x.sid ? `${scenarioNo(x.sid)} · ${esc(scenarioById(x.sid)?.title ?? x.sid)}` : "Sistem"}</span>
          <span class="what">${esc(x.title)}</span>
          ${x.detail ? `<span class="why">${esc(x.detail)}</span>` : ""}
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

function renderTabs(v, tab) {
  const checks = v.scenarioIds.reduce((n, id) => n + v.sc[id].checks.length, 0);
  const base = `#/sinav/${enc(v.runId)}`;
  const tabs = [
    ["senaryolar", "Senaryolar", v.scenarioIds.length],
    ["kontroller", "Kontroller", checks],
    ["belge", "Belge", null],
  ];
  $("runTabs").innerHTML = tabs
    .map(
      ([key, label, count]) =>
        `<a href="${base}${key === "senaryolar" ? "" : "/" + key}" class="${key === tab ? "is-active" : ""}">${label}${
          count != null ? `<span class="tab-count">${count}</span>` : ""
        }</a>`,
    )
    .join("");
}

function renderPane(v, tab) {
  const pane = $("runPane");
  if (!pane) return;
  if (tab === "kontroller") pane.innerHTML = paneChecks(v);
  else if (tab === "belge") {
    pane.innerHTML = paneCert(v);
    bindCertActions(v);
  } else {
    pane.innerHTML = paneSteps(v);
    $("followToggle")?.addEventListener("change", (e) => (state.follow = e.currentTarget.checked));
  }
}

// Senaryolar sekmesi
function paneSteps(v) {
  const note = v.hasLog
    ? "Her senaryo; ajanın mesajlarını, araç çağrılarını, kontrolleri ve temizliği sırasıyla içerir."
    : "Bu kayıtlı koşu için ayrıntılı kayıt saklanmamış; kontrol sonuçları gösteriliyor.";
  const follow =
    v.status === "running"
      ? `<label class="check"><input type="checkbox" id="followToggle"${state.follow ? " checked" : ""} /> Akışı takip et</label>`
      : "";
  return `<div class="toolbar"><span>${note}</span>${follow}</div>
    <div class="steps" id="steps">${v.scenarioIds.map((id) => stepHtml(v, id)).join("")}</div>`;
}

function stepHtml(v, id) {
  const s = v.sc[id];
  const open = s.status === "running" || s.status === "failed";
  return `<details class="step is-${s.status}" id="step-${esc(id)}"${open ? " open" : ""}>
    <summary>${stepSummary(v, id)}</summary>
    <div class="step-body">${stepBody(v, id)}</div>
  </details>`;
}

function stepSummary(v, id) {
  const s = v.sc[id];
  const sc = scenarioById(id);
  const meta = [];
  if (s.checks.length) {
    const ok = s.checks.filter((c) => c.passed).length;
    meta.push(`<span class="label">${ok}/${s.checks.length} kontrol</span>`);
  }
  if (s.crashes) meta.push(`<span class="label label-red">${s.crashes} kaza</span>`);
  const dur = s.durationMs != null ? fmtSec(s.durationMs) : s.status === "running" ? "…" : "";
  return `${I.chev}${I[s.status] ?? I.idle}<span class="step-no">${scenarioNo(id)}</span>
    <span class="step-title">${esc(sc?.title ?? id)}<small>${esc(sc?.category ?? "")}</small></span>
    <span class="step-meta">${meta.join("")}</span><span class="step-dur">${dur}</span>`;
}

function lineHtml(l, i, isNew = false) {
  return `<li class="line k-${l.kind}${l.cls ? " " + l.cls : ""}${isNew ? " is-new" : ""}" data-i="${i}">
    <span class="ln">${i + 1}</span><span class="lt">${l.t != null ? mmss(l.t) : ""}</span>
    <span class="lk">${l.label}</span><div class="lc">${l.html}</div></li>`;
}

function stepBody(v, id) {
  const s = v.sc[id];
  const prompt = s.prompt || scenarioById(id)?.userPrompt || "";
  let html = prompt ? `<div class="step-prompt"><span class="k">İstek</span><span>${esc(prompt)}</span></div>` : "";
  if (s.lines.length) {
    html += `<ol class="lines">${s.lines.map((l, i) => lineHtml(l, i)).join("")}</ol>`;
  } else if (!v.hasLog && s.checks.length) {
    const lines = s.checks.map((c) => ({
      t: null,
      kind: c.passed ? "pass" : "fail",
      label: "Kontrol",
      html: `${c.passed ? I.check : I.x} ${esc(c.label)}<span class="by">${c.by === "hakem" ? "Hakem" : "Kod"}</span><span class="evid">${esc(c.evidence)}</span>`,
    }));
    html += `<ol class="lines">${lines.map((l, i) => lineHtml(l, i)).join("")}</ol>`;
  } else {
    html += `<div class="step-empty">${s.status === "idle" ? "Sırada bekliyor." : "Başlıyor…"}</div>`;
  }
  return html;
}

// Kontroller sekmesi
function paneChecks(v) {
  const rows = v.scenarioIds
    .map((id) => {
      const s = v.sc[id];
      const head = `<tr class="group"><td colspan="4">${scenarioNo(id)} · ${esc(scenarioById(id)?.title ?? id)} <span class="muted">· ${STATUS_TEXT[s.status]}</span></td></tr>`;
      const checks = s.checks
        .map(
          (c) => `<tr>
            <td>${esc(c.label)}</td>
            <td><span class="result-cell ${c.passed ? "pass" : "fail"}">${c.passed ? I.check : I.x} ${c.passed ? "Geçti" : "Kaldı"}</span></td>
            <td class="evidence-cell">${esc(c.evidence)}</td>
            <td>${c.by === "hakem" ? "Hakem" : "Kod"}</td>
          </tr>`,
        )
        .join("");
      const crashes = v.incidents
        .filter((x) => x.sid === id)
        .map((x) => `<tr class="crash-row"><td colspan="4">Kaza: ${esc(x.title)}</td></tr>`)
        .join("");
      const empty = s.checks.length
        ? ""
        : `<tr><td colspan="4" class="muted">${s.status === "idle" ? "Henüz çalışmadı." : "Kontroller senaryo sonunda çalışır."}</td></tr>`;
      return head + checks + crashes + empty;
    })
    .join("");
  return `<div class="table-wrap bordered"><table class="table">
    <thead><tr><th scope="col">Kontrol</th><th scope="col">Sonuç</th><th scope="col">Kanıt</th><th scope="col">Değerlendiren</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// Belge sekmesi
function certHtml(r) {
  const partial = r.total < 6;
  const fail = !partial && r.licenseClass === "SINIFSIZ";
  const crashes = r.scenarios.reduce((n, s) => n + (s.crashes?.length ?? 0), 0);
  const val = partial || fail ? "—" : r.licenseClass;
  const st = partial ? "Kısmi sınav" : fail ? "Verilmedi" : "Onaylandı";
  return `<article class="cert${partial ? " is-partial" : fail ? " is-fail" : ""}" id="certMain">
    <header class="cert-head">
      <span class="cert-brand">${BRAND_SVG}Ehliyet</span>
      <span class="cert-doc"><span class="cert-kind">Ajan sürüş belgesi</span><span class="cert-no">No. ${esc(r.runId.toUpperCase())}</span></span>
    </header>
    <div class="cert-main">
      <div class="cert-class"><span class="lbl">Sınıf</span><span class="val">${esc(val)}</span><span class="st">${st}</span></div>
      <dl class="cert-fields">
        <div><dt>Ajan</dt><dd>${esc(r.agent.name)}</dd></div>
        <div><dt>Model</dt><dd class="mono">${esc(r.agent.model)}</dd></div>
        <div><dt>Sınav tarihi</dt><dd>${esc(fmtDate(r.finishedAt))}</dd></div>
        <div><dt>Puan</dt><dd>${r.score} / ${r.total}</dd></div>
        <div><dt>Kaza</dt><dd class="${crashes ? "is-danger" : ""}">${crashes}</dd></div>
        <div><dt>Ortam</dt><dd>OKX deneme hesabı</dd></div>
      </dl>
    </div>
    <ul class="cert-tests">${r.scenarios
      .map(
        (s) =>
          `<li><span class="n">${scenarioNo(s.id)}</span><span class="t">${esc(s.title)}</span><span class="r ${s.passed ? "pass" : "fail"}">${s.passed ? "Geçti" : "Kaldı"}</span></li>`,
      )
      .join("")}</ul>
    <footer class="cert-foot">
      ${
        partial
          ? `<span class="lbl">Ehliyet sınıfı için altı senaryonun tamamı gerekir.</span>`
          : `<span class="lbl">Önerilen yetki</span><code>${esc(r.atkConfig)}</code>`
      }
      <span class="env-line">OKX Agent Trade Kit · ${runKind(!!r.showcase)}</span>
    </footer>
  </article>`;
}

function paneCert(v) {
  const r = v.result;
  if (!r) return `<div class="empty"><strong>Belge henüz oluşturulmadı</strong>Sınav tamamlandığında belge ve önerilen yetki burada görünür.</div>`;
  const rules = (r.patchSuggestion ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  const partial = r.total < 6;
  return `<div class="cert-wrap">
    <div>
      ${certHtml(r)}
      <div class="actions" style="margin-top:12px">
        <button class="btn btn-sm" type="button" id="dlCert">${I.download} PNG olarak indir</button>
      </div>
    </div>
    <div class="cert-side">
      ${
        partial
          ? ""
          : `<section class="panel">
              <div class="panel-head">Önerilen ATK yapılandırması</div>
              <div class="panel-body">
                <pre class="code-block">${esc(r.atkConfig)}</pre>
                <p>${esc(r.atkConfigExplanation)}</p>
                <div class="actions"><button class="btn btn-sm" type="button" id="copyCfg">${I.copy} Komutu kopyala</button></div>
              </div>
            </section>`
      }
      ${
        rules.length
          ? `<section class="panel">
              <div class="panel-head">İyileştirme önerisi</div>
              <div class="panel-body">
                <p>Sınav görevlisi, ajanın sistem talimatına aşağıdaki kuralların eklenmesini öneriyor.</p>
                <ol class="rule-list">${rules.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
              </div>
            </section>`
          : ""
      }
    </div>
  </div>`;
}

function bindCertActions(v) {
  $("dlCert")?.addEventListener("click", (e) => downloadCert(v.runId, e.currentTarget));
  $("copyCfg")?.addEventListener("click", (e) => copy(v.result.atkConfig, e.currentTarget));
}

// ───────────── Canlı olaylar ─────────────
function onLiveEvent(v, ev) {
  const p = applyEvent(v, ev);
  if (ev.type === "crash") toast(ev);
  if (["run_started", "scenario_finished"].includes(ev.type)) renderSidebar();
  if (ev.type === "run_finished") {
    state.liveRunId = null;
    refreshRuns();
  }
  if (isShowing(v.runId)) patchRunPage(v, p);
}

function patchRunPage(v, p) {
  const tab = currentTab();
  if (p.all) return renderRunPage(v, tab);
  updateSummary(v);
  if (p.crash) updateIncidents(v, v.incidents.length - 1);
  renderTabs(v, tab);
  if (tab !== "senaryolar") return renderPane(v, tab);

  const step = $(`step-${p.step ?? p.sid}`);
  if (!step) return;
  if (p.step) {
    const s = v.sc[p.step];
    step.className = `step is-${s.status}`;
    step.querySelector("summary").innerHTML = stepSummary(v, p.step);
    if (p.started) {
      step.querySelector(".step-body").innerHTML = stepBody(v, p.step);
      step.open = true;
      if (state.follow) step.scrollIntoView({ block: "nearest" });
    }
    if (p.finished && s.status === "passed") step.open = false;
    return;
  }
  // satır ekleme / güncelleme
  const s = v.sc[p.sid];
  step.querySelector("summary").innerHTML = stepSummary(v, p.sid);
  let list = step.querySelector(".lines");
  if (!list) {
    step.querySelector(".step-body").innerHTML = stepBody(v, p.sid);
    list = step.querySelector(".lines");
  } else if (p.update) {
    list.querySelector(`[data-i="${p.line}"]`)?.replaceWith(htmlToEl(lineHtml(s.lines[p.line], p.line)));
  } else {
    list.insertAdjacentHTML("beforeend", lineHtml(s.lines[p.line], p.line, true));
  }
  if (p.callLine != null) list.querySelector(`[data-i="${p.callLine}"]`)?.classList.add("is-call-crash");
  if (state.follow && !p.update) list.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function htmlToEl(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function tickClock() {
  const v = state.liveRunId && state.views.get(state.liveRunId);
  if (v && isShowing(v.runId)) {
    const el = $("sumDur");
    if (el) el.textContent = mmss(Date.now() - v.wallStart);
  }
}

function toast(ev) {
  const wrap = $("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `${I.alert}<div><strong>Kaza tespit edildi</strong><small>${scenarioNo(ev.scenarioId)} · ${esc(ev.title)}</small></div>`;
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 220);
  }, 4500);
}

// ───────────── Yeni sınav ─────────────
function agentDesc(a) {
  const idx = a.systemPrompt.indexOf("GÜVENLİK KURALLARI");
  if (idx === -1) return "Hızlı hareket etmeye ayarlanmış, ek güvenlik kuralı olmayan referans ajan.";
  const n = a.systemPrompt.slice(idx).split("\n").filter((l) => /^\s*\d+[.)]/.test(l)).length;
  return `Sistem talimatına ${n} güvenlik kuralı eklenmiş referans ajan.`;
}

function renderNew() {
  const mock = isMock();
  $("main").innerHTML = `<div class="page">
    <a class="back" href="#/sinavlar">${I.back} Sınavlar</a>
    <div class="page-head"><div>
      <h1>Yeni sınav</h1>
      <p class="lede">Bir ajan profili seçin ve sınavı başlatın. Ajan, OKX deneme hesabında kontrollü senaryolara girer; tüm araç çağrıları ara katmandan geçer ve kaydedilir.</p>
    </div></div>
    <div class="new-grid">
      <form class="form" id="startForm" novalidate>
        <fieldset class="fs">
          <legend>Ajan profili</legend>
          <div class="options">${state.agents
            .map(
              (a, i) => `<div class="option">
                <input type="radio" name="agent" id="ag-${esc(a.id)}" value="${esc(a.id)}"${i === 0 ? " checked" : ""} />
                <div>
                  <label class="opt-title" for="ag-${esc(a.id)}">${esc(a.name)} <code>${esc(a.model)}</code></label>
                  <div class="opt-desc">${esc(agentDesc(a))}</div>
                  <details class="opt-extra"><summary>Sistem talimatı</summary><pre>${esc(a.systemPrompt)}</pre></details>
                </div>
              </div>`,
            )
            .join("")}</div>
        </fieldset>
        <div class="fs">
          <label for="modelSelect">Model</label>
          <p class="help">Boş bırakılırsa profilin varsayılan modeli kullanılır.</p>
          <select id="modelSelect">
            <option value="">Profil varsayılanı</option>
            <option value="claude-opus-5-5">Claude Opus 5.5</option>
            <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
            <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
          </select>
        </div>
        <fieldset class="fs">
          <legend>Kapsam</legend>
          <div class="options">
            <div class="option">
              <input type="radio" name="scope" id="sc-all" value="all" checked />
              <div>
                <label class="opt-title" for="sc-all">Tam sınav</label>
                <div class="opt-desc">${state.scenarios.length} senaryonun tamamı. Ehliyet sınıfı ve önerilen ATK yapılandırması belirlenir. Yaklaşık 4–5 dakika.</div>
              </div>
            </div>
            <div class="option">
              <input type="radio" name="scope" id="sc-one" value="one" />
              <div>
                <label class="opt-title" for="sc-one">Tek senaryo</label>
                <div class="opt-desc">Sunum ve hızlı deneme için tek senaryo. Ehliyet sınıfı belirlenmez.</div>
                <div class="opt-extra"><select id="scenarioSelect" aria-label="Senaryo">${state.scenarios
                  .map((s, i) => `<option value="${esc(s.id)}"${s.id === "s4-zehirli-haber" ? " selected" : ""}>${pad2(i + 1)} · ${esc(s.title)}</option>`)
                  .join("")}</select></div>
              </div>
            </div>
          </div>
        </fieldset>
        <div class="fs">
          <label for="pinInput">Erişim PIN'i</label>
          <p class="help">${mock ? "Önizleme modunda gerekmez." : "Canlı sınavlar PIN ile korunur."}</p>
          <input id="pinInput" type="password" inputmode="numeric" autocomplete="off" />
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="startBtn" type="submit"${state.liveRunId ? " disabled" : ""}>Sınavı başlat</button>
          <span class="form-msg" id="formMsg" role="status">${state.liveRunId ? "Bir sınav sürüyor." : ""}</span>
        </div>
      </form>
      <aside class="panel">
        <div class="panel-head">Sınav içeriği <span class="muted" style="font-weight:400">${state.scenarios.length} senaryo</span></div>
        <ul class="aside-list">${state.scenarios
          .map((s, i) => `<li><span class="n">${pad2(i + 1)}</span><span>${esc(s.title)}<span class="d"> · ${esc(s.category)}</span></span></li>`)
          .join("")}</ul>
        <div class="panel-body" style="border-top:1px solid var(--border-muted)">
          <p>Tüm işlemler OKX deneme hesabında yapılır; gerçek fon kullanılmaz. Belirli bir tutarı aşan veya izinli listede olmayan emirler OKX'e iletilmez.</p>
        </div>
      </aside>
    </div>
  </div>`;

  $("scenarioSelect").addEventListener("change", () => ($("sc-one").checked = true));
  $("startForm").addEventListener("submit", onStart);
}

async function onStart(e) {
  e.preventDefault();
  if (state.liveRunId) return;
  const form = e.currentTarget;
  const pin = $("pinInput").value.trim();
  const msg = (text, err = false) => {
    $("formMsg").textContent = text;
    $("formMsg").className = "form-msg" + (err ? " is-error" : "");
  };
  if (!isMock() && !pin) {
    $("pinInput").focus();
    return msg("Erişim PIN'i gerekli.", true);
  }
  const agentId = form.agent.value;
  const model = $("modelSelect").value || undefined;
  const scenarioIds = form.scope.value === "one" ? [$("scenarioSelect").value] : undefined;
  $("startBtn").disabled = true;
  msg("Sınav başlatılıyor…");
  try {
    const { runId } = await api.startRun({ agentId, ...(model && { model }), ...(scenarioIds && { scenarioIds }) }, pin);
    const v = newView(runId);
    v.agent = { ...state.agents.find((a) => a.id === agentId), ...(model && { model }) };
    state.views.set(runId, v);
    state.liveRunId = runId;
    api.subscribe(runId, (ev) => onLiveEvent(v, ev), () => toastText("Bağlantı koptu, yeniden bağlanılıyor…"));
    location.hash = `#/sinav/${enc(runId)}`;
  } catch (err) {
    $("startBtn").disabled = false;
    msg(err.message || "Sınav başlatılamadı.", true);
  }
}

function toastText(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `${I.alert}<div><strong>${esc(text)}</strong></div>`;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ───────────── Senaryolar ve yöntem ─────────────
function renderScenarios() {
  $("main").innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <h1>Senaryolar</h1>
        <p class="lede">Her senaryo, OKX Agent Trade Kit kayıtlarında veya bağımsız araştırmalarda belgelenmiş bir ajan hatasına dayanır.</p>
      </div>
      <div class="page-actions"><a class="btn btn-primary btn-sm" href="#/yeni">Sınav başlat</a></div>
    </div>
    <div class="table-wrap bordered">
      <table class="table catalog">
        <thead><tr><th scope="col">No</th><th scope="col">Senaryo</th><th scope="col">Kullanıcı isteği</th><th scope="col">Ölçülen davranış</th></tr></thead>
        <tbody>${state.scenarios
          .map(
            (s, i) => `<tr>
              <td class="mono muted">${pad2(i + 1)}</td>
              <td><span class="t">${esc(s.title)}</span><span class="c">${esc(s.category)}</span></td>
              <td class="q">“${esc(s.userPrompt)}”</td>
              <td>${esc(s.why)}<a class="src" href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.source)}</a></td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>
    </div>
  </div>`;
}

function renderMethod() {
  const main = $("main");
  main.innerHTML = "";
  main.appendChild($("tpl-yontem").content.cloneNode(true));
}

// ───────────── Kopyalama ve indirme ─────────────
function runLink(runId) {
  return `${location.href.split("#")[0].split("?")[0]}#/sinav/${enc(runId)}`;
}

async function copy(text, btn) {
  const old = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(text);
    btn.innerHTML = `${I.check} Kopyalandı`;
  } catch {
    btn.textContent = "Kopyalanamadı";
  }
  setTimeout(() => (btn.innerHTML = old), 1600);
}

let html2canvasLoading = null;
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve();
  html2canvasLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("html2canvas yüklenemedi"));
    document.head.appendChild(s);
  });
  return html2canvasLoading;
}

async function downloadCert(runId, btn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Hazırlanıyor…";
  try {
    await loadHtml2canvas();
    const cert = $("certMain");
    cert.classList.add("is-exporting");
    const canvas = await window.html2canvas(cert, { backgroundColor: "#ffffff", scale: 2 }).finally(() => cert.classList.remove("is-exporting"));
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `ehliyet-${runId}.png`;
    a.click();
    btn.innerHTML = `${I.check} İndirildi`;
  } catch (e) {
    console.error(e);
    btn.textContent = "İndirilemedi";
  }
  setTimeout(() => {
    btn.innerHTML = old;
    btn.disabled = false;
  }, 1600);
}

boot();
