// SİGORTA (SİMÜLE) — Ehliyet riski ölçer, sigorta riski fiyatlar ve devralır.
//
//  1. Aktüerya   Sınav sonuçları → kaza olasılığının %95 üst sınırı → prim (frekans × şiddet × yük).
//  2. Telematik  Poliçe yalnızca EHLİYET geçidi arkasında geçerlidir; her araç çağrısı kanıt zincirine yazılır.
//  3. Parametrik Tazminatı dil modeli değil, politika motorunun kodla tespit ettiği kural ihlali tetikler.
//                Geçidin durdurduğu emir hasar doğurmaz; borsaya ulaşan ihlalli emir teminat limitine kadar ödenir.
//  4. Havuz      Primler havuza girer, tazminatlar çıkar. Defter hash zincirlidir. Sermaye simüledir.
//
// Kilit fikir: kaza başına hasar, geçidin kodla dayattığı emir tavanıyla sınırlıdır (maxNotional).
// Tavan olmasaydı kuyruk riski tüm hesap olurdu ve hiçbir prim anlamlı olmazdı.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CFG, INSURANCE_DIR } from "./config.js";
import { RULES } from "./gateway/policy.js";
import { canonical, signDoc, verifyDoc } from "./license.js";
import { emit } from "./store.js";
import type { Audit, AuditEvent, ClaimItem, Exposure, LicensePayload, RiskQuote, Underwriting } from "./types.js";

type Cls = Exclude<LicensePayload["class"], "SINIFSIZ">;

/** Sınıfa göre poliçe şartları: dönem limiti (tavanın katı) ve muafiyet. SINIFSIZ'a poliçe yazılmaz. */
export const TERMS: Record<Cls, { aggregateX: number; deductiblePct: number; label: string }> = {
  C: { aggregateX: 5, deductiblePct: 0, label: "Tam teminat" },
  B: { aggregateX: 3, deductiblePct: 10, label: "Standart teminat" },
  A: { aggregateX: 2, deductiblePct: 25, label: "Sınırlı teminat" },
};

/** Tazminatı tetikleyen kurallar (politika motoru, kod). FUNDS_MOVEMENT tetiklenir ama kapsam dışıdır. */
export const TRIGGER_RULES = ["NOTIONAL_OVER", "CAP_EXCEEDED", "UNREQUESTED_WRITE", "INJECTION_OBEYED", "REMEDIATION_AUTO", "DUPLICATE_ORDER", "WRONG_SIDE", "INSTRUMENT_SUBSTITUTION", "FUNDS_MOVEMENT"];
const EXCLUDED_RULES = new Set(["FUNDS_MOVEMENT"]);

