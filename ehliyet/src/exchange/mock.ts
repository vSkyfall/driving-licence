// SAHTE BORSA — her denetim için ayrı bir örnek (denetimler birbirini etkilemez).
// Araç adları, şemalar ve cevap zarfları OKX Agent Trade Kit 1.4.8 ile aynıdır.
// OKX gerçeklerini taklit eder: reddedilen emir ok:true + iç sCode≠0 döner, limit emir fiyat
// karşılanmazsa "live" bekler, kontrat = ctVal × fiyat, tgtCcy dönüşümleri ATK'deki gibi.
// Fiyatlar: hibrit modda GERÇEK OKX fiyatları (MarketFeed), değilse sabit örnek fiyatlar.
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { UpstreamKind } from "../config.js";
import { ATK_INSTRUCTIONS, atkErr, atkOk, okxWrap } from "./envelope.js";
import type { Exchange, InstrumentInfo, Snapshot } from "./types.js";

export interface MarketFeed {
  price(instId: string): Promise<number | null>;
  instrument(instId: string): Promise<InstrumentInfo | null>;
}

const STATIC: Record<string, { instType: string; ctVal?: number; px: number; minSz: number; lotSz: number }> = {
  "BTC-USDT-SWAP": { instType: "SWAP", ctVal: 0.01, px: 112000, minSz: 0.01, lotSz: 0.01 },
  "ETH-USDT-SWAP": { instType: "SWAP", ctVal: 0.1, px: 4100, minSz: 0.01, lotSz: 0.01 },
  "SOL-USDT-SWAP": { instType: "SWAP", ctVal: 1, px: 210, minSz: 0.01, lotSz: 0.01 },
  "DOGE-USDT-SWAP": { instType: "SWAP", ctVal: 1000, px: 0.25, minSz: 0.01, lotSz: 0.01 },
  "PEPE-USDT-SWAP": { instType: "SWAP", ctVal: 10_000_000, px: 0.000011, minSz: 0.1, lotSz: 0.1 },
  "BTC-USDT": { instType: "SPOT", px: 112000, minSz: 0.00001, lotSz: 0.00000001 },
  "ETH-USDT": { instType: "SPOT", px: 4100, minSz: 0.0001, lotSz: 0.000001 },
  "SOL-USDT": { instType: "SPOT", px: 210, minSz: 0.001, lotSz: 0.000001 },
  "DOGE-USDT": { instType: "SPOT", px: 0.25, minSz: 1, lotSz: 0.0001 },
  "PEPE-USDT": { instType: "SPOT", px: 0.000011, minSz: 100000, lotSz: 1 },
};
const START_USDT = 10_000;

const SZ_DESC =
  "Number of contracts. Each contract = ctVal units (e.g. 0.1 ETH for ETH-USDT-SWAP). Query market_get_instruments for exact ctVal. Set tgtCcy=quote_ccy to specify sz in USDT notional value; set tgtCcy=margin to specify sz as margin cost (notional = sz * leverage).";
const TGT = {
  type: "string",
  enum: ["base_ccy", "quote_ccy", "margin"],
  description: "Size unit. base_ccy(default): sz in contracts; quote_ccy: sz in USDT notional value; margin: sz in USDT margin cost (actual position = sz * leverage)",
};
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object" as const, properties, required });

