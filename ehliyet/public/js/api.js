// Veri katmanı. Site, denetçinin /v1 uçlarıyla aynı sunucudan yayınlanır.
// İki mod:
//   canlı   → sunucu çalışıyor (npm start / npm run prova)
//   kayıt   → tek dosyalık kopya (npm run export): veriler sayfaya gömülü, salt okunur
const SNAP = window.__EHLIYET_SNAPSHOT__ ?? null;
export const isSnapshot = () => !!SNAP;
export const snapshotInfo = () => SNAP && { createdAt: SNAP.createdAt, source: SNAP.source };

// Sitenin yayınlandığı klasör = API kökü (EHLIYET_BASE_PATH ile alt yolda da çalışır)
export const BASE = SNAP ? SNAP.source : new URL(".", location.href).href.replace(/\/$/, "");

const KEY = "ehliyet:api-key";
export const apiKey = {
  get() {
    try {
      return sessionStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(v) {
    try {
      v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY);
    } catch {
      /* gizli pencere */
    }
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function req(method, path, body) {
  if (SNAP) {
    if (method !== "GET") throw new ApiError(405, "Bu, sitenin kayıtlı kopyası. Yeni sınav için sunucuyu çalıştırın (npm start).");
    if (!(path in SNAP.get)) throw new ApiError(404, "Kayıtlı kopyada bu veri yok.");
    return structuredClone(SNAP.get[path]);
  }
  const key = apiKey.get();
  let r;
  try {
    r = await fetch(BASE + path, {
      method,
      cache: "no-store",
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Sunucuya ulaşılamıyor.");
  }
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }
  if (r.status === 401) throw new ApiError(401, "Erişim anahtarı gerekli ya da yanlış.");
  if (!r.ok) throw new ApiError(r.status, json.error || r.statusText);
  return json;
}

const id = encodeURIComponent;
export const api = {
  health: () => req("GET", "/v1/health"),
  exams: () => req("GET", "/v1/exams"),
  profiles: () => req("GET", "/v1/profiles"),
  audits: () => req("GET", "/v1/audits"),
  audit: (a) => req("GET", `/v1/audits/${id(a)}`),
  events: (a) => req("GET", `/v1/audits/${id(a)}/events`),
  evidence: (a) => req("GET", `/v1/audits/${id(a)}/evidence`),
  leaderboard: () => req("GET", "/v1/leaderboard"),
  publicKey: () => req("GET", "/v1/public-key"),
  create: (body) => req("POST", "/v1/audits", body),
  start: (a) => req("POST", `/v1/audits/${id(a)}/start`),
  cancel: (a) => req("POST", `/v1/audits/${id(a)}/cancel`),
  reply: (a, text) => req("POST", `/v1/audits/${id(a)}/reply`, { text }),
  async verify(license) {
    if (SNAP) return SNAP.verified?.[license.payload.id] ?? { valid: false, reason: "Kayıtlı kopyada imza doğrulanamaz; sunucuda deneyin." };
    return req("POST", "/v1/licenses/verify", { license });
  },
  cardUrl(licId) {
    if (SNAP) return SNAP.cards?.[licId] ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(SNAP.cards[licId]) : "";
    return `${BASE}/v1/licenses/${id(licId)}/card.svg`;
  },
  badgeUrl: (licId) => `${BASE}/v1/licenses/${id(licId)}/badge.svg`,
  licenseUrl: (licId) => `${BASE}/v1/licenses/${id(licId)}`,
  chain: () => req("GET", "/v1/chain"),
  licenseChain: (l) => req("GET", `/v1/licenses/${id(l)}/chain`),
  anchor: (l) => req("POST", `/v1/licenses/${id(l)}/anchor`),
  insurance: () => req("GET", "/v1/insurance"),
  policy: (p) => req("GET", `/v1/policies/${id(p)}`),
  simulatePolicy: (p) => req("POST", `/v1/policies/${id(p)}/simulate`),
  async verifyPolicy(doc) {
    if (SNAP) return SNAP.verified?.[doc.payload.id] ?? { valid: false, reason: "Kayıtlı kopyada imza doğrulanamaz; sunucuda deneyin." };
    return req("POST", "/v1/policies/verify", { policy: { payload: doc.payload, signature: doc.signature, publicKeyId: doc.publicKeyId } });
  },
  async policySvg(polId) {
    if (SNAP) return SNAP.cards?.[polId] ?? "";
    const r = await fetch(`${BASE}/v1/policies/${id(polId)}/card.svg`, { cache: "no-store" });
    if (!r.ok) throw new ApiError(r.status, "Poliçe kartı alınamadı");
    return r.text();
  },
  async cardSvg(licId) {
    if (SNAP) return SNAP.cards?.[licId] ?? "";
    const r = await fetch(this.cardUrl(licId));
    if (!r.ok) throw new ApiError(r.status, "Kart alınamadı");
    return r.text();
  },

  /** Bir denetimin canlı olay akışı. Dönen fonksiyon aboneliği kapatır. */
  stream(auditId, since, onEvent, onReady) {
    if (SNAP) return () => {};
    const es = new EventSource(`${BASE}/v1/audits/${id(auditId)}/events?stream=1&since=${since}`);
    const handler = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch (e) {
        console.error(e);
      }
    };
    for (const k of EVENT_KINDS) es.addEventListener(k, handler);
    es.addEventListener("ready", () => onReady?.());
    return () => es.close();
  },

  /** Sunucudaki tüm denetimlerin durum değişiklikleri (salon tablosu için). */
  globalStream(onEvent) {
    if (SNAP) return () => {};
    const es = new EventSource(`${BASE}/v1/stream`);
    for (const k of ["created", "status", "exam_result", "license", "policy", "claim", "anchor"])
      es.addEventListener(k, (m) => {
        try {
          onEvent(JSON.parse(m.data));
        } catch {
          /* bozuk satır */
        }
      });
    return () => es.close();
  },
};

export const EVENT_KINDS = [
  "created",
  "status",
  "exam_start",
  "snapshot",
  "setup",
  "user_msg",
  "agent_msg",
  "tool_call",
  "tool_result",
  "notional",
  "trap",
  "trap_armed",
  "blocked",
  "order",
  "violation",
  "awaiting_reply",
  "grade",
  "exam_result",
  "redteam_start",
  "redteam_note",
  "redteam_end",
  "finding",
  "info",
  "license",
  "coverage",
  "claim",
  "policy",
  "anchor",
];
