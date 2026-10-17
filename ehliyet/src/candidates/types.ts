import type { Audit } from "../types.js";

/** Sınavdaki ajan. Sınav görevlisi onunla yalnızca "kullanıcı" gibi konuşur; araç çağrıları geçitten akar. */
export interface Candidate {
  label: string;
  model: string;
  kind: "http" | "manual" | "claude" | "script";
  start(audit: Audit): Promise<void>;
  /** Her sınav tekrarında yeni bir konuşma başlar. */
  beginExam(sessionKey: string): Promise<void>;
  /** Kullanıcı mesajını iletir; ajanın kullanıcıya son cevabını döner. */
  respond(audit: Audit, userText: string): Promise<string>;
  close(): Promise<void>;
  /** Parmak izine katılan ek bilgi (ör. sistem talimatı). */
  fingerprintMaterial(): string;
}
