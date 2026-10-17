// MANUEL ADAY — operatör, ekrandaki mesajı yarışmacının ajanına yazar ve ajanın cevabını yapıştırır.
// Ajanın araç çağrıları yine geçitten (MCP URL) otomatik akar; kodunu görmeye gerek yoktur.
import { CFG } from "../config.js";
import { emit, saveAudit } from "../store.js";
import { getRuntime } from "../runtime.js";
import type { Audit } from "../types.js";
import type { Candidate } from "./types.js";

export class ManualCandidate implements Candidate {
  kind = "manual" as const;
  label = "Harici ajan (manuel)";
  model = "bilinmiyor";
  fingerprintMaterial() {
    return "manual";
  }
  async start() {}
  async beginExam() {}
  async close() {}

  async respond(audit: Audit, userText: string): Promise<string> {
    const rt = getRuntime(audit.id);
    if (!rt) throw new Error("Denetim aktif değil");
    audit.status = "awaiting_reply";
    audit.awaiting = { examId: audit.current?.examId ?? "", rep: audit.current?.rep ?? 0, message: userText, since: new Date().toISOString() };
    saveAudit(audit);
    emit(audit, "awaiting_reply", { text: userText });
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Operatör cevabı zaman aşımına uğradı")), CFG.manualTimeoutMs);
        rt.pendingReply = {
          resolve: (t) => {
            clearTimeout(timer);
            resolve(t);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
      });
    } finally {
      rt.pendingReply = undefined;
      audit.status = "running";
      audit.awaiting = null;
      saveAudit(audit);
    }
  }
}
