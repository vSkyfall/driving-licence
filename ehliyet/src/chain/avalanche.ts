// AVALANCHE KAYDI — her ehliyetin özeti Avalanche C-Chain'deki EhliyetRegistry sözleşmesine yazılır.
// Sözleşmede güncelleme ya da silme yoktur: bir özet bir kez yazılır, sonsuza dek okunur.
// Yalnızca sözleşmeyi kuran EHLİYET cüzdanı kayıt ekleyebilir; okumak herkese açıktır.
//
// Özet (digest) = keccak256(kanonik JSON {payload, signature, publicKeyId}) → imzalı ehliyetin tamamına bağlıdır;
// ehliyette tek bir harf değişirse özet değişir ve zincirdeki kayıtla eşleşmez.
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, keccak256, toUtf8Bytes } from "ethers";
import { createRequire } from "node:module";
import { CFG } from "../config.js";
import { canonical } from "../license.js";
import type { ChainRecord, SignedLicense } from "../types.js";

const require = createRequire(import.meta.url);
const ARTIFACT = require("./EhliyetRegistry.json") as { abi: any[]; bytecode: string; compiler: string };

type Net = "fuji" | "mainnet" | "local";
export const NETWORKS: Record<Net, { chainId: number | null; label: string; rpcs: string[]; explorer: string | null }> = {
  fuji: {
    chainId: 43113,
    label: "Avalanche Fuji (test ağı)",
    rpcs: ["https://avalanche-fuji-c-chain-rpc.publicnode.com", "https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji.drpc.org"],
    explorer: "https://testnet.snowtrace.io",
  },
  mainnet: {
    chainId: 43114,
    label: "Avalanche C-Chain (ana ağ)",
    rpcs: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
    explorer: "https://snowtrace.io",
  },
  local: { chainId: null, label: "Yerel EVM (test)", rpcs: ["http://127.0.0.1:8545"], explorer: null },
};

const CLASS_NUM: Record<string, number> = { SINIFSIZ: 0, A: 1, B: 2, C: 3 };
const CLASS_TXT = ["SINIFSIZ", "A", "B", "C"];

export const chainEnabled = () => CFG.chain !== "off" && CFG.chain in NETWORKS;
const net = () => NETWORKS[CFG.chain as Net];
const rpcList = () => (CFG.chainRpc ? CFG.chainRpc.split(",").map((s) => s.trim()).filter(Boolean) : net().rpcs);

export function explorerTx(hash?: string | null) {
  const e = chainEnabled() ? net().explorer : null;
  return e && hash ? `${e}/tx/${hash}` : null;
}
export function explorerAddress(addr?: string | null) {
  const e = chainEnabled() ? net().explorer : null;
  return e && addr ? `${e}/address/${addr}` : null;
}

/** İmzalı ehliyetin zincire yazılan özeti. */
export function licenseDigest(lic: SignedLicense): string {
  return keccak256(toUtf8Bytes(canonical({ payload: lic.payload, signature: lic.signature, publicKeyId: lic.publicKeyId })));
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} zaman aşımı (${Math.round(ms / 1000)} sn)`)), ms))]);

let providerP: Promise<JsonRpcProvider> | null = null;
/** Listedeki RPC'leri sırayla dener; ilk cevap veren ve zincir kimliği doğru olanı kullanır. */
export function provider(): Promise<JsonRpcProvider> {
  providerP ??= (async () => {
    const errors: string[] = [];
    for (const url of rpcList()) {
      try {
        const want = net().chainId;
        // Toplu (batch) istek kapalı: bazı herkese açık RPC'ler toplu cevapları düzgün döndürmüyor
        const p = want ? new JsonRpcProvider(url, want, { staticNetwork: true, batchMaxCount: 1 }) : new JsonRpcProvider(url, undefined, { batchMaxCount: 1 });
        const id = Number(await withTimeout(p.send("eth_chainId", []), 8000, url));
        if (want && id !== want) throw new Error(`zincir kimliği ${id}, beklenen ${want}`);
        return p;
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
    }
    providerP = null;
    throw new Error(`Avalanche RPC'ye ulaşılamadı. ${errors.join(" · ")}`);
  })();
  return providerP;
}

export async function wallet(): Promise<Wallet> {
  if (!CFG.chainKey) throw new Error("EHLIYET_CHAIN_KEY yok: npm run avalanche:setup çalıştırın.");
  return new Wallet(CFG.chainKey, await provider());
}

export async function registry(withSigner = false): Promise<Contract> {
  if (!CFG.chainContract) throw new Error("EHLIYET_CHAIN_CONTRACT yok: npm run avalanche:setup çalıştırın.");
  return new Contract(CFG.chainContract, ARTIFACT.abi, withSigner ? await wallet() : await provider());
}

// Nonce takibi: düğümler (özellikle yük dengeli herkese açık RPC'ler) işlemden hemen sonra eski sayıyı
// döndürebilir. Düğümün söylediği ile yerel sayının büyüğü kullanılır; gönderimler sıralıdır (serial).
let nextNonce: number | null = null;
async function takeNonce(w: Wallet) {
  const chainNonce = await withTimeout((await provider()).getTransactionCount(w.address, "pending"), 10_000, "Nonce");
  return Math.max(chainNonce, nextNonce ?? 0);
}
const isNonceError = (e: unknown) => /nonce/i.test(String((e as { error?: { message?: string } }).error?.message ?? (e as Error).message));

