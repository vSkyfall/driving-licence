// TEK DOSYALIK KAYITLI KOPYA — sitenin, sunucu olmadan açılabilen salt okunur hâli.
//   npm run export                      → dist/ehliyet-site.html
//   npm run export -- --out ../indir/ehliyet-site.html
// Bitmiş denetimler (olaylar, ehliyetler, kartlar) sayfaya gömülür. Sunum yedeği ve jüriye gönderim içindir.
// Denetim jetonları ve MCP adresleri kopyaya YAZILMAZ.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { build } from "esbuild";
import { ROOT, CFG } from "../src/config.js";
import { loadAll, listAudits } from "../src/store.js";
import { createEhliyetHandler } from "../src/api/handler.js";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const OUT = path.resolve(arg("out") ?? path.join(ROOT, "dist", "ehliyet-site.html"));
const SOURCE = (arg("source") ?? CFG.publicUrl ?? "").replace(/\/$/, "") || `http://localhost:${CFG.port}`;

loadAll();
const server = http.createServer((req, res) => void createEhliyetHandler({ basePath: "" })(req, res));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const json = async (p: string) => {
  const r = await fetch(base + p);
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
};

const get: Record<string, unknown> = {};
const cards: Record<string, string> = {};
const verified: Record<string, unknown> = {};

for (const p of ["/v1/health", "/v1/exams", "/v1/profiles", "/v1/leaderboard", "/v1/insurance", "/v1/chain"]) get[p] = await json(p);
for (const pol of (get["/v1/insurance"] as { policies: { payload: { id: string } }[] }).policies) {
  const id = pol.payload.id;
  const detail = await json(`/v1/policies/${id}`);
  get[`/v1/policies/${id}`] = detail;
  cards[id] = await (await fetch(`${base}/v1/policies/${id}/card.svg`)).text();
  verified[id] = detail.verification;
}
const audits = listAudits().filter((a) => ["done", "failed", "cancelled"].includes(a.status));
get["/v1/audits"] = (await json("/v1/audits")).filter((a: { id: string }) => audits.some((x) => x.id === a.id));
for (const a of audits) {
  const detail = await json(`/v1/audits/${a.id}`);
  delete detail.token;
  delete detail.connection;
  get[`/v1/audits/${a.id}`] = detail;
  get[`/v1/audits/${a.id}/events`] = await json(`/v1/audits/${a.id}/events`);
  const ev = await json(`/v1/audits/${a.id}/evidence`);
  get[`/v1/audits/${a.id}/evidence`] = { auditId: ev.auditId, chain: ev.chain };
  if (a.license) {
    const id = a.license.payload.id;
    // Zincir doğrulaması kopya alınırken yapılır ve sayfaya gömülür
    get[`/v1/licenses/${id}/chain`] = await json(`/v1/licenses/${id}/chain`);
    cards[id] = await (await fetch(`${base}/v1/licenses/${id}/card.svg`)).text();
    verified[id] = (await json(`/v1/licenses/${id}`)).verification;
  }
}
server.close();

const pub = path.join(ROOT, "public");
const bundle = await build({ entryPoints: [path.join(pub, "js", "app.js")], bundle: true, format: "esm", write: false, minify: true, target: "es2022" });
const js = bundle.outputFiles[0].text;
const css = fs.readFileSync(path.join(pub, "style.css"), "utf8");
const snap = { createdAt: new Date().toISOString(), source: SOURCE, get, cards, verified };
// </script> kaçışı: JSON içindeki "<" karakterleri < olur
const snapJs = `window.__EHLIYET_SNAPSHOT__=${JSON.stringify(snap).replace(/</g, "\\u003c")};`;

let html = fs.readFileSync(path.join(pub, "index.html"), "utf8");
html = html.replace(/<link rel="stylesheet" href="style\.css" \/>/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" src="js\/app\.js"><\/script>/, () => `<script>${snapJs}</script>\n    <script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`);
if (html.includes('src="js/app.js"') || !html.includes("__EHLIYET_SNAPSHOT__")) throw new Error("index.html beklenen biçimde değil");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`Kayıtlı kopya: ${OUT} (${kb} KB, ${audits.length} denetim, ${Object.keys(cards).length} kart)`);
