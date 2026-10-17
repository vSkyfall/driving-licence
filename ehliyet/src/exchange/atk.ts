// GERÇEK OKX Agent Trade Kit bağlantıları.
//  - AtkExchange: --profile demo ile tam ATK. Aynı demo hesap paylaşıldığı için aynı anda yalnızca
//    BİR denetim bu borsayı kullanabilir (atkLock). Diğerleri sıraya girer.
//  - AtkMarketFeed: --modules market (anahtar gerekmez). Hibrit modda sahte borsaya gerçek
//    OKX fiyatlarını ve kontrat büyüklüklerini (ctVal) verir.
import path from "node:path";
import fs from "node:fs";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CFG, ROOT } from "../config.js";
import { ATK_INSTRUCTIONS, parseEnvelope, rows } from "./envelope.js";
import type { MarketFeed } from "./mock.js";
import type { Exchange, InstrumentInfo, Snapshot } from "./types.js";

const ATK_ENTRY = path.join(ROOT, "node_modules", "@okx_ai", "okx-trade-mcp", "dist", "index.js");

export async function spawnAtk(args: string[], name: string): Promise<Client> {
  const cmd = fs.existsSync(ATK_ENTRY) ? { command: process.execPath, args: [ATK_ENTRY, ...args] } : { command: "okx-trade-mcp", args };
  const transport = new StdioClientTransport({ ...cmd, env: { ...(process.env as Record<string, string>) }, stderr: "ignore" });
  const client = new Client({ name, version: "2.0.0" });
  await client.connect(transport);
  return client;
}

// ── Sıra kilidi (paylaşılan demo hesap) ─────────────────────────────────────
let holder: string | null = null;
const waiters: Array<() => void> = [];
export const atkLock = {
  holder: () => holder,
  async acquire(auditId: string) {
    while (holder && holder !== auditId) await new Promise<void>((r) => waiters.push(r));
    holder = auditId;
  },
  release(auditId: string) {
    if (holder !== auditId) return;
    holder = null;
    waiters.shift()?.();
  },
};

// ── Tam ATK ──────────────────────────────────────────────────────────────────
let shared: Promise<Client> | null = null;
function sharedClient() {
  shared ??= spawnAtk(CFG.atkArgs, "ehliyet-atk").catch((e) => {
    shared = null;
    throw e;
  });
  return shared;
}

export class AtkExchange implements Exchange {
  kind = "atk" as const;
  instructions = ATK_INSTRUCTIONS;
  private toolCache: Tool[] | null = null;

  static async create(): Promise<AtkExchange> {
    const x = new AtkExchange();
    const c = await sharedClient();
    x.instructions = c.getInstructions() ?? ATK_INSTRUCTIONS;
    return x;
  }

  async tools() {
    this.toolCache ??= (await (await sharedClient()).listTools()).tools;
    return this.toolCache;
  }

  async call(name: string, args: Record<string, any>): Promise<CallToolResult> {
    return (await (await sharedClient()).callTool({ name, arguments: args })) as CallToolResult;
  }

  private async rows(name: string, args: Record<string, any> = {}) {
    return rows(parseEnvelope(await this.call(name, args)));
  }

  async lastPrice(instId: string) {
    const r = await this.rows("market_get_ticker", { instId }).catch(() => []);
    const px = Number(r[0]?.last);
    return px > 0 ? px : null;
  }

  async instrument(instId: string): Promise<InstrumentInfo | null> {
    const instType = instId.endsWith("-SWAP") ? "SWAP" : /-\d{6}$/.test(instId) ? "FUTURES" : "SPOT";
    const r = await this.rows("market_get_instruments", { instType, instId }).catch(() => []);
    if (!r[0]) return null;
    return { instId, instType, ctVal: r[0].ctVal ? Number(r[0].ctVal) : null, minSz: Number(r[0].minSz) || 0, lotSz: Number(r[0].lotSz) || 0 };
  }

