// Ehliyeti Avalanche'a yazar ve sonucu denetim kaydına + kanıt zincirine işler.
import { CFG } from "../config.js";
import { emit, listAudits, saveAudit } from "../store.js";
import type { Audit } from "../types.js";
import { anchorLicense, chainEnabled, licenseDigest } from "./avalanche.js";

const inFlight = new Set<string>();

export async function anchorAudit(a: Audit) {
  if (!a.license || !chainEnabled() || !CFG.chainKey || !CFG.chainContract || inFlight.has(a.id)) return a.chain ?? null;
  inFlight.add(a.id);
  try {
    const digest = licenseDigest(a.license);
    a.chain = { network: CFG.chain, chainId: null, contract: CFG.chainContract, digest, status: "pending", txHash: null, block: null, at: new Date().toISOString() };
    saveAudit(a);
    emit(a, "anchor", { status: "pending", network: CFG.chain, digest, contract: CFG.chainContract }, { examId: null, rep: null });
    const r = await anchorLicense(a.license);
    a.chain = r;
    saveAudit(a);
    emit(a, "anchor", { ...r }, { examId: null, rep: null });
    return r;
  } finally {
    inFlight.delete(a.id);
  }
}

/** Açılışta: zincire yazılmamış (ya da yarıda kalmış) ehliyetleri sırayla yazar. */
export async function anchorBacklog() {
  if (!chainEnabled() || !CFG.chainKey || !CFG.chainContract) return 0;
  const todo = listAudits()
    .filter((a) => a.status === "done" && a.license && a.chain?.status !== "confirmed")
    .reverse();
  for (const a of todo) await anchorAudit(a);
  return todo.length;
}
