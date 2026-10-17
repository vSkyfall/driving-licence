// Avalanche kurulumu — tek komut, tekrar tekrar çalıştırılabilir:
//   npm run avalanche:setup    cüzdan yoksa oluşturur → bakiyeyi kontrol eder → sözleşmeyi bir kez kurar → .env'e yazar
//   npm run avalanche:status   ağ, cüzdan, bakiye, sözleşme ve kayıt sayısı
// Varsayılan ağ Fuji (test ağı). Test AVAX'ın gerçek değeri yoktur.
import fs from "node:fs";
import path from "node:path";
import { Wallet, formatEther } from "ethers";
import { CFG, ROOT } from "../src/config.js";

const ENV = path.join(ROOT, ".env");
const EXAMPLE = path.join(ROOT, ".env.example");
const MIN_AVAX = 0.005;

function upsertEnv(key: string, value: string) {
  if (!fs.existsSync(ENV)) fs.copyFileSync(EXAMPLE, ENV);
  const lines = fs.readFileSync(ENV, "utf8").split(/\r?\n/);
  const i = lines.findIndex((l) => l.match(new RegExp(`^\\s*${key}\\s*=`)));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV, lines.join("\n"), { mode: 0o600 });
  process.env[key] = value;
}

const say = (s = "") => console.log(s);
const step = (n: number, s: string) => say(`\n${n}) ${s}`);

async function status() {
  const { chainStatus } = await import("../src/chain/avalanche.js");
  const s: any = await chainStatus();
  say(`Ağ:        ${s.label}${s.chainId ? ` (zincir ${s.chainId})` : ""}`);
  if (s.issuer) say(`Cüzdan:    ${s.issuer}  ·  ${s.balance} AVAX`);
  if (s.contract) say(`Sözleşme:  ${s.contract}${s.count != null ? `  ·  ${s.count} ehliyet kayıtlı` : ""}`);
  if (s.contractUrl) say(`Gezgin:    ${s.contractUrl}`);
  say(s.ready ? "Durum:     HAZIR" : `Durum:     HAZIR DEĞİL · ${s.reason}`);
}

async function setup() {
  say("EHLİYET · Avalanche kurulumu");
  if (!fs.existsSync(ENV)) {
    fs.copyFileSync(EXAMPLE, ENV);
    say(".env dosyası .env.example'dan oluşturuldu.");
  }

  step(1, "Ağ");
  if (CFG.chain === "off") {
    upsertEnv("EHLIYET_CHAIN", "fuji");
    CFG.chain = "fuji";
  }
  if (CFG.chain === "mainnet") say("UYARI: ana ağ seçili. Burada gerçek AVAX harcanır.");
  const { NETWORKS, provider, deployRegistry, registry, explorerAddress, explorerTx } = await import("../src/chain/avalanche.js");
  say(`   ${NETWORKS[CFG.chain as "fuji"].label}`);

  step(2, "Cüzdan");
  if (!CFG.chainKey) {
    const w = Wallet.createRandom();
    upsertEnv("EHLIYET_CHAIN_KEY", w.privateKey);
    CFG.chainKey = w.privateKey;
    say("   Yeni test cüzdanı oluşturuldu; özel anahtar .env dosyasına yazıldı (kimseyle paylaşmayın).");
  }
  const address = new Wallet(CFG.chainKey).address;
  say(`   Adres: ${address}`);

  step(3, "Bağlantı ve bakiye");
  const p = await provider();
  const bal = Number(formatEther(await p.getBalance(address)));
  say(`   Bakiye: ${bal} AVAX`);
  if (bal < MIN_AVAX) {
    say(`\n   Bu cüzdanda test AVAX yok (test AVAX'ın parasal değeri yoktur). Şunu yapın:`);
    say(`   a) Şu adresi kopyalayın:  ${address}`);
    say(`   b) Avalanche'ın resmî test musluğunu açın:  https://build.avax.network/console/primary-network/faucet`);
    say(`      Giriş yapın, "C-Chain" seçin, adresi yapıştırıp test AVAX isteyin.`);
    say(`      (Musluk yalnızca bağlı cüzdana gönderiyorsa: kendi cüzdanınıza alın, oradan bu adrese 0,1 AVAX gönderin.)`);
    say(`   c) 1-2 dakika sonra bu komutu tekrar çalıştırın:  npm run avalanche:setup`);
    return;
  }

  step(4, "Kayıt sözleşmesi (EhliyetRegistry)");
  if (CFG.chainContract) {
    const c = await registry();
    const issuer = String(await c.issuer());
    if (issuer.toLowerCase() !== address.toLowerCase()) {
      say(`   Bu sözleşmenin sahibi başka bir cüzdan (${issuer}). Yeni sözleşme kuruluyor.`);
      CFG.chainContract = "";
    } else say(`   Mevcut: ${CFG.chainContract}  ·  ${Number(await c.count())} ehliyet kayıtlı`);
  }
  if (!CFG.chainContract) {
    say("   Kuruluyor (yaklaşık 5-10 saniye)…");
    const d = await deployRegistry();
    upsertEnv("EHLIYET_CHAIN_CONTRACT", d.address);
    CFG.chainContract = d.address;
    say(`   Kuruldu: ${d.address}  (blok ${d.block})`);
    const u = explorerTx(d.txHash);
    if (u) say(`   İşlem:  ${u}`);
  }
  const url = explorerAddress(CFG.chainContract);
  if (url) say(`   Gezgin: ${url}`);

  say(`\nHAZIR. Sunucuyu başlatın:  npm start`);
  say("Sınavı biten her ehliyet otomatik olarak Avalanche'a yazılır; daha önce verilmiş ehliyetler de açılışta yazılır.");
}

const cmd = process.argv[2] ?? "setup";
(cmd === "status" ? status() : setup()).catch((e) => {
  console.error(`\nHATA: ${(e as Error).message}`);
  process.exit(1);
});
