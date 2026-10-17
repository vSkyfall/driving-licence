// EHLİYET Denetçi — ayarlar. Tüm yollar paketin konumundan hesaplanır.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Basit .env okuyucu (bağımlılık eklememek için)
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (process.argv.includes("--mock")) process.env.EHLIYET_UPSTREAM = "mock";

export type UpstreamKind = "mock" | "hybrid" | "atk";

// Boş değer ("EHLIYET_PORT=") varsayılana düşer; aksi hâlde Number("") = 0 olurdu
const env = (k: string, d = "") => {
  const v = process.env[k];
  return v === undefined || v.trim() === "" ? d : v.trim();
};

export const CFG = {
  dataDir: env("EHLIYET_DATA_DIR", path.join(ROOT, "data")),
  port: Number(env("EHLIYET_PORT", env("PORT", "4747"))),
  host: env("EHLIYET_HOST", "0.0.0.0"),
  /** Dışarıdan erişilen adres (yarışmacılara verilen MCP URL'si bununla kurulur). */
  publicUrl: env("EHLIYET_PUBLIC_URL", ""),
  basePath: env("EHLIYET_BASE_PATH", "").replace(/\/$/, ""),
  /** Boşsa API açık; doluysa POST/DELETE uçları Authorization: Bearer <key> ister. */
  apiKey: env("EHLIYET_API_KEY"),
  corsOrigin: env("EHLIYET_CORS_ORIGIN", "*"),
  webhookUrl: env("EHLIYET_WEBHOOK_URL"),
  webhookSecret: env("EHLIYET_WEBHOOK_SECRET"),
  /** Varsayılan borsa: atk = gerçek OKX demo, hybrid = gerçek OKX fiyatları + sahte emir, mock = tamamen çevrimdışı */
  upstream: env("EHLIYET_UPSTREAM", "hybrid") as UpstreamKind,
  atkArgs: env("EHLIYET_ATK_ARGS", "--profile demo --modules market,spot,swap,account").split(/\s+/).filter(Boolean),
  maxNotional: Number(env("EHLIYET_MAX_NOTIONAL", "200")),
  anthropicKey: env("ANTHROPIC_API_KEY"),
  anthropicBaseUrl: env("ANTHROPIC_BASE_URL"),
  examinerModel: env("EHLIYET_EXAMINER_MODEL", "claude-sonnet-5-5"),
  candidateModel: env("EHLIYET_CANDIDATE_MODEL", "claude-sonnet-5-5"),
  maxConcurrent: Number(env("EHLIYET_MAX_CONCURRENT", "3")),
  /** Sigorta (simüle): her işlemde sınavdaki türden bir durumla karşılaşma olasılığı (varsayım). */
  exposure: Number(env("EHLIYET_EXPOSURE", "0.02")),
  /** Poliçe dönemi: kaç işlem. */
  policyTasks: Number(env("EHLIYET_POLICY_TASKS", "100")),
  /** Sigortacı yükü (maliyet + güvenlik payı). */
  premiumLoad: Number(env("EHLIYET_PREMIUM_LOAD", "0.25")),
  /** Simüle havuzun başlangıç sermayesi (USD). */
  poolSeed: Number(env("EHLIYET_POOL_SEED", "10000")),
  /** Sınav temposu: her sınav en az bu kadar sürer (ms). 12 sınav × 3 sn ≈ 36 sn. 0 = beklemesiz. */
  paceMs: Number(env("EHLIYET_PACE_MS", "3000")),
  /** Blockchain kaydı: off | fuji | mainnet | local */
  chain: env("EHLIYET_CHAIN", "off") as "off" | "fuji" | "mainnet" | "local",
  /** Virgülle ayrılmış RPC adresleri (boşsa ağın varsayılanları denenir). */
  chainRpc: env("EHLIYET_CHAIN_RPC"),
  /** Kayıt cüzdanının özel anahtarı (yalnızca test ağı için; .env dışında tutmayın). */
  chainKey: env("EHLIYET_CHAIN_KEY"),
  /** EhliyetRegistry sözleşme adresi (npm run avalanche:setup yazar). */
  chainContract: env("EHLIYET_CHAIN_CONTRACT"),
  manualTimeoutMs: Number(env("EHLIYET_MANUAL_TIMEOUT_MS", String(15 * 60_000))),
  httpTimeoutMs: Number(env("EHLIYET_HTTP_TIMEOUT_MS", String(180_000))),
};

export const AUDITS_DIR = path.join(CFG.dataDir, "audits");
export const KEYS_DIR = path.join(CFG.dataDir, "keys");
export const INSURANCE_DIR = path.join(CFG.dataDir, "insurance");
fs.mkdirSync(AUDITS_DIR, { recursive: true });
fs.mkdirSync(INSURANCE_DIR, { recursive: true });
fs.mkdirSync(KEYS_DIR, { recursive: true });
