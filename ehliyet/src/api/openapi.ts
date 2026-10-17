// OpenAPI 3.1 — sitenin (ya da onun yapay zekâ asistanının) entegrasyonu hızlıca yapabilmesi için.
export function openapi(server: string) {
  const audit = { $ref: "#/components/schemas/Audit" };
  const err = { description: "Hata", content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } };
  return {
    openapi: "3.1.0",
    info: {
      title: "EHLİYET Denetçi API",
      version: "2.0.0",
      description:
        "OKX Agent Trade Kit kullanan yapay zekâ ajanlarını OKX demo hesabında 12 tuzaklı sınava ve uyarlanabilir kırmızı takıma sokar; Ed25519 imzalı ehliyet verir. " +
        "Yarışmacının ajanı, oluşturulan denetimin `connection.mcpUrl` adresine MCP (Streamable HTTP) ile bağlanır.",
    },
    servers: [{ url: server }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Yalnızca sunucuda EHLIYET_API_KEY tanımlıysa gerekir" } },
      schemas: {
        CreateAudit: {
          type: "object",
          required: ["agent", "candidate"],
          properties: {
            agent: { type: "object", required: ["name"], properties: { name: { type: "string" }, team: { type: "string" }, model: { type: "string" }, description: { type: "string" } } },
            candidate: {
              oneOf: [
                { type: "object", required: ["type", "url"], properties: { type: { const: "http" }, url: { type: "string", description: "Ajanın sohbet ucu" }, format: { enum: ["auto", "openai", "simple"] }, headers: { type: "object", additionalProperties: { type: "string" } }, model: { type: "string" }, timeoutMs: { type: "number" } } },
                { type: "object", required: ["type"], properties: { type: { const: "manual" } } },
                { type: "object", required: ["type"], properties: { type: { const: "claude" }, model: { type: "string" }, systemPrompt: { type: "string" }, profile: { enum: ["acemi", "egitimli"], description: "Referans talimat (systemPrompt boşsa); bkz. /v1/profiles" } } },
                { type: "object", required: ["type", "variant"], properties: { type: { const: "script" }, variant: { enum: ["naive", "hardened", "orta"] } } },
              ],
            },
            exams: { oneOf: [{ enum: ["hizli", "tam"] }, { type: "array", items: { type: "string" } }], description: "Ön ayar ya da sınav kimlikleri/numaraları" },
            repetitions: { type: "integer", minimum: 1, maximum: 5, description: "Her sınav kaç kez koşulsun (tutarlılık)" },
            redTeam: { type: "boolean", description: "Uyarlanabilir kırmızı takım (ANTHROPIC_API_KEY gerekir)" },
            upstream: { enum: ["mock", "hybrid", "atk"] },
            maxNotional: { type: "number" },
            lang: { enum: ["tr", "en"] },
            autostart: { type: "boolean", description: "Varsayılan: script/claude için true; http/manual için false (önce ajan MCP URL'sine bağlanır, sonra /start)" },
          },
        },
        Audit: { type: "object", description: "Denetim durumu, sonuçlar, ihlaller, bulgular, imzalı ehliyet" },
        SignedLicense: { type: "object", properties: { payload: { type: "object" }, signature: { type: "string" }, publicKeyId: { type: "string" } } },
        Event: { type: "object", properties: { seq: { type: "integer" }, ts: { type: "string" }, kind: { type: "string" }, examId: { type: ["string", "null"] }, rep: { type: ["integer", "null"] }, data: { type: "object" }, prev: { type: "string" }, hash: { type: "string" } } },
      },
    },
    paths: {
      "/v1/health": { get: { summary: "Sağlık", responses: { 200: { description: "ok" } } } },
      "/v1/insurance": { get: { summary: "Simüle sigorta: havuz özeti, fiyatlama parametreleri, hash zincirli havuz defteri, poliçeler", responses: { 200: { description: "ok" } } } },
      "/v1/policies": { get: { summary: "Poliçeler (Ed25519 imzalı) ve durumları", responses: { 200: { description: "ok" } } } },
      "/v1/policies/{id}": { get: { summary: "Tek poliçe + imza doğrulaması", responses: { 200: { description: "ok" } } } },
      "/v1/policies/{id}/card.svg": { get: { summary: "Poliçe kartı", responses: { 200: { description: "SVG" } } } },
      "/v1/policies/{id}/simulate": { post: { summary: "Poliçe dönemi simülasyonu: ajanı aynı ayarlarla poliçe kapsamında yeniden çalıştırır", security: [{ bearer: [] }], responses: { 201: { description: "Denetim" } } } },
      "/v1/policies/verify": { post: { summary: "Poliçe imzasını doğrula", responses: { 200: { description: "ok" } } } },
      "/v1/profiles": { get: { summary: "Referans ajan profilleri (Acemi / Eğitimli) ve sistem talimatları", responses: { 200: { description: "ok" } } } },
      "/v1/exams": { get: { summary: "Sınav bankası, ön ayarlar, politika kuralları", responses: { 200: { description: "ok" } } } },
      "/v1/audits": {
        get: { summary: "Denetimleri listele", responses: { 200: { description: "ok" } } },
        post: {
          summary: "Denetim oluştur (http/claude/script adaylarda hemen başlar)",
          security: [{ bearer: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateAudit" } } } },
          responses: { 201: { description: "Oluşturuldu; token ve connection.mcpUrl içerir", content: { "application/json": { schema: audit } } }, 400: err },
        },
      },
      "/v1/audits/{id}": { get: { summary: "Denetim durumu", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok" } } } },
      "/v1/audits/{id}/start": { post: { summary: "Başlat (manuel adaylar için)", security: [{ bearer: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok" } } } },
      "/v1/audits/{id}/reply": { post: { summary: "Manuel modda ajanın cevabını ilet", security: [{ bearer: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } } } }, responses: { 200: { description: "ok" } } } },
      "/v1/audits/{id}/cancel": { post: { summary: "İptal", security: [{ bearer: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok" } } } },
      "/v1/audits/{id}/events": { get: { summary: "Olaylar (JSON) ya da canlı akış (Accept: text/event-stream veya ?stream=1). ?since=<seq>", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok" } } } },
      "/v1/audits/{id}/evidence": { get: { summary: "Tüm kanıt + hash zinciri doğrulaması", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok" } } } },
      "/v1/leaderboard": { get: { summary: "Salon tablosu", responses: { 200: { description: "ok" } } } },
      "/v1/stream": { get: { summary: "Tüm denetimlerin durum olayları (SSE)", responses: { 200: { description: "text/event-stream" } } } },
      "/v1/licenses/{id}": { get: { summary: "İmzalı ehliyet (ehliyet ya da denetim kimliği)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "ok" } } } },
      "/v1/licenses/{id}/card.svg": { get: { summary: "Ehliyet kartı (SVG)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "image/svg+xml" } } } },
      "/v1/licenses/{id}/badge.svg": { get: { summary: "README rozeti (SVG)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "image/svg+xml" } } } },
      "/v1/licenses/verify": { post: { summary: "Ehliyet imzasını doğrula", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/SignedLicense" } } } }, responses: { 200: { description: "{valid, reason}" } } } },
      "/v1/public-key": { get: { summary: "Ed25519 açık anahtar", responses: { 200: { description: "ok" } } } },
      "/mcp/{token}": { post: { summary: "Yarışmacı ajanın bağlandığı MCP (Streamable HTTP) geçidi", parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "MCP" } } } },
    },
  };
}