export const EXCLUSIONS = [
  "Fon transferi ve para çekme denemeleri (ATK yetkisinde zaten kapalıdır)",
  "EHLİYET geçidi dışından yapılan işlemler",
  "Ajan kurallara uyduğu hâlde piyasa hareketinden doğan zarar",
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// ── aktüerya ─────────────────────────────────────────────────────────────────
const Z95 = 1.6448536269514722; // tek yönlü %95

/** n gözlemde k kaza için kaza oranının %95 üst sınırı. k=0: 1 − 0,05^(1/n) (“rule of three”), k>0: Wilson. */
export function upperBound(k: number, n: number): number {
  if (n <= 0 || k >= n) return 1;
  if (k <= 0) return 1 - Math.pow(0.05, 1 / n);
  const p = k / n;
  const z2 = Z95 * Z95;
  return Math.min(1, (p + z2 / (2 * n) + Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n));
}

export function priceRisk(runs: number, failures: number, severityUsd: number, withProjection = true): RiskQuote {
  const point = runs ? failures / runs : 1;
  const upper = upperBound(failures, runs);
  const lambda = CFG.exposure;
  const tasks = CFG.policyTasks;
  const expPoint = tasks * lambda * point;
  const exp = tasks * lambda * upper;
  const pure = exp * severityUsd;
  return {
    runs,
    failures,
    pointRate: r4(point),
    upperRate: r4(upper),
    exposure: lambda,
    periodTasks: tasks,
    expectedClaimsPoint: r4(expPoint),
    expectedClaims: r4(exp),
    severityUsd,
    load: CFG.premiumLoad,
    purePremiumUsd: r2(pure),
    premiumUsd: r2(pure * (1 + CFG.premiumLoad)),
    premiumPointUsd: r2(expPoint * severityUsd * (1 + CFG.premiumLoad)),
    premiumIf3xUsd: withProjection ? priceRisk(runs * 3, failures * 3, severityUsd, false).premiumUsd : null,
  };
}

export function quoteFor(a: Audit): RiskQuote {
  let runs = 0;
  let failures = 0;
  for (const r of a.results) {
    runs += r.runs.length;
    failures += r.runs.filter((x) => !x.pass).length;
  }
  return priceRisk(runs, failures, a.options.maxNotional, a.options.repetitions < 3);
}

// ── parametrik tetik: kanıttan hasar kalemleri ───────────────────────────────
export function claimsFrom(events: AuditEvent[]): ClaimItem[] {
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  const groups = new Map<number, AuditEvent[]>();
  for (const e of events) {
    if (e.kind !== "violation" || !TRIGGER_RULES.includes(e.data.rule)) continue;
    const ref = Number(e.data.refSeq ?? e.seq);
    groups.set(ref, [...(groups.get(ref) ?? []), e]);
  }
  const items: ClaimItem[] = [];
  for (const [ref, vs] of groups) {
    const call = bySeq.get(ref);
    const callId = call?.data.callId;
    const related = events.filter((e) => callId != null && e.data.callId === callId && e.auditId === vs[0].auditId);
    const ns = related.filter((e) => e.kind === "notional" && typeof e.data.usd === "number");
    const notional = ns.length ? ns.reduce((s, e) => s + e.data.usd, 0) : null;
    const blocked = related.some((e) => e.kind === "blocked");
    const accepted = related.some((e) => e.kind === "order" && e.data.accepted && !e.data.simulated);
    const rules = [...new Set(vs.map((v) => String(v.data.rule)))];
    const status: ClaimItem["status"] = rules.some((r) => EXCLUDED_RULES.has(r))
      ? "excluded"
      : blocked
        ? "prevented"
        : accepted && (notional ?? 0) > 0
          ? "reached"
          : "no_loss";
    items.push({
      seq: vs[0].seq,
      examId: vs[0].examId,
      rep: vs[0].rep,
      rules,
      titles: rules.map((r) => RULES[r]?.title ?? r),
      tool: String(call?.data.tool ?? ""),
      instId: call?.data.args?.instId ?? ns[0]?.data.instId,
      notionalUsd: notional == null ? null : r2(notional),
      status,
    });
  }
  return items.sort((x, y) => x.seq - y.seq);
}

export function exposureFrom(events: AuditEvent[]): Exposure {
  const items = claimsFrom(events);
  const sum = (s: ClaimItem["status"]) => r2(items.filter((i) => i.status === s).reduce((t, i) => t + (i.notionalUsd ?? 0), 0));
  return {
    triggers: items.length,
    prevented: items.filter((i) => i.status === "prevented").length,
    preventedUsd: sum("prevented"),
    reached: items.filter((i) => i.status === "reached").length,
    reachedUsd: sum("reached"),
    items,
  };
}

// ── poliçe ve havuz kayıtları ────────────────────────────────────────────────
export interface PolicyPayload {
  v: 1;
  id: string;
  kind: "SİMÜLE POLİÇE";
  issuer: "EHLIYET";
  issuedAt: string;
  auditId: string;
  licenseId: string;
  agent: { name: string; team?: string; model?: string; fingerprint?: string };
  class: Cls;
  termsLabel: string;
  premiumUsd: number;
  perClaimUsd: number;
  aggregateUsd: number;
  deductiblePct: number;
  periodTasks: number;
  quote: RiskQuote;
  atkArgs: string;
  conditions: string[];
  triggers: string[];
  exclusions: string[];
  evidenceHash: string;
  validity: string;
}
export type SignedPolicy = { payload: PolicyPayload; signature: string; publicKeyId: string };
export type PolicyStatus = "active" | "exhausted" | "superseded" | "cancelled";
export interface PolicyState {
  status: PolicyStatus;
  statusNote?: string;
  paidUsd: number;
  claims: { auditId: string; seq: number; amountUsd: number; ledgerSeq: number; ts: string }[];
}
export interface PolicyRecord {
  doc: SignedPolicy;
  state: PolicyState;
}

export interface LedgerEntry {
  seq: number;
  ts: string;
  type: "seed" | "premium" | "payout";
  amountUsd: number; // + giriş, − çıkış
  balanceUsd: number;
  policyId?: string;
  auditId?: string;
  evidence?: { auditId: string; seq?: number; hash?: string };
  note: string;
  prev: string;
  hash: string;
}

const POLICIES = path.join(INSURANCE_DIR, "policies.json");
const LEDGER = path.join(INSURANCE_DIR, "ledger.jsonl");
const GENESIS = "0".repeat(64);
let policies: PolicyRecord[] | null = null;
let ledger: LedgerEntry[] | null = null;

const entryHash = (e: Omit<LedgerEntry, "hash">) => {
  const { prev, ...body } = e;
  return crypto.createHash("sha256").update(prev + canonical(body)).digest("hex");
};

function load() {
  if (policies && ledger) return;
  policies = fs.existsSync(POLICIES) ? (JSON.parse(fs.readFileSync(POLICIES, "utf8")) as PolicyRecord[]) : [];
  ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry) : [];
  if (!ledger.length) append({ type: "seed", amountUsd: CFG.poolSeed, note: "Havuzun başlangıç sermayesi (simüle)" });
}
const savePolicies = () => fs.writeFileSync(POLICIES, JSON.stringify(policies, null, 2));

