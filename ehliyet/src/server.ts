// Bağımsız sunucu:  npm start   (çevrimdışı prova: npm run prova)
import http from "node:http";
import os from "node:os";
import { CFG } from "./config.js";
import { loadAll } from "./store.js";
import { createEhliyetHandler } from "./api/handler.js";
import { chainEnabled, chainStatus } from "./chain/avalanche.js";
import { anchorBacklog } from "./chain/anchor.js";

loadAll();
const handler = createEhliyetHandler();
const server = http.createServer((req, res) => void handler(req, res));
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\nPort ${CFG.port} kullanımda: EHLİYET zaten açık olabilir (http://localhost:${CFG.port}).`);
    console.error(`Önce onu kapatın ya da başka portta başlatın:  EHLIYET_PORT=4748 npm start\n`);
    process.exit(1);
  }
  throw e;
});
server.listen(CFG.port, CFG.host, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  console.log(`\n🚗 EHLİYET Denetçi hazır`);
  console.log(`   Ekran:        http://localhost:${CFG.port}${CFG.basePath}/`);
  if (lan) console.log(`   Ağdaki adres: http://${lan}:${CFG.port}${CFG.basePath}/   (yarışmacılar bu adresle bağlanır)`);
  console.log(`   API şeması:   http://localhost:${CFG.port}${CFG.basePath}/openapi.json`);
  console.log(`   Borsa:        ${CFG.upstream === "atk" ? "GERÇEK OKX demo (ATK " + CFG.atkArgs.join(" ") + ")" : CFG.upstream === "hybrid" ? "Hibrit: gerçek OKX fiyatları + sahte emir" : "Sahte (çevrimdışı)"}`);
  console.log(`   Hakem/kırmızı takım: ${CFG.anthropicKey ? `Claude (${CFG.examinerModel})` : "KAPALI: .env'e ANTHROPIC_API_KEY ekleyin (kural tabanlı hakem çalışır)"}`);
  console.log(`   API anahtarı: ${CFG.apiKey ? "gerekli" : "yok (herkes denetim başlatabilir)"}`);
  console.log(`   Tempo:        her sınav en az ${(CFG.paceMs / 1000).toLocaleString("tr-TR")} sn (EHLIYET_PACE_MS)`);
  if (!chainEnabled()) console.log(`   Avalanche:    KAPALI: ehliyetleri zincire yazmak için npm run avalanche:setup\n`);
  else
    void chainStatus().then((s: any) => {
      console.log(`   Avalanche:    ${s.label} · ${s.ready ? `sözleşme ${s.contract} · cüzdan ${s.issuer} · ${s.balance} AVAX` : `HAZIR DEĞİL: ${s.reason}`}\n`);
      if (s.ready) void anchorBacklog().then((n) => n && console.log(`   Avalanche:    ${n} ehliyet zincire yazıldı (bekleyenler)`));
    });
});
