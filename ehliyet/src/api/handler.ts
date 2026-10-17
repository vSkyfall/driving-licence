// HTTP API — herhangi bir siteye entegre edilebilir:
//   - Bağımsız servis: http.createServer(createEhliyetHandler())
//   - Express:          app.use("/ehliyet", createEhliyetHandler({ basePath: "/ehliyet" }))
// Uçların tam listesi: GET /openapi.json
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CFG, ROOT } from "../config.js";
import { bus, getAudit, getEvents, listAudits, verifyChain } from "../store.js";
import { EXAMS, PRESETS } from "../exams/bank.js";
import { cancelAudit, connectionInfo, createAudit, publicBase, startAudit, submitReply } from "../examiner/runner.js";
import { badgeSvg, cardSvg, CLASS_TABLE, mcpConfigFor, publicKeyInfo, verify } from "../license.js";
import { handleMcp } from "../gateway/mcp-http.js";
import { RULES } from "../gateway/policy.js";
import { PROFILES } from "../candidates/profiles.js";
import { chainEnabled, chainStatus, NETWORKS, verifyOnChain } from "../chain/avalanche.js";
import { anchorAudit } from "../chain/anchor.js";
import { getPolicy, insuranceParams, ledgerEntries, listPolicies, policySvg, poolSummary, remainingUsd, verifyLedger, verifyPolicy, type PolicyRecord, type SignedPolicy } from "../insurance.js";
import { openapi } from "./openapi.js";
import { SEVERITY_WEIGHT, type Audit, type AuditEvent, type CandidateConfig, type SignedLicense } from "../types.js";

type Next = (err?: unknown) => void;
export interface HandlerOptions {
  basePath?: string;
}

const PUBLIC = path.join(ROOT, "public");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Site dosyaları (public/). Yalnızca public/ içindeki, uzantısı bilinen dosyalar yayınlanır. */
function serveStatic(p: string, res: ServerResponse): boolean {
  let rel: string;
  try {
    rel = decodeURIComponent(p === "/" ? "/index.html" : p);
  } catch {
    return false;
  }
  const file = path.resolve(PUBLIC, "." + rel);
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.setHeader("cache-control", "no-cache");
  send(res, 200, fs.readFileSync(file), type);
  return true;
}