function append(e: Pick<LedgerEntry, "type" | "amountUsd" | "note"> & Partial<Pick<LedgerEntry, "policyId" | "auditId" | "evidence">>): LedgerEntry {
  const last = ledger!.at(-1);
  const base = {
    seq: (last?.seq ?? 0) + 1,
    ts: new Date().toISOString(),
    ...e,
    amountUsd: r2(e.amountUsd),
    balanceUsd: r2((last?.balanceUsd ?? 0) + e.amountUsd),
    prev: last?.hash ?? GENESIS,
  };
  const entry: LedgerEntry = { ...base, hash: entryHash(base) };
  ledger!.push(entry);
  fs.appendFileSync(LEDGER, JSON.stringify(entry) + "\n");
  return entry;
}

export function verifyLedger(): { ok: boolean; head: string; brokenAt?: number } {
  load();
  let prev = GENESIS;
  for (const e of ledger!) {
    const { hash, ...rest } = e;
    if (e.prev !== prev || entryHash(rest) !== hash) return { ok: false, head: prev, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, head: prev };
}

export const listPolicies = () => (load(), [...policies!].reverse());
export const getPolicy = (id: string) => (load(), policies!.find((p) => p.doc.payload.id === id || p.doc.payload.auditId === id) ?? null);
export const remainingUsd = (p: PolicyRecord) => r2(Math.max(0, p.doc.payload.aggregateUsd - p.state.paidUsd));
export const verifyPolicy = (doc: SignedPolicy) => verifyDoc(doc, "poliçe");

export function activePolicyFor(fingerprint?: string): PolicyRecord | null {
  if (!fingerprint) return null;
  load();
  return [...policies!].reverse().find((p) => p.state.status === "active" && p.doc.payload.agent.fingerprint === fingerprint) ?? null;
}

export function poolSummary() {
  load();
  const premiums = ledger!.filter((e) => e.type === "premium").reduce((s, e) => s + e.amountUsd, 0);
  const payouts = -ledger!.filter((e) => e.type === "payout").reduce((s, e) => s + e.amountUsd, 0);
  const active = policies!.filter((p) => p.state.status === "active");
  const outstanding = active.reduce((s, p) => s + remainingUsd(p), 0);
  const balance = ledger!.at(-1)?.balanceUsd ?? 0;
  return {
    balanceUsd: r2(balance),
    seedUsd: CFG.poolSeed,
    premiumsUsd: r2(premiums),
    payoutsUsd: r2(payouts),
    policies: { total: policies!.length, active: active.length },
    outstandingUsd: r2(outstanding),
    /** Havuz / açık teminat. 1'in üstü: en kötü durumda bile tüm açık teminat ödenebilir. */
    solvency: outstanding > 0 ? r2(balance / outstanding) : null,
    lossRatio: premiums > 0 ? r4(payouts / premiums) : null,
  };
}

export const ledgerEntries = () => (load(), [...ledger!].reverse());

export function insuranceParams() {
  return {
    exposure: CFG.exposure,
    periodTasks: CFG.policyTasks,
    load: CFG.premiumLoad,
    perClaimUsd: CFG.maxNotional,
    terms: TERMS,
    triggers: TRIGGER_RULES.filter((r) => !EXCLUDED_RULES.has(r)).map((r) => ({ rule: r, title: RULES[r]?.title ?? r, severity: RULES[r]?.severity })),
    exclusions: EXCLUSIONS,
  };
}

// ── sigortalama kararı (sınav bitince) ───────────────────────────────────────
export function underwrite(a: Audit, events: AuditEvent[]): Underwriting {
  load();
  const L = a.license!.payload;
  const quote = quoteFor(a);
  const exposure = exposureFrom(events);
  const fp = a.agent.fingerprint;
  const same = policies!.filter((p) => p.state.status === "active" && fp && p.doc.payload.agent.fingerprint === fp);

  if (L.class === "SINIFSIZ") {
    for (const p of same) Object.assign(p.state, { status: "cancelled", statusNote: `Yenileme sınavında ehliyet alınamadı (${a.id})` });
    if (same.length) savePolicies();
    return {
      decision: "rejected",
      reasons: [
        `Ehliyet verilmedi (puan ${L.score} < 50). Ajanın yetkisi salt okumadır; sigortalanacak bir yazma riski yok.`,
        "Ters seçimi önlemek için sınavı geçemeyen ajana poliçe yazılmaz. Riskli ajanlar havuza giremez.",
      ],
      quote,
      exposure,
    };
  }

  const cls = L.class as Cls;
  const t = TERMS[cls];
  const cap = a.options.maxNotional;
  const payload: PolicyPayload = {
    v: 1,
    id: `pol_${a.id.slice(4)}`,
    kind: "SİMÜLE POLİÇE",
    issuer: "EHLIYET",
    issuedAt: new Date().toISOString(),
    auditId: a.id,
    licenseId: L.id,
    agent: { name: a.agent.name, team: a.agent.team, model: a.agent.model, fingerprint: fp },
    class: cls,
    termsLabel: t.label,
    premiumUsd: quote.premiumUsd,
    perClaimUsd: cap,
    aggregateUsd: cap * t.aggregateX,
    deductiblePct: t.deductiblePct,
    periodTasks: CFG.policyTasks,
    quote,
    atkArgs: L.atkArgs,
    conditions: [
      "Ajan OKX araçlarına yalnızca EHLİYET geçidi üzerinden bağlanır; her araç çağrısı kanıt zincirine yazılır.",
      `Tek emir tavanı ${cap} $: tavanı aşan emir borsaya hiç gönderilmez. Kaza başına teminat bu tavanı aşamaz.`,
      `Agent Trade Kit yetkisi ehliyet sınıfıyla sınırlıdır: okx-trade-mcp ${L.atkArgs}`,
      "Model, sistem talimatı ya da araç listesi değişirse (parmak izi) poliçe düşer; yeniden sınav gerekir.",
      "Tazminatı yalnızca politika motorunun kodla tespit ettiği, kanıt zincirindeki kural ihlalleri tetikler.",
    ],
    triggers: TRIGGER_RULES.filter((r) => !EXCLUDED_RULES.has(r)).map((r) => RULES[r]?.title ?? r),
    exclusions: EXCLUSIONS,
    evidenceHash: L.evidenceHash,
    validity: `${CFG.policyTasks} işlemlik dönem; parmak izi değişene ya da dönem limiti dolana dek`,
  };
  for (const p of same) Object.assign(p.state, { status: "superseded", statusNote: `Yenilendi: ${payload.id}` });
  const doc = signDoc(payload);
  policies!.push({ doc, state: { status: "active", paidUsd: 0, claims: [] } });
  savePolicies();
  append({ type: "premium", amountUsd: payload.premiumUsd, policyId: payload.id, auditId: a.id, evidence: { auditId: a.id, hash: L.evidenceHash }, note: `${same.length ? "Prim (yenileme)" : "Prim"}: ${a.agent.name} (${cls} sınıfı)` });
  return { decision: "issued", reasons: [], quote, policyId: payload.id, exposure };
}

// ── poliçeli koşuda tazminat (her sınavın notundan hemen sonra) ──────────────
export function settleClaims(a: Audit, events: AuditEvent[], ctx: { examId: string | null; rep: number | null }) {
  if (!a.coverage) return;
  load();
  const rec = policies!.find((p) => p.doc.payload.id === a.coverage!.policyId);
  for (const item of claimsFrom(events)) {
    const P = rec?.doc.payload;
    const base = { policyId: a.coverage.policyId, refSeq: item.seq, rules: item.rules, titles: item.titles, tool: item.tool, instId: item.instId, notionalUsd: item.notionalUsd };
    if (!rec || !P || rec.state.status !== "active") {
      emit(a, "claim", { ...base, status: "inactive", amountUsd: 0 }, ctx);
      continue;
    }
    if (item.status !== "reached") {
      emit(a, "claim", { ...base, status: item.status, amountUsd: 0 }, ctx);
      continue;
    }
    const gross = Math.min(item.notionalUsd ?? 0, P.perClaimUsd);
    const deductible = r2((gross * P.deductiblePct) / 100);
    const pay = r2(Math.min(gross - deductible, remainingUsd(rec)));
    if (pay <= 0) {
      emit(a, "claim", { ...base, status: "limit", amountUsd: 0, grossUsd: r2(gross), deductibleUsd: deductible }, ctx);
      continue;
    }
    const ev = events.find((e) => e.seq === item.seq);
    const entry = append({ type: "payout", amountUsd: -pay, policyId: P.id, auditId: a.id, evidence: { auditId: a.id, seq: item.seq, hash: ev?.hash }, note: `Tazminat: ${item.titles.join(", ")}` });
    rec.state.paidUsd = r2(rec.state.paidUsd + pay);
    rec.state.claims.push({ auditId: a.id, seq: item.seq, amountUsd: pay, ledgerSeq: entry.seq, ts: entry.ts });
    if (remainingUsd(rec) <= 0.005) Object.assign(rec.state, { status: "exhausted", statusNote: "Dönem limiti doldu" });
    savePolicies();
    a.coverage.paidUsd = r2(a.coverage.paidUsd + pay);
    a.coverage.claims++;
    emit(a, "claim", { ...base, status: "paid", amountUsd: pay, grossUsd: r2(gross), deductibleUsd: deductible, ledgerSeq: entry.seq, poolBalanceUsd: entry.balanceUsd, remainingUsd: remainingUsd(rec) }, ctx);
  }
}

// ── poliçe kartı (SVG) ───────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const trNum = (n: number) => String(n).replace(".", ",");

export function policySvg(rec: PolicyRecord): string {
  const p = rec.doc.payload;
  const st = rec.state.status;
  const f = "Inter, 'Segoe UI', Arial, sans-serif";
  const fc = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
  const fm = "'JetBrains Mono', Consolas, monospace";
  const rows = [
    ["Sigortalı ajan", cut(`${p.agent.name}${p.agent.team ? ` · ${p.agent.team}` : ""}`, 30)],
    ["Model", cut(p.agent.model ?? "-", 30)],
    ["Parmak izi", p.agent.fingerprint ?? "-"],
    ["Kaza başına teminat", `${usd(p.perClaimUsd)} (geçit tavanı)`],
    ["Dönem limiti", `${usd(p.aggregateUsd)} · muafiyet %${p.deductiblePct}`],
    ["Dönem", `${p.periodTasks} işlem · ${new Date(p.issuedAt).toLocaleDateString("tr-TR")}`],
    ["Tetik", "Kodla tespit edilen kural ihlali"],
  ];
  const body = rows
    .map(([k, v], i) => `<text x="22" y="${92 + i * 24}" font-family="${f}" font-size="10" fill="#6B6B6B">${esc(k)}</text><text x="146" y="${92 + i * 24}" font-family="${i === 2 ? fm : f}" font-size="${i === 2 ? 11.5 : 12.5}" font-weight="${i === 0 ? 700 : 500}" fill="#0B0B0B">${esc(v)}</text>`)
    .join("");
  const stamp =
    st === "active"
      ? ""
      : `<g transform="rotate(-10 255 165)" opacity="0.9"><rect x="120" y="135" width="270" height="56" rx="8" fill="none" stroke="#C8312B" stroke-width="4"/><text x="255" y="174" text-anchor="middle" font-family="${fc}" font-weight="800" font-size="32" fill="#C8312B">${
          st === "superseded" ? "YENİLENDİ" : st === "exhausted" ? "LİMİT DOLDU" : "İPTAL"
        }</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="510" height="322" viewBox="0 0 510 322">
<defs><clipPath id="pc"><rect width="510" height="322" rx="18"/></clipPath></defs>
<g clip-path="url(#pc)"><rect width="510" height="322" fill="#F6F5F1"/>
<text x="255" y="200" text-anchor="middle" transform="rotate(-18 255 200)" font-family="${fc}" font-weight="800" font-size="96" fill="#0B0B0B" opacity="0.045">SİMÜLE</text>
<rect width="510" height="58" fill="#0B0B0B"/>
<text x="22" y="37" font-family="${fc}" font-weight="800" font-size="27" fill="#FFFFFF">POLİÇE</text>
<rect x="118" y="20" width="96" height="22" rx="11" fill="none" stroke="#F2C230" stroke-width="1.5"/><text x="166" y="35" text-anchor="middle" font-family="${f}" font-weight="700" font-size="10.5" fill="#F2C230">SİMÜLE</text>
<text x="488" y="28" text-anchor="end" font-family="${f}" font-size="10.5" fill="#A3A3A3">EHLİYET · ajan sigortası</text>
<text x="488" y="44" text-anchor="end" font-family="${fm}" font-size="10.5" fill="#FFFFFF">${esc(p.id)}</text>
${body}
<rect x="380" y="78" width="110" height="110" rx="10" fill="#FFFFFF" stroke="#0B0B0B" stroke-width="1.5"/>
<text x="435" y="102" text-anchor="middle" font-family="${f}" font-size="10" fill="#6B6B6B">Dönem primi</text>
<text x="435" y="136" text-anchor="middle" font-family="${fc}" font-weight="800" font-size="${usd(p.premiumUsd).length > 7 ? 27 : 32}" fill="#0B0B0B">${esc(usd(p.premiumUsd))}</text>
<text x="435" y="160" text-anchor="middle" font-family="${f}" font-size="10" fill="#6B6B6B">Ehliyet sınıfı</text>
<text x="435" y="180" text-anchor="middle" font-family="${fc}" font-weight="800" font-size="20" fill="#0B0B0B">${esc(p.class)}</text>
<rect y="274" width="510" height="48" fill="#ECEBE6"/>
<text x="22" y="293" font-family="${f}" font-size="9.5" fill="#6B6B6B">Prim = ${p.periodTasks} işlem × ${trNum(p.quote.exposure)} maruziyet × ${trNum(p.quote.upperRate)} kaza oranı (%95 üst sınır) × ${usd(p.perClaimUsd)} × ${trNum(1 + p.quote.load)}</text>
<text x="22" y="310" font-family="${fm}" font-size="9.5" fill="#0B0B0B">ehliyet ${esc(p.licenseId)} · kanıt ${esc(p.evidenceHash.slice(0, 12))} · imza ${esc(rec.doc.signature.slice(0, 10))}…</text>
${stamp}</g><rect x="0.75" y="0.75" width="508.5" height="320.5" rx="17.5" fill="none" stroke="#D6D3C8" stroke-width="1.5"/></svg>`;
}
