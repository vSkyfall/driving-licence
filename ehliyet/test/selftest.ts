// Kurulum doğrulaması (internet ve anahtar gerekmez):  npm test
// Üç prova ajanını 12 sınavdan geçirir; ehliyet, imza, kanıt zinciri ve simüle sigortayı (poliçe, havuz, tazminat) doğrular.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
process.env.EHLIYET_PACE_MS = "0";
process.env.EHLIYET_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ehliyet-test-"));
const { loadAll, getAudit, verifyChain } = await import("../src/store.js");
const { createAudit, startAudit } = await import("../src/examiner/runner.js");
const { verify } = await import("../src/license.js");
const { getPolicy, poolSummary, verifyLedger, verifyPolicy } = await import("../src/insurance.js");
const { CFG } = await import("../src/config.js");
loadAll();

let ok = true;
const check = (cond: boolean, label: string) => {
  ok &&= cond;
  if (!cond) console.log(`   ❌ ${label}`);
};

async function run(variant: "naive" | "hardened" | "orta") {
  const a = await createAudit({ agent: { name: `Prova ${variant}` }, candidate: { type: "script", variant }, upstream: "mock", redTeam: false });
  startAudit(a.id, "http://localhost");
  while (!["done", "failed", "cancelled"].includes(getAudit(a.id)!.status)) await new Promise((r) => setTimeout(r, 50));
  return getAudit(a.id)!;
}

const expected = {
  naive: { pass: [10, 12], cls: "SINIFSIZ", policy: "rejected" },
  hardened: { pass: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], cls: "B", policy: "issued" },
  orta: { pass: [1, 3, 4, 5, 6, 8, 9, 10, 11, 12], cls: "A", policy: "issued" },
} as const;

for (const variant of ["naive", "hardened", "orta"] as const) {
  const x = await run(variant);
  const passed = x.results.filter((r) => r.pass).map((r) => r.no);
  const exp = expected[variant];
  const good =
    x.status === "done" &&
    JSON.stringify(passed) === JSON.stringify(exp.pass) &&
    x.license?.payload.class === exp.cls &&
    verify(x.license!).valid &&
    verifyChain(x.id).ok &&
    x.insurance?.decision === exp.policy;
  check(good, `${variant}: beklenen sonuç değil (geçen ${passed.join(",")}, sınıf ${x.license?.payload.class}, sigorta ${x.insurance?.decision})`);
  const pol = x.insurance?.policyId ? getPolicy(x.insurance.policyId) : null;
  if (pol) check(verifyPolicy(pol.doc).valid, `${variant}: poliçe imzası geçersiz`);
  console.log(
    `${good ? "✅" : "❌"} ${variant.padEnd(8)} ${x.license?.payload.label} puan ${x.license?.payload.score} | geçen: ${passed.join(",")} | ` +
      `sigorta: ${x.insurance?.decision === "issued" ? `poliçe ${x.insurance.quote.premiumUsd} $` : "ret"} | önlenen ${x.insurance?.exposure.preventedUsd} $`,
  );
}

// Poliçeli dönem: aynı parmak izli "orta" ajan yeniden çalışır; çift emir tazminatı havuzdan ödenmeli
const before = poolSummary();
const ins = await run("orta");
const paid = ins.coverage?.paidUsd ?? 0;
const after = poolSummary();
check(!!ins.coverage, "poliçeli koşu: kapsam bulunamadı");
check(paid > 0, "poliçeli koşu: tazminat ödenmedi");
const chain = verifyLedger();
check(chain.ok, "havuz defteri zinciri kırık");
const expectBalance = CFG.poolSeed + after.premiumsUsd - after.payoutsUsd;
check(Math.abs(after.balanceUsd - expectBalance) < 0.01, `havuz bakiyesi tutarsız (${after.balanceUsd} ≠ ${expectBalance})`);
check(Math.abs(before.balanceUsd - paid + (after.premiumsUsd - before.premiumsUsd) - after.balanceUsd) < 0.01, "tazminat havuzdan düşülmedi");
console.log(`${paid > 0 && chain.ok ? "✅" : "❌"} poliçeli  orta ajan yeniden: ${ins.coverage?.claims ?? 0} tazminat, ${paid} $ ödendi | havuz ${after.balanceUsd} $ | defter ${chain.ok ? "sağlam" : "KIRIK"}`);

console.log(ok ? "\nKurulum doğru çalışıyor." : "\nBEKLENMEYEN SONUÇ — yukarıya bakın.");
process.exit(ok ? 0 : 1);
