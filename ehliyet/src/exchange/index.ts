import type { UpstreamKind } from "../config.js";
import { AtkExchange, marketFeed } from "./atk.js";
import { MockExchange } from "./mock.js";
import type { Exchange } from "./types.js";

export async function createExchange(kind: UpstreamKind): Promise<{ ex: Exchange; note?: string }> {
  if (kind === "atk") return { ex: await AtkExchange.create() };
  if (kind === "hybrid") {
    const f = marketFeed();
    if (await f.ready()) return { ex: new MockExchange(f) };
    return { ex: new MockExchange(null), note: "OKX piyasa verisine ulaşılamadı; sabit örnek fiyatlarla devam ediliyor (mock)." };
  }
  return { ex: new MockExchange(null) };
}

export type { Exchange } from "./types.js";