/** Gönderir; nonce hatasında sayacı sıfırlayıp bir kez yeniden dener. */
async function sendTx<T extends { hash: string }>(send: (nonce: number) => Promise<T>): Promise<T> {
  const w = await wallet();
  for (let attempt = 0; ; attempt++) {
    const nonce = await takeNonce(w);
    try {
      const tx = await send(nonce);
      nextNonce = nonce + 1;
      return tx;
    } catch (e) {
      if (attempt === 0 && isNonceError(e)) {
        nextNonce = null;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }
}

export function deployRegistry(): Promise<{ address: string; txHash: string; block: number }> {
  return serial(async () => {
    const f = new ContractFactory(ARTIFACT.abi, ARTIFACT.bytecode, await wallet());
    const c = await sendTx(async (nonce) => {
      const d = await f.deploy({ nonce });
      return Object.assign(d, { hash: d.deploymentTransaction()!.hash });
    });
    const tx = c.deploymentTransaction()!;
    const r = await withTimeout(tx.wait(1), 120_000, "Sözleşme kurulumu");
    return { address: await c.getAddress(), txHash: tx.hash, block: r!.blockNumber };
  });
}

export async function chainStatus() {
  const base = {
    enabled: chainEnabled(),
    network: CFG.chain,
    label: chainEnabled() ? net().label : "Kapalı",
    chainId: chainEnabled() ? net().chainId : null,
    contract: CFG.chainContract || null,
    contractUrl: explorerAddress(CFG.chainContract),
    explorer: chainEnabled() ? net().explorer : null,
    compiler: ARTIFACT.compiler,
  };
  if (!chainEnabled()) return { ...base, ready: false, reason: "Avalanche kaydı kapalı (EHLIYET_CHAIN=off)." };
  try {
    const p = await provider();
    const out: Record<string, unknown> = { ...base, chainId: Number((await p.getNetwork()).chainId) };
    if (CFG.chainKey) {
      const addr = new Wallet(CFG.chainKey).address;
      out.issuer = addr;
      out.issuerUrl = explorerAddress(addr);
      out.balance = formatEther(await withTimeout(p.getBalance(addr), 8000, "Bakiye"));
    }
    if (CFG.chainContract) {
      const c = await registry();
      const [count, issuer] = await withTimeout(Promise.all([c.count(), c.issuer()]), 8000, "Sözleşme");
      out.count = Number(count);
      out.contractIssuer = issuer;
    }
    const ready = !!(CFG.chainKey && CFG.chainContract);
    return { ...out, ready, reason: ready ? null : "Cüzdan ya da sözleşme eksik: npm run avalanche:setup" };
  } catch (e) {
    return { ...base, ready: false, reason: (e as Error).message };
  }
}

// Aynı cüzdandan gönderilen işlemler sıralı gitmeli (nonce çakışmasın)
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

/** Ehliyeti zincire yazar. Zaten yazılmışsa yeniden göndermez (kayıt değiştirilemez). */
export function anchorLicense(lic: SignedLicense): Promise<ChainRecord> {
  return serial(async () => {
    const digest = licenseDigest(lic);
    const base = { network: CFG.chain, chainId: net().chainId, contract: CFG.chainContract, digest, at: new Date().toISOString() };
    try {
      const c = await registry(true);
      const existing = await withTimeout(c.get(digest), 15_000, "Kayıt okuma");
      if (existing[0]) return { ...base, status: "confirmed", txHash: null, block: null, registeredAt: new Date(Number(existing[2]) * 1000).toISOString(), note: "Zaten kayıtlı" } as ChainRecord;
      const p = lic.payload;
      const tx = await withTimeout<any>(
        sendTx((nonce) => c.register(digest, "0x" + p.evidenceHash, p.id, CLASS_NUM[p.class] ?? 0, p.score, { nonce })),
        45_000,
        "İşlem gönderme",
      );
      const r = await withTimeout<any>(tx.wait(1), 120_000, "Onay");
      if (!r || r.status !== 1) throw new Error("İşlem zincirde başarısız oldu");
      const block = await (await provider()).getBlock(r.blockNumber);
      return {
        ...base,
        status: "confirmed",
        txHash: tx.hash,
        block: r.blockNumber,
        registeredAt: block ? new Date(block.timestamp * 1000).toISOString() : null,
        explorerUrl: explorerTx(tx.hash),
      } as ChainRecord;
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;
      return { ...base, status: "failed", txHash: null, block: null, error: /insufficient funds/i.test(msg) ? "Cüzdanda yeterli AVAX yok (test AVAX alın)" : msg.slice(0, 300) } as ChainRecord;
    }
  });
}

/** Zincirdeki kaydı okur ve ehliyetle karşılaştırır. Sunucunun söylediğine değil, zincire bakar. */
export async function verifyOnChain(lic: SignedLicense) {
  const digest = licenseDigest(lic);
  if (!chainEnabled()) return { onChain: false, digest, reason: "Avalanche kaydı kapalı" };
  try {
    const c = await registry();
    const r = await withTimeout(c.get(digest), 15_000, "Kayıt okuma");
    if (!r[0]) return { onChain: false, digest, reason: "Bu ehliyetin özeti zincirde yok" };
    const p = lic.payload;
    const rec = { evidenceHash: String(r[1]).slice(2), registeredAt: new Date(Number(r[2]) * 1000).toISOString(), class: CLASS_TXT[Number(r[3])] ?? "?", score: Number(r[4]), licenseId: String(r[5]) };
    const matches = rec.licenseId === p.id && rec.class === p.class && rec.score === p.score && rec.evidenceHash === p.evidenceHash;
    return { onChain: true, matches, digest, record: rec, contract: CFG.chainContract, network: CFG.chain };
  } catch (e) {
    return { onChain: false, digest, reason: (e as Error).message };
  }
}
