import type { UpstreamKind } from "./config.js";

export type Severity = "critical" | "high" | "medium";
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 3, high: 2, medium: 1 };

export type AuditStatus = "created" | "queued" | "running" | "awaiting_reply" | "done" | "failed" | "cancelled";

export type CandidateConfig =
  | { type: "http"; url: string; format?: "auto" | "openai" | "simple"; headers?: Record<string, string>; model?: string; timeoutMs?: number }
  | { type: "manual" }
  | { type: "claude"; model?: string; systemPrompt?: string; /** Referans profil: "acemi" | "egitimli" (systemPrompt verilmezse) */ profile?: string }
  | { type: "script"; variant: "naive" | "hardened" | "orta" };

export interface AgentInfo {
  name: string;
  team?: string;
  model?: string;
  description?: string;
  /** Model + sistem talimatı + araç listesinin özeti: biri değişirse ehliyet geçersizdir. */
  fingerprint?: string;
}

export interface AuditOptions {
  exams: string[];
  repetitions: number;
  redTeam: boolean;
  upstream: UpstreamKind;
  maxNotional: number;
  lang: "tr" | "en";
}

export interface ExamRunResult {
  examId: string;
  no: number;
  title: string;
  severity: Severity;
  runs: { rep: number; pass: boolean; verdict: string; evidence: string[] }[];
  passRate: number;
  pass: boolean; // tüm tekrarlar geçtiyse
  verdict: string;
  evidence: string[];
}

export interface Violation {
  id: string;
  rule: string;
  title?: string;
  severity: Severity;
  examId: string | null;
  rep: number | null;
  message: string;
  seq: number; // kanıt olayı
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  evidenceSeqs: number[];
  probe: string;
  recommendation?: string;
}

export interface LicensePayload {
  v: 1;
  id: string;
  auditId: string;
  issuer: "EHLIYET";
  issuedAt: string;
  agent: AgentInfo;
  class: "SINIFSIZ" | "A" | "B" | "C";
  label: string;
  meaning: string;
  score: number;
  exams: { passed: number; total: number; full: boolean; repetitions: number };
  violations: { critical: number; high: number; medium: number };
  redTeam: { ran: boolean; findings: number; critical: number };
  atkArgs: string;
  upstream: UpstreamKind;
  evidenceHash: string;
  validity: string;
}

export interface SignedLicense {
  payload: LicensePayload;
  signature: string; // base64 Ed25519
  publicKeyId: string;
}

export interface Audit {
  id: string;
  token: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: AuditStatus;
  agent: AgentInfo;
  candidate: CandidateConfig;
  options: AuditOptions;
  current: { examId: string | null; rep: number | null; title?: string } | null;
  awaiting?: { examId: string; rep: number; message: string; since: string } | null;
  results: ExamRunResult[];
  violations: Violation[];
  findings: Finding[];
  fixes: string[];
  summary?: string;
  license?: SignedLicense;
  evidenceHash?: string;
  error?: string;
  reduced?: string[]; // anahtar yoksa devre dışı kalan özellikler
  /** Sınav sonrası sigorta kararı (simüle): poliçe ya da ret, fiyat dökümü, hasar maruziyeti. */
  insurance?: Underwriting;
  /** Ehliyetin Avalanche kaydı (EhliyetRegistry). */
  chain?: ChainRecord | null;
  /** Bu denetim, aynı parmak izli ajanın aktif poliçesi kapsamında koştuysa. */
  coverage?: { policyId: string; perClaimUsd: number; deductiblePct: number; paidUsd: number; claims: number } | null;
}

export interface ChainRecord {
  network: string;
  chainId: number | null;
  contract: string;
  digest: string;
  status: "pending" | "confirmed" | "failed";
  txHash: string | null;
  block: number | null;
  registeredAt?: string | null;
  explorerUrl?: string | null;
  error?: string;
  note?: string;
  at: string;
}

// ── Sigorta (simüle) ─────────────────────────────────────────────────────────
export interface RiskQuote {
  runs: number; // gözlem: sınav × tekrar
  failures: number;
  pointRate: number; // p̂ = başarısız / toplam
  upperRate: number; // %95 tek yönlü üst sınır (k=0: 1−0,05^(1/n), k>0: Wilson)
  exposure: number; // λ: işlem başına tuzak türü durum olasılığı (varsayım)
  periodTasks: number; // poliçe dönemi (işlem)
  expectedClaimsPoint: number; // dönemde beklenen kaza (nokta tahmini)
  expectedClaims: number; // dönemde beklenen kaza (üst sınırla, fiyatlanan)
  severityUsd: number; // kaza başına en kötü hasar = geçit tavanı
  load: number;
  purePremiumUsd: number;
  premiumUsd: number; // fiyatlanan (muhafazakâr) prim
  premiumPointUsd: number; // nokta tahminle prim (karşılaştırma)
  premiumIf3xUsd: number | null; // aynı başarı oranıyla 3 tekrar yapılsaydı
}

export interface Exposure {
  triggers: number;
  prevented: number;
  preventedUsd: number; // geçidin borsaya göndermediği emirlerin gerçek tutarı
  reached: number;
  reachedUsd: number; // borsaya ulaşan ihlalli emirlerin tutarı
  items: ClaimItem[];
}

export interface ClaimItem {
  seq: number; // ihlalin kanıt olayı
  examId: string | null;
  rep: number | null;
  rules: string[];
  titles: string[];
  tool: string;
  instId?: string;
  notionalUsd: number | null;
  status: "prevented" | "reached" | "no_loss" | "excluded";
}

export interface Underwriting {
  decision: "issued" | "rejected";
  reasons: string[];
  quote: RiskQuote;
  policyId?: string;
  exposure: Exposure;
}

export interface AuditEvent {
  seq: number;
  ts: string;
  auditId: string;
  examId: string | null;
  rep: number | null;
  kind: string;
  data: Record<string, any>;
  prev: string;
  hash: string;
}
