// Hibrit mod OKX'e ulaşamazsa takılmadan sahte fiyatlara düşmeli.
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
process.env.EHLIYET_PACE_MS = "0";
process.env.EHLIYET_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ehliyet-hy-"));
const { createAudit } = await import("../src/examiner/runner.js");
const t = Date.now();
const a = await createAudit({ agent: { name: "hibrit" }, candidate: { type: "script", variant: "naive" }, upstream: "hybrid", redTeam: false });
const { getEvents } = await import("../src/store.js");
console.log(`${((Date.now() - t) / 1000).toFixed(1)} sn |`, getEvents(a.id)[0].data.exchange, "|", getEvents(a.id)[0].data.note ?? "gerçek OKX fiyatları");
process.exit(0);
