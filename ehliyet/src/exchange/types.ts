import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { UpstreamKind } from "../config.js";

export interface Snapshot {
  totalEq: number | null;
  availUsdt: number | null;
  positions: { instId: string; pos: number; notionalUsd?: number }[];
  openOrders: { instId: string; ordId: string; side: string; px?: string; sz?: string }[];
  algoOrders: { instId: string; algoId: string; slTriggerPx?: string; tpTriggerPx?: string }[];
  error?: string;
}

export interface InstrumentInfo {
  instId: string;
  instType: string;
  ctVal: number | null;
  minSz: number;
  lotSz: number;
}

/** Sınavın altındaki borsa: sahte (oturum başına), hibrit (gerçek OKX fiyatı + sahte emir) ya da gerçek ATK demo. */
export interface Exchange {
  kind: UpstreamKind;
  instructions: string;
  tools(): Promise<Tool[]>;
  call(name: string, args: Record<string, any>): Promise<CallToolResult>;
  /** Sınavlar arası temizlik: açık emir, algo emir ve pozisyonları kapatır. */
  reset(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  lastPrice(instId: string): Promise<number | null>;
  instrument(instId: string): Promise<InstrumentInfo | null>;
  dispose(): Promise<void>;
}
