// Küçük yardımcılar: kaçış, biçimlendirme, simgeler, kopyalama, bildirim.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const enc = encodeURIComponent;

export const usd = (n) =>
  typeof n === "number" && Number.isFinite(n) ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 }) : "?";
export const num = (n, d = 0) => (typeof n === "number" ? n.toLocaleString("tr-TR", { maximumFractionDigits: d }) : "?");

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
export function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "1 sn'den kısa";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}
export function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "az önce";
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return fmtDate(iso);
}

export const SEV = { critical: "kritik", high: "yüksek", medium: "orta" };
export const sevTag = (s) => (s ? `<span class="sev ${esc(s)}">${SEV[s] ?? esc(s)}</span>` : "");

export const STATUS = {
  created: "Bağlantı bekliyor",
  queued: "Sırada",
  running: "Sınavda",
  awaiting_reply: "Operatör cevabı bekleniyor",
  done: "Bitti",
  failed: "Hata",
  cancelled: "İptal edildi",
};
export const ACTIVE = new Set(["created", "queued", "running", "awaiting_reply"]);
export function statusChip(status) {
  const cls = status === "done" ? "" : status === "failed" ? "bad" : status === "running" || status === "awaiting_reply" ? "live" : status === "cancelled" ? "" : "warn";
  return `<span class="pill ${cls}">${esc(STATUS[status] ?? status)}</span>`;
}

/** Para: 2 ondalık (sigorta tutarları) */
export const money = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })
    : "—";
export const pct = (n, d = 1) => (typeof n === "number" ? `%${(n * 100).toLocaleString("tr-TR", { maximumFractionDigits: d })}` : "—");
export const dec = (n, d = 3) => (typeof n === "number" ? n.toLocaleString("tr-TR", { maximumFractionDigits: d }) : "—");

// Emirler nereye gider? Üç mod birbirinden açıkça ayrılır.
export const UPSTREAM = {
  mock: { short: "Prova", long: "Çevrimdışı prova: örnek fiyatlar, sahte emir defteri", orders: "Sahte emir", where: "Hiçbir emir OKX'e gitmez; fiyatlar örnektir." },
  hybrid: { short: "Gerçek fiyat · sahte emir", long: "Gerçek OKX fiyatları, sahte emir defteri", orders: "Sahte emir", where: "Fiyatlar OKX'ten gelir; hiçbir emir OKX'e gönderilmez." },
  atk: { short: "OKX demo hesabı", long: "OKX demo hesabı: sanal para, gerçek OKX emir sistemi", orders: "OKX demo emri", where: "Emirler OKX'in demo hesabına gider; gerçek para kullanılmaz." },
};

// Avalanche işareti (marka rengi #E84142)
export const AVAX = (size = 16) =>
  `<svg class="avax" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#E84142"/><path d="M20.9 16.9c.5-.9 1.4-.9 1.9 0l3 5.3c.5.9.1 1.6-.9 1.6h-6.1c-1 0-1.4-.7-.9-1.6zM15.1 6.8c.5-.9 1.4-.9 1.9 0l.7 1.2 1.6 2.9c.4.8.4 1.8 0 2.6l-5.4 9.4c-.5.8-1.3 1.3-2.2 1.4H7.2c-1 0-1.4-.7-.9-1.6z" fill="#fff"/></svg>`;
export const shortHash = (h, n = 10) => (h ? `${String(h).slice(0, n)}…${String(h).slice(-4)}` : "—");

export const CANDIDATE = {
  claude: "Referans ajan (Claude)",
  http: "Sohbet ucu",
  manual: "Harici ajan (manuel)",
  script: "Prova ajanı",
};
export function candidateLabel(c) {
  if (!c) return "";
  if (c.type === "script") return c.variant === "hardened" ? "Prova ajanı · dikkatli" : c.variant === "orta" ? "Prova ajanı · orta" : "Prova ajanı · naif";
  if (c.type === "claude") return c.profile === "egitimli" ? "Claude · Eğitimli talimat" : c.profile === "acemi" ? "Claude · Acemi talimat" : "Claude · özel talimat";
  return CANDIDATE[c.type] ?? c.type;
}

export function clsBadge(cls, size = "") {
  if (!cls) return "";
  return `<span class="cls ${esc(cls)} ${size}" title="${cls === "SINIFSIZ" ? "Ehliyet yok" : `${cls} sınıfı`}">${cls === "SINIFSIZ" ? "YOK" : esc(cls)}</span>`;
}
export const CLASS_TEXT = { C: "C sınıfı", B: "B sınıfı", A: "A sınıfı", SINIFSIZ: "Ehliyet yok" };

// Simgeler (16×16, çizgi)
const svg = (d, extra = "") => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
export const I = {
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.2V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.3"/>'),
  download: svg('<path d="M8 2v8M4.6 6.8 8 10.2l3.4-3.4M2.5 13.5h11"/>'),
  check: svg('<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>'),
  play: svg('<path d="M5 3.2v9.6L12.5 8z" fill="currentColor"/>'),
  stop: svg('<rect x="4" y="4" width="8" height="8" rx="1"/>'),
  link: svg('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.6.6M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.6-.6"/>'),
  arrow: svg('<path d="M3 8h10M9 4l4 4-4 4"/>'),
  back: svg('<path d="M13 8H3M7 4 3 8l4 4"/>'),
  shield: svg('<path d="M8 1.8 3 3.6v4.1c0 3 2.1 5.4 5 6.5 2.9-1.1 5-3.5 5-6.5V3.6z"/><path d="m5.8 8 1.6 1.6 3-3.2"/>'),
  retry: svg('<path d="M2.5 8a5.5 5.5 0 1 0 1.7-4"/><path d="M2.5 2.5v3h3"/>'),
  chev: svg('<path d="M6 3.5 10.5 8 6 12.5"/>'),
  x: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  card: svg('<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4 7h3M4 9.5h5"/>'),
  info: svg('<circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.9v.1"/>'),
  ext: svg('<path d="M9.5 2.5h4v4M13.5 2.5 7 9M6 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10"/>'),
};
export const BIG = {
  shieldOk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 4.5 5.6v6c0 4.6 3.2 8.2 7.5 9.6 4.3-1.4 7.5-5 7.5-9.6v-6z"/><path d="m8.6 12 2.4 2.4 4.5-4.8"/></svg>`,
  shieldNo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 4.5 5.6v6c0 4.6 3.2 8.2 7.5 9.6 4.3-1.4 7.5-5 7.5-9.6v-6z"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/></svg>`,
};

export async function copyText(text, btn) {
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Güvenli olmayan bağlamda (http + IP) clipboard API yoktur
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand("copy");
    ta.remove();
  }
  if (btn) {
    const old = btn.innerHTML;
    btn.innerHTML = ok ? `${I.check} Kopyalandı` : "Kopyalanamadı";
    setTimeout(() => (btn.innerHTML = old), 1400);
  }
  return ok;
}

export function toast(title, body = "", kind = "") {
  const wrap = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}`;
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  setTimeout(() => el.remove(), 5000);
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
