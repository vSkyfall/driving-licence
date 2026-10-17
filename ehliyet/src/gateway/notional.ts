// Bir emir çağrısının GERÇEK dolar karşılığı — borsanın kendi verisiyle (ctVal × fiyat).
// ATK CHANGELOG #114: "100 USDT" → 100 kontrat (~6.700 $) hatasını burada yakalarız.
import type { Exchange } from "../exchange/types.js";
import { parseEnvelope, rows } from "../exchange/envelope.js";

export const ORDER_TOOL = /^(spot|swap|futures|option)_(place_order|batch_orders)$/;
export const ALGO_TOOL = /^(spot|swap|futures|option)_place_algo_order$/;

export interface Notional {
  instId: string;
  usd: number | null;
  basis: string;
  side?: string;
  ordType?: string;
  px?: number | null;
}

async function leverage(ex: Exchange, instId: string, mgnMode: string): Promise<number> {
  try {
    const r = rows(parseEnvelope(await ex.call("swap_get_leverage", { instId, mgnMode: mgnMode || "cross" })));
    const l = Number(r[0]?.lever);
    if (l > 0) return l;
  } catch {
    /* bilinmiyorsa temkinli */
  }
  return 10;
}

export async function computeNotional(ex: Exchange, tool: string, args: Record<string, any>): Promise<Notional[]> {
  const orders: Record<string, any>[] = tool.endsWith("batch_orders") ? (Array.isArray(args.orders) ? args.orders : []) : [args];
  const out: Notional[] = [];
  for (const o of orders) {
    const instId = String(o.instId ?? "").toUpperCase();
    const sz = Number(o.sz);
    const base: { instId: string; side?: string; ordType?: string; px?: number | null } = { instId, side: o.side, ordType: o.ordType };
    if (!instId || !Number.isFinite(sz)) {
      out.push({ ...base, usd: null, basis: "sz/instId okunamadı" });
      continue;
    }
    const tgt = String(o.tgtCcy ?? "");
    const isContract = /-(SWAP|\d{6})$/.test(instId);
    try {
      const px = Number(o.px) > 0 ? Number(o.px) : await ex.lastPrice(instId);
      Object.assign(base, { px });
      if (tgt === "quote_ccy") out.push({ ...base, usd: sz, basis: `tgtCcy=quote_ccy → ${sz} USDT` });
      else if (tgt === "margin") {
        const lev = await leverage(ex, instId, String(o.tdMode ?? "cross"));
        out.push({ ...base, usd: sz * lev, basis: `tgtCcy=margin → ${sz} USDT teminat × ${lev}x kaldıraç` });
      } else if (isContract) {
        const info = await ex.instrument(instId);
        if (!info?.ctVal || !px) out.push({ ...base, usd: null, basis: "ürün ya da fiyat bulunamadı" });
        else out.push({ ...base, usd: sz * info.ctVal * px, basis: `${sz} kontrat × ctVal ${info.ctVal} × fiyat ${px}` });
      } else {
        const marketBuy = String(o.ordType) === "market" && String(o.side) === "buy";
        if (marketBuy && tgt !== "base_ccy") out.push({ ...base, usd: sz, basis: `spot piyasa alımı → ${sz} USDT` });
        else out.push({ ...base, usd: px ? sz * px : null, basis: px ? `${sz} adet × fiyat ${px}` : "fiyat bulunamadı" });
      }
    } catch (e) {
      out.push({ ...base, usd: null, basis: `hesaplanamadı: ${(e as Error).message}` });
    }
  }
  return out;
}
