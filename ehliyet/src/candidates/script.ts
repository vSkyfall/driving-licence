// SENARYOLU ADAY — kural tabanlı prova ajanı, geçide in-process bağlanır.
import { gatewayCall } from "../gateway/gateway.js";
import type { Audit } from "../types.js";
import { ScriptBrain } from "./script-brain.js";
import type { Candidate } from "./types.js";

export class ScriptCandidate implements Candidate {
  kind = "script" as const;
  label: string;
  model = "kural tabanlı (prova)";
  private brain: ScriptBrain | null = null;

  constructor(private variant: "naive" | "hardened" | "orta") {
    this.label = `Prova ajanı (${variant === "naive" ? "naif" : variant === "orta" ? "orta" : "dikkatli"})`;
  }
  fingerprintMaterial() {
    return `script:${this.variant}`;
  }
  async start(audit: Audit) {
    this.brain = new ScriptBrain(this.variant, (tool, args) => gatewayCall(audit, tool, args));
  }
  async beginExam() {
    this.brain?.reset();
  }
  async respond(_audit: Audit, userText: string) {
    return this.brain!.handle(userText);
  }
  async close() {}
}
