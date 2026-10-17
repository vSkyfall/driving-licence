// Avalanche kaydının uçtan uca testi — yerel bir EVM'e karşı (Fuji'de para harcamadan).
//   EHLIYET_CHAIN_RPC=http://127.0.0.1:8545 EHLIYET_CHAIN_KEY=0x... npm run test:chain
// Sözleşme kurulur, bir prova sınavı koşulur; ehliyetin zincire yazıldığı, doğrulandığı,
// değiştirilmiş ehliyetin yakalandığı ve kaydın ikinci kez/başka cüzdandan yazılamadığı kontrol edilir.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
process.env.EHLIYET_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ehliyet-chain-"));
process.env.EHLIYET_PACE_MS = "0";
process.env.EHLIYET_CHAIN = process.env.EHLIYET_CHAIN && process.env.EHLIYET_CHAIN !== "off" ? process.env.EHLIYET_CHAIN : "local";
process.env.EHLIYET_CHAIN_CONTRACT = "";
if (!process.env.EHLIYET_CHAIN_KEY) {
  console.error("EHLIYET_CHAIN_KEY gerekli (yerel EVM'de bakiyesi olan bir hesap).");
  process.exit(1);
}

const { CFG } = await import("../src/config.js");
const { loadAll, getAudit, getEvents } = await import("../src/store.js");
const { createAudit, startAudit } = await import("../src/examiner/runner.js");
const { deployRegistry, registry, verifyOnChain, licenseDigest, anchorLicense } = await import("../src/chain/avalanche.js");
const { Wallet, JsonRpcProvider } = await import("ethers");
loadAll();

let ok = true;
const check = (cond: boolean, label: string) => {
  ok &&= cond;
  console.log(`${cond ? "✅" : "❌"} ${label}`);
};
const until = async (fn: () => boolean, ms = 30000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
};

// 1) Sözleşme
const d = await deployRegistry();
CFG.chainContract = d.address;
check(/^0x[0-9a-fA-F]{40}$/.test(d.address), `sözleşme kuruldu ${d.address} (blok ${d.block})`);

// 2) Sınav → ehliyet → otomatik zincir kaydı
const a0 = await createAudit({ agent: { name: "Zincir testi" }, candidate: { type: "script", variant: "hardened" }, upstream: "mock", redTeam: false });
startAudit(a0.id, "http://localhost");
await until(() => getAudit(a0.id)!.status === "done");
await until(() => getAudit(a0.id)!.chain?.status === "confirmed" || getAudit(a0.id)!.chain?.status === "failed");
const a = getAudit(a0.id)!;
check(a.chain?.status === "confirmed" && !!a.chain.txHash, `ehliyet zincire yazıldı (tx ${a.chain?.txHash?.slice(0, 12)}…, blok ${a.chain?.block})${a.chain?.error ? " · " + a.chain.error : ""}`);
check(getEvents(a.id).some((e) => e.kind === "anchor" && e.data.status === "confirmed"), "kanıt zincirinde anchor olayı var");

// 3) Doğrulama
const v: any = await verifyOnChain(a.license!);
check(v.onChain && v.matches, `zincirdeki kayıt ehliyetle eşleşiyor (sınıf ${v.record?.class}, puan ${v.record?.score})`);

// 4) Değiştirilmiş ehliyet yakalanır
const tampered = structuredClone(a.license!);
tampered.payload.score = 100;
const vt: any = await verifyOnChain(tampered);
check(!vt.onChain, "puanı değiştirilmiş ehliyetin özeti zincirde yok (sahte ehliyet yakalandı)");

// 5) Değiştirilemezlik: aynı özet ikinci kez yazılamaz
const c = await registry(true);
let reverted = false;
try {
  await (await c.register(licenseDigest(a.license!), "0x" + "00".repeat(32), "lic_sahte", 3, 100)).wait();
} catch (e) {
  reverted = /AlreadyRegistered|revert/i.test(String((e as Error).message));
}
check(reverted, "aynı ehliyet ikinci kez yazılamıyor (AlreadyRegistered)");

// 6) Başka cüzdan yazamaz
const p = new JsonRpcProvider(CFG.chainRpc || "http://127.0.0.1:8545");
const funder = new Wallet(CFG.chainKey, p);
const stranger = Wallet.createRandom().connect(p);
await (await funder.sendTransaction({ to: stranger.address, value: 10n ** 17n })).wait();
let blocked = false;
try {
  await (await (c.connect(stranger) as any).register("0x" + "11".repeat(32), "0x" + "00".repeat(32), "lic_sahte", 3, 100)).wait();
} catch (e) {
  blocked = /NotIssuer|revert/i.test(String((e as Error).message));
}
check(blocked, "başka bir cüzdan kayıt ekleyemiyor (NotIssuer)");

// 7) Tekrar kayıt isteği işlem göndermez
const again = await anchorLicense(a.license!);
check(again.status === "confirmed" && again.txHash === null, "aynı ehliyet için tekrar istek yeni işlem göndermiyor");
check(Number(await c.count()) === 1, "sözleşmede tam 1 kayıt var");

console.log(ok ? "\nAvalanche kaydı doğru çalışıyor." : "\nBEKLENMEYEN SONUÇ — yukarıya bakın.");
process.exit(ok ? 0 : 1);