function send(res: ServerResponse, code: number, body: unknown, type = "application/json; charset=utf-8") {
  if (res.headersSent) return;
  res.writeHead(code, { "content-type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<any> {
  if (req.body !== undefined && req.body !== null && typeof req.body === "object") return req.body; // express.json() önceden çözdüyse
  let s = "";
  for await (const ch of req) {
    s += ch;
    if (s.length > 1_000_000) throw Object.assign(new Error("Gövde çok büyük"), { status: 413 });
  }
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    throw Object.assign(new Error("Geçersiz JSON"), { status: 400 });
  }
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = CFG.corsOrigin === "*" ? "*" : CFG.corsOrigin.split(",").map((s) => s.trim()).includes(String(req.headers.origin)) ? String(req.headers.origin) : "";
  if (origin) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization,mcp-session-id,mcp-protocol-version,last-event-id");
  res.setHeader("access-control-expose-headers", "mcp-session-id");
}

const authorized = (req: IncomingMessage) => !CFG.apiKey || req.headers.authorization === `Bearer ${CFG.apiKey}`;

/** Herkese açık özet (jeton yok) */
export function publicAudit(a: Audit) {
  const { token, ...rest } = a;
  return rest;
}

function leaderboard() {
  return listAudits()
    .filter((a) => a.status === "done" && a.license)
    .map((a) => ({
      auditId: a.id,
      licenseId: a.license!.payload.id,
      agent: a.agent,
      class: a.license!.payload.class,
      score: a.license!.payload.score,
      passed: a.license!.payload.exams.passed,
      total: a.license!.payload.exams.total,
      violations: a.license!.payload.violations,
      findings: a.findings.length,
      failed: a.results.filter((r) => !r.pass).map((r) => ({ no: r.no, title: r.title })),
      finishedAt: a.finishedAt,
      insurance: a.insurance
        ? { decision: a.insurance.decision, policyId: a.insurance.policyId ?? null, premiumUsd: a.insurance.quote.premiumUsd, status: a.insurance.policyId ? getPolicy(a.insurance.policyId)?.state.status ?? null : null }
        : null,
      covered: a.coverage ? { policyId: a.coverage.policyId, paidUsd: a.coverage.paidUsd, claims: a.coverage.claims } : null,
      chain: a.chain ? { status: a.chain.status, txHash: a.chain.txHash, explorerUrl: a.chain.explorerUrl ?? null } : null,
    }))
    .sort((x, y) => y.score - x.score || String(x.finishedAt).localeCompare(String(y.finishedAt)));
}

function policyView(rec: PolicyRecord) {
  return { ...rec.doc, state: rec.state, remainingUsd: remainingUsd(rec) };
}

/** Poliçe dönemi simülasyonu: poliçenin ait olduğu ajan, aynı ayarlarla poliçe kapsamında yeniden çalıştırılır. */
async function simulatePolicy(id: string, pub: string) {
  const rec = getPolicy(id);
  if (!rec) throw Object.assign(new Error("Poliçe bulunamadı"), { status: 404 });
  if (rec.state.status !== "active") throw new Error("Poliçe aktif değil");
  const src = getAudit(rec.doc.payload.auditId);
  if (!src) throw new Error("Poliçenin denetim kaydı bulunamadı");
  const c = src.candidate;
  let candidate: CandidateConfig;
  if (c.type === "script") candidate = { type: "script", variant: c.variant };
  else if (c.type === "claude" && c.profile) candidate = { type: "claude", profile: c.profile, model: c.model };
  else if (c.type === "http" && !c.headers) candidate = { type: "http", url: c.url, format: c.format };
  else if (c.type === "manual") candidate = { type: "manual" };
  else throw new Error("Bu ajanın talimatı ya da başlıkları sunucuda saklanmaz. Aynı ayarlarla yeni sınav açın; parmak izi aynıysa koşu poliçe kapsamına girer.");
  const a = await createAudit({
    agent: { name: src.agent.name, team: src.agent.team, model: src.agent.model },
    candidate,
    exams: src.options.exams,
    repetitions: 1,
    redTeam: false,
    upstream: src.options.upstream,
    maxNotional: src.options.maxNotional,
  });
  if (["script", "claude"].includes(candidate.type)) startAudit(a.id, pub);
  return { ...publicAudit(getAudit(a.id)!), token: a.token, connection: connectionInfo(a, pub) };
}

function findLicense(id: string): SignedLicense | null {
  return auditOfLicense(id)?.license ?? null;
}
const auditOfLicense = (id: string) => listAudits().find((x) => x.id === id || x.license?.payload.id === id);

function sse(req: IncomingMessage, res: ServerResponse, backlog: AuditEvent[], channel: string, filter?: (e: AuditEvent) => boolean) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  const write = (e: AuditEvent) => res.write(`id: ${e.seq}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
  for (const e of backlog) write(e);
  res.write(`event: ready\ndata: {}\n\n`);
  const on = (e: AuditEvent) => (!filter || filter(e)) && write(e);
  bus.on(channel, on);
  const ka = setInterval(() => res.write(": ka\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ka);
    bus.off(channel, on);
  });
}

export function createEhliyetHandler(opts: HandlerOptions = {}) {
  const base = (opts.basePath ?? CFG.basePath).replace(/\/$/, "");
  return async function ehliyet(req: IncomingMessage & { body?: unknown; originalUrl?: string }, res: ServerResponse, next?: Next) {
    const url = new URL(req.originalUrl ?? req.url ?? "/", "http://x");
    let p = url.pathname;
    if (base) {
      if (!p.startsWith(base)) return next ? next() : send(res, 404, { error: "bulunamadı" });
      p = p.slice(base.length) || "/";
    }
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0];
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${CFG.port}`);
    const pub = CFG.publicUrl ? CFG.publicUrl.replace(/\/$/, "") : `${proto}://${host}${base}`;
    const seg = p.split("/").filter(Boolean);

    try {
      // ── MCP geçidi ──
      if (seg[0] === "mcp" && seg[1]) return await handleMcp(req, res, seg[1], req.method === "POST" ? await readBody(req) : undefined);

      if (req.method === "GET") {
        if (p === "/openapi.json") return send(res, 200, openapi(pub));
        if (p === "/v1/health")
          return send(res, 200, {
            ok: true,
            version: "2.0.0",
            upstream: CFG.upstream,
            llm: !!CFG.anthropicKey,
            auth: !!CFG.apiKey,
            maxNotional: CFG.maxNotional,
            models: { examiner: CFG.examinerModel, candidate: CFG.candidateModel },
            atkArgs: CFG.atkArgs.join(" "),
            paceMs: CFG.paceMs,
            chain: { enabled: chainEnabled(), network: CFG.chain, ready: chainEnabled() && !!CFG.chainKey && !!CFG.chainContract, contract: CFG.chainContract || null, explorer: chainEnabled() ? NETWORKS[CFG.chain as keyof typeof NETWORKS].explorer : null },
          });
        if (p === "/v1/profiles") return send(res, 200, PROFILES);
        if (p === "/v1/chain") return send(res, 200, await chainStatus());
        if (p === "/v1/insurance")
          return send(res, 200, { pool: poolSummary(), params: insuranceParams(), chain: verifyLedger(), ledger: ledgerEntries().slice(0, 300), policies: listPolicies().map(policyView) });
        if (p === "/v1/policies") return send(res, 200, listPolicies().map(policyView));
        if (seg[0] === "v1" && seg[1] === "policies" && seg[2]) {
          const rec = getPolicy(seg[2]);
          if (!rec) return send(res, 404, { error: "Poliçe bulunamadı" });
          if (seg[3] === "card.svg") {
            res.setHeader("cache-control", "no-cache");
            return send(res, 200, policySvg(rec), "image/svg+xml; charset=utf-8");
          }
          return send(res, 200, { ...policyView(rec), verification: verifyPolicy(rec.doc) });
        }
        if (p === "/v1/exams")
          return send(res, 200, {
            exams: EXAMS.map(({ grade, setup, vars, prompt, hiddenTruth, canned, policy, ...e }) => ({ ...e, prompt: prompt({ px: "<fiyat>" }) })),
            presets: PRESETS,
            rules: RULES,
            classes: CLASS_TABLE,
            weights: SEVERITY_WEIGHT,
          });
        if (p === "/v1/public-key") return send(res, 200, publicKeyInfo());
        if (p === "/v1/leaderboard") return send(res, 200, leaderboard());
        if (p === "/v1/stream") return sse(req, res, [], "event", (e) => ["status", "exam_result", "license", "created", "policy", "claim", "anchor"].includes(e.kind));
        if (p === "/v1/audits") return send(res, 200, listAudits().map(publicAudit));
        if (seg[0] === "v1" && seg[1] === "audits" && seg[2]) {
          const a = getAudit(seg[2]);
          if (!a) return send(res, 404, { error: "Denetim bulunamadı" });
          if (seg[3] === "events") {
            const since = Number(url.searchParams.get("since") ?? req.headers["last-event-id"] ?? 0);
            const backlog = getEvents(a.id, { since });
            if (String(req.headers.accept).includes("text/event-stream") || url.searchParams.has("stream")) return sse(req, res, backlog, `event:${a.id}`);
            return send(res, 200, backlog);
          }
          if (seg[3] === "evidence") {
            const chain = verifyChain(a.id);
            return send(res, 200, { auditId: a.id, chain, events: getEvents(a.id) });
          }
          return send(res, 200, { ...publicAudit(a), ...(authorized(req) ? { token: a.token, connection: connectionInfo(a, pub) } : {}), atkConfig: a.license ? mcpConfigFor(a.license.payload.atkArgs) : null });
        }
        if (seg[0] === "v1" && seg[1] === "licenses" && seg[2]) {
          const lic = findLicense(seg[2]);
          const owner = auditOfLicense(seg[2]);
          if (seg[3] === "chain") {
            if (!lic) return send(res, 404, { error: "Ehliyet bulunamadı" });
            return send(res, 200, { record: owner?.chain ?? null, verification: await verifyOnChain(lic) });
          }
          if (seg[3] === "badge.svg") {
            res.setHeader("cache-control", "no-cache");
            return send(res, 200, badgeSvg(lic?.payload ?? null), "image/svg+xml; charset=utf-8");
          }
          if (!lic) return send(res, 404, { error: "Ehliyet bulunamadı" });
          if (seg[3] === "card.svg") {
            res.setHeader("cache-control", "no-cache");
            return send(res, 200, cardSvg(lic, owner?.chain), "image/svg+xml; charset=utf-8");
          }
          return send(res, 200, { ...lic, verification: verify(lic), verifyAt: `${pub}/v1/licenses/verify` });
        }
        if (seg[0] !== "v1" && serveStatic(p, res)) return;
        return next ? next() : send(res, 404, { error: "bulunamadı" });
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        if (p === "/v1/licenses/verify") return send(res, 200, verify((body.license ?? body) as SignedLicense));
        if (p === "/v1/policies/verify") return send(res, 200, verifyPolicy((body.policy ?? body) as SignedPolicy));
        if (seg[0] === "v1" && seg[1] === "licenses" && seg[2] && seg[3] === "anchor") {
          if (!authorized(req)) return send(res, 401, { error: "Authorization: Bearer <EHLIYET_API_KEY> gerekli" });
          const a = auditOfLicense(seg[2]);
          if (!a?.license) return send(res, 404, { error: "Ehliyet bulunamadı" });
          if (!chainEnabled() || !CFG.chainKey || !CFG.chainContract) return send(res, 409, { error: "Avalanche kaydı kurulu değil: npm run avalanche:setup" });
          if (a.chain?.status === "confirmed") return send(res, 200, a.chain);
          return send(res, 200, await anchorAudit(a));
        }
        if (!authorized(req)) return send(res, 401, { error: "Authorization: Bearer <EHLIYET_API_KEY> gerekli" });
        if (p === "/v1/audits") {
          const a = await createAudit(body);
          const auto = body.autostart ?? ["script", "claude"].includes(body.candidate?.type);
          if (auto) startAudit(a.id, pub);
          return send(res, 201, { ...publicAudit(getAudit(a.id)!), token: a.token, connection: connectionInfo(a, pub) });
        }
        if (seg[0] === "v1" && seg[1] === "audits" && seg[2]) {
          const id = seg[2];
          if (seg[3] === "start") return send(res, 200, publicAudit(startAudit(id, pub)));
          if (seg[3] === "reply") {
            submitReply(id, String(body.text ?? ""));
            return send(res, 200, { ok: true });
          }
          if (seg[3] === "cancel") return send(res, 200, publicAudit(cancelAudit(id)));
        }
        if (seg[0] === "v1" && seg[1] === "policies" && seg[2] && seg[3] === "simulate") return send(res, 201, await simulatePolicy(seg[2], pub));
        return next ? next() : send(res, 404, { error: "bulunamadı" });
      }
      return next ? next() : send(res, 405, { error: "yöntem desteklenmiyor" });
    } catch (e) {
      const err = e as Error & { status?: number };
      return send(res, err.status ?? 400, { error: err.message });
    }
  };
}

export { publicBase };
