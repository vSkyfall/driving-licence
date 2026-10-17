// Denetim kayıtları ve kanıt zinciri.
// Her olay bir öncekinin özetini taşır (hash zinciri): kayıt sonradan değiştirilirse zincir kırılır.
// Diskte: data/audits/<id>.json (durum) + data/audits/<id>.events.jsonl (kanıt).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { AUDITS_DIR } from "./config.js";
import type { Audit, AuditEvent } from "./types.js";

const GENESIS = "0".repeat(64);
const audits = new Map<string, Audit>();
const events = new Map<string, AuditEvent[]>();
const byToken = new Map<string, string>();
export const bus = new EventEmitter();
bus.setMaxListeners(1000);

const auditFile = (id: string) => path.join(AUDITS_DIR, `${id}.json`);
const eventsFile = (id: string) => path.join(AUDITS_DIR, `${id}.events.jsonl`);

export function hashEvent(e: Omit<AuditEvent, "hash">): string {
  const body = JSON.stringify({ seq: e.seq, ts: e.ts, auditId: e.auditId, examId: e.examId, rep: e.rep, kind: e.kind, data: e.data });
  return crypto.createHash("sha256").update(e.prev + body).digest("hex");
}

export function loadAll() {
  for (const f of fs.readdirSync(AUDITS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(AUDITS_DIR, f), "utf8")) as Audit;
      // Yarıda kalmış denetimler yeniden başlatılmaz
      if (["running", "queued", "awaiting_reply"].includes(a.status)) {
        a.status = "failed";
        a.error = "Sunucu yeniden başlatıldı";
      }
      // Yarıda kalmış zincir kaydı: açılışta yeniden denenir (kayıt tekrarlanmaz, sözleşme özeti bir kez kabul eder)
      if (a.chain?.status === "pending") Object.assign(a.chain, { status: "failed", error: "Sunucu kayıt sırasında yeniden başlatıldı" });
      audits.set(a.id, a);
      byToken.set(a.token, a.id);
      const ef = eventsFile(a.id);
      const list: AuditEvent[] = fs.existsSync(ef)
        ? fs.readFileSync(ef, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
      events.set(a.id, list);
    } catch {
      /* bozuk kayıt: atla */
    }
  }
}

export function saveAudit(a: Audit) {
  audits.set(a.id, a);
  byToken.set(a.token, a.id);
  fs.writeFileSync(auditFile(a.id), JSON.stringify(a, null, 2));
  bus.emit("audit", a);
}

export const getAudit = (id: string) => audits.get(id);
export const getAuditByToken = (token: string) => {
  const id = byToken.get(token);
  return id ? audits.get(id) : undefined;
};
export const listAudits = () => [...audits.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export function emit(audit: Audit, kind: string, data: Record<string, any> = {}, ctx?: { examId?: string | null; rep?: number | null }): AuditEvent {
  const list = events.get(audit.id) ?? [];
  events.set(audit.id, list);
  const last = list.at(-1);
  // Kanıt değişmez olmalı: veriyi kopyala (sonradan değişen nesnelere referans tutma)
  data = JSON.parse(JSON.stringify(data ?? {}));
  const base = {
    seq: (last?.seq ?? 0) + 1,
    ts: new Date().toISOString(),
    auditId: audit.id,
    examId: ctx?.examId !== undefined ? ctx.examId : audit.current?.examId ?? null,
    rep: ctx?.rep !== undefined ? ctx.rep : audit.current?.rep ?? null,
    kind,
    data,
    prev: last?.hash ?? GENESIS,
  };
  const e: AuditEvent = { ...base, hash: hashEvent(base) };
  list.push(e);
  fs.appendFileSync(eventsFile(audit.id), JSON.stringify(e) + "\n");
  bus.emit(`event:${audit.id}`, e);
  bus.emit("event", e);
  return e;
}

export function getEvents(auditId: string, filter?: { since?: number; examId?: string; rep?: number }): AuditEvent[] {
  const list = events.get(auditId) ?? [];
  return list.filter(
    (e) =>
      (filter?.since === undefined || e.seq > filter.since) &&
      (filter?.examId === undefined || e.examId === filter.examId) &&
      (filter?.rep === undefined || e.rep === filter.rep),
  );
}

/** Zinciri baştan doğrular; son özet ehliyete yazılır. */
export function verifyChain(auditId: string): { ok: boolean; head: string; brokenAt?: number } {
  let prev = GENESIS;
  for (const e of events.get(auditId) ?? []) {
    const { hash, ...rest } = e;
    if (e.prev !== prev || hashEvent(rest) !== hash) return { ok: false, head: prev, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, head: prev };
}

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}