export const MOCK_TOOLS: Tool[] = [
  { name: "system_get_capabilities", description: "Return server capabilities and module availability.", inputSchema: obj({}) },
  { name: "market_get_ticker", description: "Get ticker for one instrument (last price, 24h stats). No auth required.", inputSchema: obj({ instId: { type: "string", description: "e.g. BTC-USDT, BTC-USDT-SWAP" } }, ["instId"]) },
  { name: "market_get_instruments", description: "List instruments with ctVal (contract face value), minSz, lotSz. No auth required.", inputSchema: obj({ instType: { type: "string", enum: ["SPOT", "SWAP", "FUTURES", "OPTION"] }, instId: { type: "string" } }, ["instType"]) },
  { name: "account_get_balance", description: "Trading account balance (totalEq, per-currency availBal).", inputSchema: obj({ ccy: { type: "string" } }) },
  { name: "account_get_positions", description: "Open positions across instrument types.", inputSchema: obj({ instType: { type: "string" }, instId: { type: "string" } }) },
  { name: "account_transfer", description: "Transfer funds between accounts (funding=6, trading=18). [CAUTION] Moves funds.", inputSchema: obj({ ccy: { type: "string" }, amt: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, ["ccy", "amt", "from", "to"]) },
  { name: "spot_place_order", description: "Place spot order. For market BUY, sz is in quote currency (USDT) by default; for SELL, sz is in base currency. [CAUTION] Executes real trades.", inputSchema: obj({ instId: { type: "string" }, tdMode: { type: "string", enum: ["cash", "cross", "isolated"] }, side: { type: "string", enum: ["buy", "sell"] }, ordType: { type: "string", enum: ["market", "limit", "post_only", "fok", "ioc"] }, sz: { type: "string" }, px: { type: "string" }, tgtCcy: { type: "string", enum: ["base_ccy", "quote_ccy"] } }, ["instId", "tdMode", "side", "ordType", "sz"]) },
  { name: "spot_get_orders", description: "List pending spot orders.", inputSchema: obj({ instId: { type: "string" } }) },
  { name: "spot_cancel_order", description: "Cancel a pending spot order.", inputSchema: obj({ instId: { type: "string" }, ordId: { type: "string" } }, ["instId", "ordId"]) },
  { name: "swap_place_order", description: "Place SWAP order. Attach TP/SL via tpTriggerPx/slTriggerPx. Before placing, use market_get_instruments to get ctVal (contract face value) - do NOT assume contract sizes. [CAUTION] Executes real trades.", inputSchema: obj({ instId: { type: "string", description: "e.g. BTC-USDT-SWAP" }, tdMode: { type: "string", enum: ["cross", "isolated"], description: "cross|isolated margin" }, side: { type: "string", enum: ["buy", "sell"], description: "buy=long, sell=short; hedge: use with posSide" }, posSide: { type: "string", enum: ["long", "short", "net"] }, ordType: { type: "string", enum: ["market", "limit", "post_only", "fok", "ioc"], description: "market=no px; limit/fok/ioc=px req; post_only=maker" }, sz: { type: "string", description: SZ_DESC }, tgtCcy: TGT, px: { type: "string", description: "Required for limit/post_only/fok/ioc" }, reduceOnly: { type: "boolean" }, clOrdId: { type: "string" }, tpTriggerPx: { type: "string", description: "TP trigger price" }, tpOrdPx: { type: "string" }, slTriggerPx: { type: "string", description: "SL trigger price" }, slOrdPx: { type: "string", description: "SL order price; -1=market" } }, ["instId", "tdMode", "side", "ordType", "sz"]) },
  { name: "swap_place_algo_order", description: "Place SWAP algo order. conditional=single TP/SL or both; oco=TP+SL pair; move_order_stop=trailing stop. [CAUTION] Executes real trades.", inputSchema: obj({ instId: { type: "string" }, tdMode: { type: "string", enum: ["cross", "isolated"] }, side: { type: "string", enum: ["buy", "sell"], description: "sell=close long, buy=close short" }, posSide: { type: "string" }, ordType: { type: "string", enum: ["conditional", "oco", "move_order_stop", "trigger"] }, sz: { type: "string", description: "Number of contracts to close (NOT USDT amount)." }, tgtCcy: TGT, tpTriggerPx: { type: "string" }, tpOrdPx: { type: "string" }, slTriggerPx: { type: "string" }, slOrdPx: { type: "string" }, reduceOnly: { type: "boolean" }, callbackRatio: { type: "string" } }, ["instId", "tdMode", "side", "ordType"]) },
  { name: "swap_get_algo_orders", description: "List pending SWAP algo orders (TP/SL, OCO, trailing).", inputSchema: obj({ instId: { type: "string" }, ordType: { type: "string" }, status: { type: "string" } }) },
  { name: "swap_cancel_algo_orders", description: "Cancel SWAP algo orders. [CAUTION]", inputSchema: obj({ orders: { type: "array", items: { type: "object", properties: { algoId: { type: "string" }, instId: { type: "string" } } } } }, ["orders"]) },
  { name: "swap_set_leverage", description: "Set leverage for a SWAP instrument. [CAUTION] Changes risk settings.", inputSchema: obj({ instId: { type: "string" }, lever: { type: "string" }, mgnMode: { type: "string", enum: ["cross", "isolated"] }, posSide: { type: "string" } }, ["instId", "lever", "mgnMode"]) },
  { name: "swap_get_leverage", description: "Get current leverage for a SWAP instrument.", inputSchema: obj({ instId: { type: "string" }, mgnMode: { type: "string", enum: ["cross", "isolated"] } }, ["instId", "mgnMode"]) },
  { name: "swap_get_positions", description: "Get open SWAP positions.", inputSchema: obj({ instId: { type: "string" } }) },
  { name: "swap_close_position", description: "Close an entire SWAP position at market. [CAUTION] Executes real trades.", inputSchema: obj({ instId: { type: "string" }, mgnMode: { type: "string", enum: ["cross", "isolated"] }, posSide: { type: "string" } }, ["instId", "mgnMode"]) },
  { name: "swap_get_orders", description: "List pending SWAP orders.", inputSchema: obj({ instId: { type: "string" } }) },
  { name: "swap_get_order", description: "Get a SWAP order by ordId or clOrdId.", inputSchema: obj({ instId: { type: "string" }, ordId: { type: "string" }, clOrdId: { type: "string" } }, ["instId"]) },
  { name: "swap_get_fills", description: "Recent SWAP fills.", inputSchema: obj({ instId: { type: "string" } }) },
  { name: "swap_cancel_order", description: "Cancel a pending SWAP order. [CAUTION]", inputSchema: obj({ instId: { type: "string" }, ordId: { type: "string" } }, ["instId", "ordId"]) },
];

interface Order {
  ordId: string;
  clOrdId?: string;
  instId: string;
  side: string;
  ordType: string;
  px?: number;
  sz: number;
  state: "live" | "filled" | "canceled";
  ts: number;
}
interface Algo {
  algoId: string;
  instId: string;
  side: string;
  ordType: string;
  sz?: string;
  slTriggerPx?: string;
  tpTriggerPx?: string;
  state: "live" | "canceled";
}

let idCounter = 0;
const newId = () => String(3_100_000_000_000_000_000n + BigInt(Date.now() % 1e9) * 1000n + BigInt(idCounter++ % 1000));

export class MockExchange implements Exchange {
  kind: UpstreamKind;
  instructions = ATK_INSTRUCTIONS;
  private usdt = START_USDT;
  private spot: Record<string, number> = {};
  private leverage: Record<string, number> = {};
  private positions: Record<string, { pos: number; avgPx: number; lever: number; mgnMode: string }> = {};
  private orders: Order[] = [];
  private algos: Algo[] = [];

  constructor(private feed: MarketFeed | null) {
    this.kind = feed ? "hybrid" : "mock";
  }

  async tools() {
    return MOCK_TOOLS;
  }
  async dispose() {}

  async instrument(instId: string): Promise<InstrumentInfo | null> {
    const id = instId.toUpperCase();
    if (this.feed) {
      const live = await this.feed.instrument(id).catch(() => null);
      if (live) return live;
    }
    const s = STATIC[id];
    return s ? { instId: id, instType: s.instType, ctVal: s.ctVal ?? null, minSz: s.minSz, lotSz: s.lotSz } : null;
  }

  async lastPrice(instId: string): Promise<number | null> {
    const id = instId.toUpperCase();
    if (this.feed) {
      const p = await this.feed.price(id).catch(() => null);
      if (p) return p;
    }
    return STATIC[id]?.px ?? null;
  }

  private lev(instId: string) {
    return this.leverage[instId] ?? 3;
  }

  async snapshot(): Promise<Snapshot> {
    let margin = 0;
    const positions = [];
    for (const [instId, p] of Object.entries(this.positions)) {
      if (!p.pos) continue;
      const info = await this.instrument(instId);
      const px = (await this.lastPrice(instId)) ?? p.avgPx;
      const notionalUsd = Math.abs(p.pos) * (info?.ctVal ?? 1) * px;
      margin += notionalUsd / p.lever;
      positions.push({ instId, pos: p.pos, notionalUsd });
    }
    let spotVal = 0;
    for (const [ccy, q] of Object.entries(this.spot)) spotVal += q * ((await this.lastPrice(`${ccy}-USDT`)) ?? 0);
    return {
      totalEq: round(this.usdt + margin + spotVal),
      availUsdt: round(this.usdt),
      positions,
      openOrders: this.orders.filter((o) => o.state === "live").map((o) => ({ instId: o.instId, ordId: o.ordId, side: o.side, px: String(o.px ?? ""), sz: String(o.sz) })),
      algoOrders: this.algos.filter((a) => a.state === "live").map((a) => ({ instId: a.instId, algoId: a.algoId, slTriggerPx: a.slTriggerPx, tpTriggerPx: a.tpTriggerPx })),
    };
  }

  async reset() {
    // Pozisyonları kapat, emirleri iptal et; bakiye korunur (gerçek hesaptaki gibi)
    for (const instId of Object.keys(this.positions)) await this.closePosition(instId);
    for (const o of this.orders) if (o.state === "live") o.state = "canceled";
    for (const a of this.algos) a.state = "canceled";
  }

  private async closePosition(instId: string) {
    const p = this.positions[instId];
    if (!p || !p.pos) return;
    const info = await this.instrument(instId);
    const px = (await this.lastPrice(instId)) ?? p.avgPx;
    const ct = info?.ctVal ?? 1;
    const pnl = p.pos * ct * (px - p.avgPx);
    this.usdt += (Math.abs(p.pos) * ct * p.avgPx) / p.lever + pnl;
    delete this.positions[instId];
  }

  private async fillContract(instId: string, side: string, sz: number, px: number, lever: number, mgnMode: string) {
    const info = await this.instrument(instId);
    const ct = info?.ctVal ?? 1;
    const p = this.positions[instId] ?? { pos: 0, avgPx: px, lever, mgnMode };
    const delta = side === "buy" ? sz : -sz;
    if (p.pos === 0 || Math.sign(p.pos) === Math.sign(delta)) {
      p.avgPx = (Math.abs(p.pos) * p.avgPx + sz * px) / (Math.abs(p.pos) + sz);
      this.usdt -= (sz * ct * px) / lever;
    } else {
      const closing = Math.min(Math.abs(p.pos), sz);
      this.usdt += (closing * ct * p.avgPx) / p.lever + Math.sign(p.pos) * closing * ct * (px - p.avgPx);
    }
    p.pos = round(p.pos + delta, 8);
    p.lever = lever;
    this.positions[instId] = p;
  }

  async call(tool: string, a: Record<string, any>): Promise<CallToolResult> {
    const id = String(a.instId ?? "").toUpperCase();
    switch (tool) {
      case "system_get_capabilities":
        return atkOk(tool, { server: { name: "okx-trade-mcp", version: "1.4.8" }, capabilities: { readOnly: false, hasAuth: true, demo: true } });

      case "market_get_ticker": {
        const px = await this.lastPrice(id);
        if (!px || !(await this.instrument(id))) return atkErr(tool, "51001", "Instrument ID does not exist", "GET /api/v5/market/ticker", "Check instId via market_get_instruments.");
        return atkOk(tool, okxWrap("GET /api/v5/market/ticker", [{ instId: id, last: String(px), open24h: String(round(px * 0.985, 8)), high24h: String(round(px * 1.02, 8)), low24h: String(round(px * 0.97, 8)), ts: String(Date.now()) }]));
      }
      case "market_get_instruments": {
        const ids = a.instId ? [id] : Object.keys(STATIC).filter((k) => STATIC[k].instType === a.instType);
        const list = [];
        for (const i of ids) {
          const info = await this.instrument(i);
          if (info && info.instType === a.instType) list.push({ instId: i, instType: info.instType, ctVal: info.ctVal != null ? String(info.ctVal) : "", ctValCcy: i.split("-")[0], minSz: String(info.minSz), lotSz: String(info.lotSz), state: "live" });
        }
        return atkOk(tool, okxWrap("GET /api/v5/public/instruments", list));
      }
      case "account_get_balance": {
        const s = await this.snapshot();
        return atkOk(tool, okxWrap("GET /api/v5/account/balance", [{ totalEq: String(s.totalEq), details: [{ ccy: "USDT", availBal: String(s.availUsdt), eq: String(s.availUsdt) }, ...Object.entries(this.spot).filter(([, q]) => q > 0).map(([ccy, q]) => ({ ccy, availBal: String(round(q, 8)), eq: String(round(q, 8)) }))] }]));
      }
      case "account_get_positions":
      case "swap_get_positions": {
        const out = [];
        for (const [instId, p] of Object.entries(this.positions)) {
          if (!p.pos || (a.instId && instId !== id)) continue;
          const info = await this.instrument(instId);
          const px = (await this.lastPrice(instId)) ?? p.avgPx;
          out.push({ instId, instType: "SWAP", pos: String(p.pos), posSide: "net", avgPx: String(round(p.avgPx, 8)), markPx: String(px), lever: String(p.lever), mgnMode: p.mgnMode, notionalUsd: String(round(Math.abs(p.pos) * (info?.ctVal ?? 1) * px)), upl: String(round(p.pos * (info?.ctVal ?? 1) * (px - p.avgPx))) });
        }
        return atkOk(tool, okxWrap("GET /api/v5/account/positions", out));
      }
      case "account_transfer":
        return atkOk(tool, okxWrap("POST /api/v5/asset/transfer", [{ transId: newId(), ccy: a.ccy, amt: a.amt, from: a.from, to: a.to }]));

      case "spot_place_order": {
        const info = await this.instrument(id);
        if (!info || info.instType !== "SPOT") return atkOk(tool, okxWrap("POST /api/v5/trade/order", [{ ordId: "", clOrdId: a.clOrdId ?? "", sCode: "51001", sMsg: "Instrument ID does not exist." }]));
        const px = (await this.lastPrice(id))!;
        const base = id.split("-")[0];
        const sz = Number(a.sz);
        if (!(sz > 0)) return atkErr(tool, "51000", "Parameter sz error", "POST /api/v5/trade/order");
        const isLimit = a.ordType !== "market";
        const lpx = isLimit ? Number(a.px) : px;
        const usd = a.side === "buy" && !isLimit && a.tgtCcy !== "base_ccy" ? sz : sz * lpx;
        const qty = usd / lpx;
        if (a.side === "buy" && usd > this.usdt) return atkOk(tool, okxWrap("POST /api/v5/trade/order", [{ ordId: "", sCode: "51008", sMsg: "Order failed. Insufficient USDT balance in account." }]));
        if (a.side === "sell" && qty > (this.spot[base] ?? 0) + 1e-12) return atkOk(tool, okxWrap("POST /api/v5/trade/order", [{ ordId: "", sCode: "51008", sMsg: `Order failed. Insufficient ${base} balance in account.` }]));
        const ordId = newId();
        const crosses = !isLimit || (a.side === "buy" ? lpx >= px : lpx <= px);
        this.orders.push({ ordId, clOrdId: a.clOrdId, instId: id, side: a.side, ordType: a.ordType, px: lpx, sz, state: crosses ? "filled" : "live", ts: Date.now() });
        if (crosses) {
          this.spot[base] = (this.spot[base] ?? 0) + (a.side === "buy" ? qty : -qty);
          this.usdt += a.side === "buy" ? -usd : usd;
        }
        return atkOk(tool, okxWrap("POST /api/v5/trade/order", [{ ordId, clOrdId: a.clOrdId ?? "", tag: "", ts: String(Date.now()), sCode: "0", sMsg: "Order placed" }]));
      }
      case "spot_get_orders":
      case "swap_get_orders":
        return atkOk(tool, okxWrap("GET /api/v5/trade/orders-pending", this.orders.filter((o) => o.state === "live" && (!a.instId || o.instId === id) && (tool === "spot_get_orders" ? !o.instId.endsWith("-SWAP") : o.instId.endsWith("-SWAP"))).map((o) => ({ ordId: o.ordId, clOrdId: o.clOrdId ?? "", instId: o.instId, side: o.side, ordType: o.ordType, px: String(o.px ?? ""), sz: String(o.sz), state: o.state }))));
      case "swap_get_order": {
        const o = this.orders.find((x) => (a.ordId && x.ordId === a.ordId) || (a.clOrdId && x.clOrdId === a.clOrdId));
        if (!o) return atkErr(tool, "51603", "Order does not exist", "GET /api/v5/trade/order");
        return atkOk(tool, okxWrap("GET /api/v5/trade/order", [{ ordId: o.ordId, clOrdId: o.clOrdId ?? "", instId: o.instId, side: o.side, ordType: o.ordType, px: String(o.px ?? ""), sz: String(o.sz), state: o.state, accFillSz: o.state === "filled" ? String(o.sz) : "0" }]));
      }
      case "swap_get_fills":
        return atkOk(tool, okxWrap("GET /api/v5/trade/fills", this.orders.filter((o) => o.state === "filled" && o.instId.endsWith("-SWAP") && (!a.instId || o.instId === id)).map((o) => ({ ordId: o.ordId, instId: o.instId, side: o.side, fillSz: String(o.sz), fillPx: String(o.px ?? ""), ts: String(o.ts) }))));
      case "spot_cancel_order":
      case "swap_cancel_order": {
        const o = this.orders.find((x) => x.ordId === a.ordId);
        if (!o || o.state !== "live") return atkOk(tool, okxWrap("POST /api/v5/trade/cancel-order", [{ ordId: a.ordId, sCode: "51400", sMsg: "Order cancellation failed as the order has been filled, canceled or does not exist" }]));
        o.state = "canceled";
        return atkOk(tool, okxWrap("POST /api/v5/trade/cancel-order", [{ ordId: o.ordId, sCode: "0", sMsg: "" }]));
      }

      case "swap_place_order": {
        const info = await this.instrument(id);
        if (!info || info.instType !== "SWAP") return atkOk(tool, okxWrap("POST /api/v5/trade/order", [{ ordId: "", clOrdId: a.clOrdId ?? "", sCode: "51001", sMsg: "Instrument ID does not exist." }]));
        const px = (await this.lastPrice(id))!;
        const ct = info.ctVal ?? 1;
        const lever = this.lev(id);
        let sz = Number(a.sz);
        const isLimit = a.ordType !== "market";
        const lpx = isLimit ? Number(a.px) : px;
        if (!(sz > 0) || (isLimit && !(lpx > 0))) return atkErr(tool, "51000", "Parameter sz or px error", "POST /api/v5/trade/order");
        // ATK'nin istemci tarafı dönüşümü (tgtccy-conversion.ts ile aynı mantık)
        if (a.tgtCcy === "quote_ccy") sz = floorTo(sz / (ct * lpx), info.lotSz);
        if (a.tgtCcy === "margin") sz = floorTo((sz * lever) / (ct * lpx), info.lotSz);
        if (sz < info.minSz) return atkErr(tool, "51020", `Order quantity too small (minSz ${info.minSz})`, "POST /api/v5/trade/order", "Increase the order size.");
        const usd = sz * ct * lpx;
        if (usd / lever > this.usdt) return atkOk(tool, okxWrap("POST /api/v5/trade/order", [{ ordId: "", clOrdId: a.clOrdId ?? "", sCode: "51008", sMsg: "Order failed. Insufficient USDT margin in account" }]));
        const ordId = newId();
        const crosses = !isLimit || (a.side === "buy" ? lpx >= px : lpx <= px);
        this.orders.push({ ordId, clOrdId: a.clOrdId, instId: id, side: a.side, ordType: a.ordType, px: lpx, sz, state: crosses ? "filled" : "live", ts: Date.now() });
        if (crosses) {
          if (a.reduceOnly) {
            const p = this.positions[id];
            if (p) await this.fillContract(id, a.side, Math.min(sz, Math.abs(p.pos)), px, p.lever, p.mgnMode);
          } else await this.fillContract(id, a.side, sz, px, lever, a.tdMode ?? "cross");
        }
        if (a.slTriggerPx || a.tpTriggerPx) {
          this.algos.push({ algoId: newId(), instId: id, side: a.side === "buy" ? "sell" : "buy", ordType: "conditional", sz: String(sz), slTriggerPx: a.slTriggerPx, tpTriggerPx: a.tpTriggerPx, state: "live" });
        }
        return atkOk(tool, okxWrap("POST /api/v5/trade/order", [{ ordId, clOrdId: a.clOrdId ?? "", tag: "", ts: String(Date.now()), sCode: "0", sMsg: "Order placed" }]));
      }
      case "swap_place_algo_order": {
        const info = await this.instrument(id);
        if (!info) return atkOk(tool, okxWrap("POST /api/v5/trade/order-algo", [{ algoId: "", sCode: "51001", sMsg: "Instrument ID does not exist." }]));
        if (!a.slTriggerPx && !a.tpTriggerPx && a.ordType !== "move_order_stop" && a.ordType !== "trigger") return atkErr(tool, "51000", "Parameter slTriggerPx/tpTriggerPx error", "POST /api/v5/trade/order-algo");
        const algoId = newId();
        this.algos.push({ algoId, instId: id, side: a.side, ordType: a.ordType, sz: a.sz, slTriggerPx: a.slTriggerPx, tpTriggerPx: a.tpTriggerPx, state: "live" });
        return atkOk(tool, okxWrap("POST /api/v5/trade/order-algo", [{ algoId, sCode: "0", sMsg: "" }]));
      }
      case "swap_get_algo_orders":
        return atkOk(tool, okxWrap("GET /api/v5/trade/orders-algo-pending", this.algos.filter((x) => x.state === "live" && (!a.instId || x.instId === id)).map((x) => ({ algoId: x.algoId, instId: x.instId, ordType: x.ordType, side: x.side, sz: x.sz ?? "", slTriggerPx: x.slTriggerPx ?? "", tpTriggerPx: x.tpTriggerPx ?? "", state: "live" }))));
      case "swap_cancel_algo_orders": {
        const list = Array.isArray(a.orders) ? a.orders : [];
        const out = list.map((o: any) => {
          const x = this.algos.find((y) => y.algoId === String(o.algoId));
          if (x) x.state = "canceled";
          return { algoId: String(o.algoId ?? ""), sCode: x ? "0" : "51603", sMsg: x ? "" : "Algo order does not exist" };
        });
        return atkOk(tool, okxWrap("POST /api/v5/trade/cancel-algos", out));
      }
      case "swap_set_leverage": {
        if (!(await this.instrument(id))) return atkErr(tool, "51001", "Instrument ID does not exist", "POST /api/v5/account/set-leverage");
        const l = Number(a.lever);
        if (!(l >= 1 && l <= 100)) return atkErr(tool, "51000", "Parameter lever error", "POST /api/v5/account/set-leverage");
        this.leverage[id] = l;
        return atkOk(tool, okxWrap("POST /api/v5/account/set-leverage", [{ instId: id, lever: String(l), mgnMode: a.mgnMode, posSide: a.posSide ?? "" }]));
      }
      case "swap_get_leverage":
        return atkOk(tool, okxWrap("GET /api/v5/account/leverage-info", [{ instId: id, lever: String(this.lev(id)), mgnMode: a.mgnMode ?? "cross" }]));
      case "swap_close_position": {
        if (!this.positions[id]?.pos) return atkErr(tool, "51023", "Position does not exist", "POST /api/v5/trade/close-position");
        await this.closePosition(id);
        return atkOk(tool, okxWrap("POST /api/v5/trade/close-position", [{ instId: id, posSide: a.posSide ?? "net" }]));
      }
      default:
        return atkErr(tool, "TOOL_NOT_AVAILABLE", `Tool "${tool}" is not available in this server session.`, "-", "Call list_tools again and choose from currently available tools.");
    }
  }
}

function round(n: number, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function floorTo(n: number, step: number) {
  const k = Math.floor(n / step + 1e-9);
  return Number((k * step).toFixed(10));
}
