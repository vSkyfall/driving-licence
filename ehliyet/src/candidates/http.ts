// HTTP ADAYI — yarışmacının ajanı bir sohbet ucu sunar; sınav görevlisi oraya "kullanıcı" gibi yazar.
// Desteklenen biçimler:
//   openai : POST {model, messages:[{role,content}...]} → choices[0].message.content
//   simple : POST {message, session_id, history, mcp_url} → reply|response|output|text|answer|message|content
//   auto   : URL /chat/completions ile bitiyorsa openai, değilse simple
// Ajanın OKX araçları için EHLİYET geçidine (mcp_url) bağlı olması gerekir.
import { CFG } from "../config.js";
import type { Audit } from "../types.js";
import type { Candidate } from "./types.js";

type Msg = { role: "user" | "assistant"; content: string };

export function extractReply(body: any): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  const oa = body?.choices?.[0]?.message?.content;
  if (typeof oa === "string") return oa;
  if (Array.isArray(oa)) return oa.map((p: any) => p?.text ?? "").join("");
  for (const k of ["reply", "response", "output", "text", "answer", "message", "content", "result"]) {
    const v = body[k];
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const inner = extractReply(v);
      if (inner) return inner;
    }
  }
  if (body.data) return extractReply(body.data);
  if (Array.isArray(body.content)) return body.content.map((p: any) => p?.text ?? "").join("");
  return JSON.stringify(body).slice(0, 2000);
}

export class HttpCandidate implements Candidate {
  kind = "http" as const;
  label: string;
  model: string;
  private session = "";
  private history: Msg[] = [];
  private format: "openai" | "simple";

  constructor(
    private url: string,
    fmt: "auto" | "openai" | "simple" = "auto",
    private headers: Record<string, string> = {},
    model?: string,
    private timeoutMs = CFG.httpTimeoutMs,
    private mcpUrl = "",
  ) {
    this.format = fmt === "auto" ? (/\/chat\/completions\/?$/.test(url) ? "openai" : "simple") : fmt;
    this.model = model ?? "bilinmiyor";
    this.label = `HTTP ajan (${new URL(url).host})`;
  }

  fingerprintMaterial() {
    return `${this.url}|${this.format}`;
  }

  async start(audit: Audit) {
    this.mcpUrl ||= (audit as any).__mcpUrl ?? "";
  }

  async beginExam(sessionKey: string) {
    this.session = sessionKey;
    this.history = [];
  }

  async respond(audit: Audit, userText: string): Promise<string> {
    this.history.push({ role: "user", content: userText });
    const body =
      this.format === "openai"
        ? { model: this.model, messages: this.history, stream: false, user: this.session }
        : { message: userText, session_id: this.session, history: this.history.slice(0, -1), mcp_url: this.mcpUrl, audit_id: audit.id };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ehliyet-audit": audit.id, "x-ehliyet-session": this.session, ...(this.mcpUrl ? { "x-ehliyet-mcp-url": this.mcpUrl } : {}), ...this.headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* düz metin */
      }
      const reply = extractReply(parsed).trim();
      this.history.push({ role: "assistant", content: reply });
      return reply;
    } finally {
      clearTimeout(t);
    }
  }

  async close() {}
}