  async snapshot(): Promise<Snapshot> {
    try {
      const bal = (await this.rows("account_get_balance"))[0] ?? {};
      const usdt = (bal.details ?? []).find((d: any) => d.ccy === "USDT");
      const pos = (await this.rows("swap_get_positions")).filter((p) => Number(p.pos) !== 0);
      const ords = await this.rows("swap_get_orders").catch(() => []);
      const algos = await this.rows("swap_get_algo_orders", {}).catch(() => []);
      return {
        totalEq: bal.totalEq ? Number(bal.totalEq) : null,
        availUsdt: usdt ? Number(usdt.availBal) : null,
        positions: pos.map((p) => ({ instId: p.instId, pos: Number(p.pos), notionalUsd: Number(p.notionalUsd) || undefined })),
        openOrders: ords.map((o) => ({ instId: o.instId, ordId: o.ordId, side: o.side, px: o.px, sz: o.sz })),
        algoOrders: algos.map((x) => ({ instId: x.instId, algoId: x.algoId, slTriggerPx: x.slTriggerPx, tpTriggerPx: x.tpTriggerPx })),
      };
    } catch (e) {
      return { totalEq: null, availUsdt: null, positions: [], openOrders: [], algoOrders: [], error: (e as Error).message };
    }
  }

  async reset() {
    const s = await this.snapshot();
    if (s.algoOrders.length) await this.call("swap_cancel_algo_orders", { orders: s.algoOrders.map((a) => ({ algoId: a.algoId, instId: a.instId })) }).catch(() => {});
    for (const o of s.openOrders) await this.call("swap_cancel_order", { instId: o.instId, ordId: o.ordId }).catch(() => {});
    for (const p of await this.rows("swap_get_positions").catch(() => [] as any[])) {
      if (Number(p.pos) === 0) continue;
      await this.call("swap_close_position", { instId: p.instId, mgnMode: p.mgnMode ?? "cross", ...(p.posSide && p.posSide !== "net" ? { posSide: p.posSide } : {}) }).catch(() => {});
    }
  }

  async dispose() {}
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

// ── Hibrit mod: yalnızca piyasa verisi (anahtarsız) ─────────────────────────
export class AtkMarketFeed implements MarketFeed {
  private client: Promise<Client | null>;
  private px = new Map<string, { v: number; t: number }>();
  private inst = new Map<string, InstrumentInfo | null>();
  public healthy = false;

  constructor() {
    this.client = withTimeout(
      spawnAtk(["--modules", "market", "--read-only"], "ehliyet-market").then(async (c) => {
        // Gerçekten OKX'e ulaşabiliyor muyuz?
        const r = rows(parseEnvelope(await c.callTool({ name: "market_get_ticker", arguments: { instId: "BTC-USDT" } })));
        this.healthy = Number(r[0]?.last) > 0;
        if (!this.healthy) await c.close().catch(() => {});
        return this.healthy ? c : null;
      }),
      12_000,
      null,
    );
  }

  ready() {
    return this.client.then((c) => !!c);
  }

  async price(instId: string) {
    const hit = this.px.get(instId);
    if (hit && Date.now() - hit.t < 5000) return hit.v;
    const c = await this.client;
    if (!c) return null;
    const env = await withTimeout(c.callTool({ name: "market_get_ticker", arguments: { instId } }).then(parseEnvelope), 6000, {} as Record<string, any>);
    const v = Number(rows(env)[0]?.last);
    if (!(v > 0)) return null;
    this.px.set(instId, { v, t: Date.now() });
    return v;
  }

  async instrument(instId: string): Promise<InstrumentInfo | null> {
    if (this.inst.has(instId)) return this.inst.get(instId)!;
    const c = await this.client;
    if (!c) return null;
    const instType = instId.endsWith("-SWAP") ? "SWAP" : "SPOT";
    const env = await withTimeout(c.callTool({ name: "market_get_instruments", arguments: { instType, instId } }).then(parseEnvelope), 6000, null as Record<string, any> | null);
    if (!env) return null; // zaman aşımı: önbelleğe yazma
    const r = rows(env);
    const info = r[0] ? { instId, instType, ctVal: r[0].ctVal ? Number(r[0].ctVal) : null, minSz: Number(r[0].minSz) || 0, lotSz: Number(r[0].lotSz) || 0 } : null;
    this.inst.set(instId, info);
    return info;
  }
}

let feed: AtkMarketFeed | null = null;
export function marketFeed(): AtkMarketFeed {
  feed ??= new AtkMarketFeed();
  return feed;
}
