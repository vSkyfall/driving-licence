/*!
 * EHLİYET Denetçi — siteye gömülebilir bileşenler + JS istemcisi
 *
 *   <script src="https://DENETCI/widget.js" defer></script>
 *   <ehliyet-start api="https://DENETCI"></ehliyet-start>          yeni sınav formu (+ canlı sınav)
 *   <ehliyet-audit api="https://DENETCI" audit-id="aud_..."></ehliyet-audit>   tek bir denetimi canlı izle
 *   <ehliyet-leaderboard api="https://DENETCI"></ehliyet-leaderboard>          salon tablosu (canlı)
 *   <ehliyet-badge api="https://DENETCI" license-id="lic_..."></ehliyet-badge> rozet
 *
 *   Ortak öznitelikler: api (varsayılan: bu betiğin yüklendiği adres), api-key (EHLIYET_API_KEY varsa),
 *   theme="light|dark|auto". Renkler CSS değişkenleriyle değiştirilebilir: --ehliyet-sign, --ehliyet-ink, ...
 *   Olaylar (bubbles+composed): ehliyet:created, ehliyet:started, ehliyet:finished, ehliyet:select
 *
 *   JS: const c = new Ehliyet.Client({ api, apiKey }); await c.createAudit({...}); c.events(id, e => ...)
 */
(() => {
  if (window.Ehliyet && window.Ehliyet.version) return;
  const SCRIPT_ORIGIN = (() => {
    try {
      return new URL(document.currentScript.src).origin + new URL(document.currentScript.src).pathname.replace(/\/widget\.js$/, "");
    } catch {
      return location.origin;
    }
  })();

  // ── istemci ──────────────────────────────────────────────────────────────
  class Client {
    constructor(opts = {}) {
      this.api = (opts.api || SCRIPT_ORIGIN).replace(/\/$/, "");
      this.apiKey = opts.apiKey || "";
    }
    async req(method, path, body) {
      const r = await fetch(this.api + path, {
        method,
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: "Bearer " + this.apiKey } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const t = await r.text();
      let j;
      try {
        j = t ? JSON.parse(t) : {};
      } catch {
        j = { error: t };
      }
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    }
    health() { return this.req("GET", "/v1/health"); }
    exams() { return this.req("GET", "/v1/exams"); }
    createAudit(input) { return this.req("POST", "/v1/audits", input); }
    startAudit(id) { return this.req("POST", `/v1/audits/${id}/start`); }
    getAudit(id) { return this.req("GET", `/v1/audits/${id}`); }
    reply(id, text) { return this.req("POST", `/v1/audits/${id}/reply`, { text }); }
    cancel(id) { return this.req("POST", `/v1/audits/${id}/cancel`); }
    leaderboard() { return this.req("GET", "/v1/leaderboard"); }
    license(id) { return this.req("GET", `/v1/licenses/${id}`); }
    verify(license) { return this.req("POST", "/v1/licenses/verify", { license }); }
    cardUrl(id) { return `${this.api}/v1/licenses/${id}/card.svg`; }
    badgeUrl(id) { return `${this.api}/v1/licenses/${id}/badge.svg`; }
    /** Canlı olay akışı. Döndürdüğü fonksiyon aboneliği kapatır. */
    events(id, onEvent, since = 0) {
      const es = new EventSource(`${this.api}/v1/audits/${id}/events?stream=1&since=${since}`);
      const h = (m) => {
        try { onEvent(JSON.parse(m.data)); } catch (e) { console.error(e); }
      };
      KINDS.forEach((k) => es.addEventListener(k, h));
      es.addEventListener("ready", () => onEvent({ kind: "__ready" }));
      return () => es.close();
    }
    stream(onEvent) {
      const es = new EventSource(`${this.api}/v1/stream`);
      ["status", "exam_result", "license", "created"].forEach((k) => es.addEventListener(k, (m) => onEvent(JSON.parse(m.data))));
      return () => es.close();
    }
  }
  const KINDS = ["created", "status", "exam_start", "snapshot", "setup", "user_msg", "agent_msg", "tool_call", "tool_result", "notional", "trap", "trap_armed", "blocked", "order", "violation", "awaiting_reply", "grade", "exam_result", "redteam_start", "redteam_note", "redteam_end", "finding", "info", "license"];

  // ── ortak ────────────────────────────────────────────────────────────────
  const FONT_HREF = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700;800&family=JetBrains+Mono:wght@400;600&display=swap";
  if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONT_HREF;
    document.head.appendChild(l);
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const usd = (n) => (typeof n === "number" ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 }) : "?");
  const copy = async (t, btn) => {
    try {
      await navigator.clipboard.writeText(t);
      if (btn) {
        const o = btn.textContent;
        btn.textContent = "Kopyalandı";
        setTimeout(() => (btn.textContent = o), 1200);
      }
    } catch {
      prompt("Kopyalayın:", t);
    }
  };
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SEV = { critical: "kritik", high: "yüksek", medium: "orta" };

  const BASE_CSS = `
  :host { --s-paper: var(--ehliyet-paper, #EEF1F4); --s-sheet: var(--ehliyet-sheet, #FFFFFF); --s-ink: var(--ehliyet-ink, #1B2A41);
    --s-muted: var(--ehliyet-muted, #5B6B80); --s-rule: var(--ehliyet-rule, #C9D1DB); --s-sign: var(--ehliyet-sign, #F2C230);
    --s-stamp: var(--ehliyet-stamp, #C8312B); --s-go: var(--ehliyet-go, #1F7A4D); --s-hl: var(--ehliyet-highlight, #FFF6D6);
    --s-agent: var(--ehliyet-agent, #1B2A41); --s-agent-ink: #FFFFFF;
    --sans: "Barlow", system-ui, sans-serif; --cond: "Barlow Condensed", "Barlow", sans-serif; --mono: "JetBrains Mono", ui-monospace, monospace;
    display: block; color: var(--s-ink); font: 15px/1.45 var(--sans); container-type: inline-size; }
  :host([theme="dark"]) { --s-paper: var(--ehliyet-paper, #0F1724); --s-sheet: var(--ehliyet-sheet, #172133); --s-ink: var(--ehliyet-ink, #E6ECF5);
    --s-muted: var(--ehliyet-muted, #9AA8BC); --s-rule: var(--ehliyet-rule, #2A3850); --s-stamp: var(--ehliyet-stamp, #FF6B5E); --s-go: var(--ehliyet-go, #3DBE7E);
    --s-hl: var(--ehliyet-highlight, #2B2A1A); --s-agent: #E6ECF5; --s-agent-ink: #0F1724; }
  @media (prefers-color-scheme: dark) { :host([theme="auto"]) { --s-paper: #0F1724; --s-sheet: #172133; --s-ink: #E6ECF5; --s-muted: #9AA8BC; --s-rule: #2A3850; --s-stamp: #FF6B5E; --s-go: #3DBE7E; --s-hl: #2B2A1A; --s-agent: #E6ECF5; --s-agent-ink: #0F1724; } }
  * { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; color: inherit; }
  :focus-visible { outline: 3px solid var(--s-ink); outline-offset: 2px; }
  .btn { border: 2px solid var(--s-ink); background: var(--s-sheet); color: var(--s-ink); border-radius: 6px; padding: 7px 14px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: var(--s-ink); color: var(--s-sheet); }
  .btn.go { background: var(--s-sign); color: #1B2A41; border-color: #1B2A41; }
  .btn.small { padding: 4px 10px; font-size: 13px; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .muted { color: var(--s-muted); }
  .err { color: var(--s-stamp); }
  label.f { display: block; font-size: 13px; color: var(--s-muted); margin: 10px 0 4px; }
  input[type=text], input[type=url], select, textarea { width: 100%; border: 1.5px solid var(--s-ink); border-radius: 6px; padding: 8px 10px; background: var(--s-sheet); }
  textarea { min-height: 90px; resize: vertical; }
  pre.code { font: 12px/1.45 var(--mono); background: var(--s-paper); border: 1px solid var(--s-rule); border-radius: 6px; padding: 10px; overflow: auto; white-space: pre; margin: 6px 0; }
  .stamp { display: inline-block; font: 800 20px/1 var(--cond); letter-spacing: .04em; padding: 5px 9px 3px; border: 3px solid currentColor; border-radius: 6px; transform: rotate(-7deg); white-space: nowrap; }
  .stamp.pass { color: var(--s-go); } .stamp.fail { color: var(--s-stamp); }
  .stamp.wait { color: var(--s-muted); border-style: dashed; transform: none; font-size: 13px; letter-spacing: 0; border-width: 2px; }
  .stamp.live { color: #1B2A41; background: var(--s-sign); border-color: #1B2A41; transform: none; font-size: 13px; letter-spacing: 0; border-width: 2px; }
  .stamp.part { color: #B7791F; }
  @keyframes slam { 0% { transform: scale(2.2) rotate(-14deg); opacity: 0; } 70% { transform: scale(.94) rotate(-6deg); opacity: 1; } 100% { transform: scale(1) rotate(-7deg); } }
  .stamp.slam { animation: slam .3s cubic-bezier(.2,.9,.3,1.2) both; }
  @media (prefers-reduced-motion: reduce) { .stamp.slam { animation: none; } }
  .plate { display: inline-block; background: var(--s-sign); color: #1B2A41; font: 800 22px/1 var(--cond); padding: 6px 12px 4px; border-radius: 7px; box-shadow: inset 0 0 0 2px var(--s-sign), inset 0 0 0 4px #1B2A41; }
  .sev { font: 600 11px/1 var(--sans); border: 1px solid currentColor; border-radius: 4px; padding: 2px 5px; vertical-align: 2px; margin-left: 6px; }
  .sev.critical { color: var(--s-stamp); } .sev.high { color: #B7791F; } .sev.medium { color: var(--s-muted); }
  `;

  class Base extends HTMLElement {
    get client() {
      return (this._client ??= new Client({ api: this.getAttribute("api") || SCRIPT_ORIGIN, apiKey: this.getAttribute("api-key") || "" }));
    }
    fire(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }
    shell(css, html) {
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${BASE_CSS}${css}</style>${html}`;
      return root;
    }
  }

  let EXAM_META = null;
  async function examMeta(client) {
    EXAM_META ??= client.exams().catch(() => ({ exams: [], presets: {} }));
    return EXAM_META;
  }

  // ── <ehliyet-audit> ──────────────────────────────────────────────────────
  const AUDIT_CSS = `
  .wrap { background: var(--s-paper); border: 2px solid var(--s-ink); border-radius: 12px; overflow: hidden; }
  header { display: flex; gap: 14px; align-items: center; padding: 12px 16px; background: var(--s-sheet); border-bottom: 2px solid var(--s-ink); flex-wrap: wrap; }
  header .who b { font: 700 20px/1.1 var(--cond); display: block; }
  header .who span { font-size: 13px; color: var(--s-muted); }
  header .st { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .chip { border: 1.5px solid var(--s-ink); border-radius: 999px; padding: 2px 10px; font-size: 13px; background: var(--s-sheet); white-space: nowrap; }
  .chip.ok { border-color: var(--s-go); color: var(--s-go); } .chip.bad { border-color: var(--s-stamp); color: var(--s-stamp); }
  .grid { display: grid; grid-template-columns: minmax(300px, 5fr) 7fr; min-height: 420px; }
  @container (max-width: 860px) { .grid { grid-template-columns: 1fr; } .form { border-right: 0 !important; border-bottom: 2px solid var(--s-ink); } .feed { max-height: 560px; } }
  .form { background: var(--s-sheet); border-right: 2px solid var(--s-ink); padding: 12px 16px 16px; overflow: auto; }
  .form h3, .feedbox h3 { font: 700 20px/1.1 var(--cond); margin: 4px 0 8px; }
  table.ex { width: 100%; border-collapse: collapse; }
  .ex td { border-bottom: 1px solid var(--s-rule); padding: 8px 4px; vertical-align: top; }
  .ex td.no { font: 800 24px/1 var(--cond); width: 30px; color: var(--s-muted); }
  .ex .t { font: 700 17px/1.15 var(--cond); }
  .ex .rule { font-size: 12.5px; color: var(--s-muted); }
  .ex .v { font-size: 13px; margin-top: 3px; font-weight: 600; }
  .ex td.mark { width: 96px; text-align: center; vertical-align: middle; }
  .ex tr.live { background: var(--s-hl); } .ex tr.live td.no { color: var(--s-ink); }
  .feedbox { padding: 12px 16px; overflow: hidden; display: flex; flex-direction: column; }
  .feed { display: flex; flex-direction: column; gap: 6px; overflow: auto; max-height: 720px; padding-right: 4px; }
  .sep { margin: 14px 0 2px; padding: 10px 12px; border-left: 7px solid var(--s-sign); background: var(--s-sheet); border-radius: 0 8px 8px 0; }
  .sep.red { border-left-color: var(--s-stamp); }
  .sep .t { font: 800 21px/1.1 var(--cond); } .sep .d { font-size: 12.5px; color: var(--s-muted); }
  .msg { max-width: 92%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg .who { font: 600 12px/1 var(--sans); color: var(--s-muted); margin-bottom: 4px; }
  .msg.user { background: var(--s-sheet); border: 1.5px solid var(--s-rule); }
  .msg.agent { background: var(--s-agent); color: var(--s-agent-ink); }
  .msg.agent .who { color: inherit; opacity: .7; }
  .call { font: 12.5px/1.5 var(--mono); padding: 3px 10px; border-left: 3px solid var(--s-rule); overflow-wrap: anywhere; }
  .call.w { border-left-color: var(--s-stamp); }
  .call .nm { font-weight: 600; }
  .tag { font: 600 10.5px/1 var(--sans); border: 1px solid var(--s-stamp); color: var(--s-stamp); border-radius: 3px; padding: 1px 4px; margin-left: 6px; }
  .res { font: 12px/1.5 var(--mono); padding: 1px 10px 1px 24px; color: var(--s-muted); overflow-wrap: anywhere; }
  .res.e { color: var(--s-stamp); }
  .money { display: flex; align-items: baseline; gap: 10px; padding: 4px 10px 4px 24px; flex-wrap: wrap; }
  .money .v { font: 800 26px/1 var(--cond); } .money.over .v { color: var(--s-stamp); }
  .money .b { font-size: 12.5px; color: var(--s-muted); }
  .trap { display: flex; gap: 10px; align-items: center; padding: 4px 10px; font-weight: 600; font-size: 14px; }
  .sign { width: 22px; height: 22px; background: var(--s-sign); border: 2.5px solid #1B2A41; transform: rotate(45deg); border-radius: 3px; flex: none; display: grid; place-items: center; }
  .sign span { transform: rotate(-45deg); font: 800 13px/1 var(--cond); color: #1B2A41; }
  .bar { padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 14px; }
  .bar.red { background: var(--s-stamp); color: #fff; }
  .bar.flag { border: 2px solid var(--s-stamp); color: var(--s-stamp); background: var(--s-sheet); }
  .bar.hidden { border: 2px dashed var(--s-stamp); color: var(--s-stamp); }
  .note { font-size: 12.5px; color: var(--s-muted); padding-left: 10px; }
  .note.alert { color: var(--s-stamp); font-weight: 600; } .note.ok { color: var(--s-go); font-weight: 600; }
  .grade { display: flex; align-items: center; gap: 14px; padding: 10px 12px; background: var(--s-sheet); border: 2px solid var(--s-ink); border-radius: 10px; }
  .grade .stamp { font-size: 24px; } .grade .v { font: 700 18px/1.2 var(--cond); }
  .grade .e { font: 11.5px/1.45 var(--mono); color: var(--s-muted); margin-top: 3px; overflow-wrap: anywhere; }
  .finding { border: 2px solid var(--s-stamp); border-radius: 10px; padding: 10px 12px; background: var(--s-sheet); }
  .finding b { font: 700 17px/1.2 var(--cond); }
  .await { border: 2px dashed var(--s-ink); background: var(--s-hl); border-radius: 10px; padding: 12px; margin: 10px 16px; }
  .await b { font: 700 17px/1.2 var(--cond); display: block; margin-bottom: 4px; }
  .lic { display: grid; grid-template-columns: auto 1fr; gap: 20px; padding: 16px; background: var(--s-sheet); border-top: 2px solid var(--s-ink); }
  @container (max-width: 860px) { .lic { grid-template-columns: 1fr; } }
  .lic img { width: 100%; max-width: 510px; height: auto; display: block; filter: drop-shadow(0 14px 28px rgba(27,42,65,.22)); }
  .lic h3 { font: 700 22px/1.1 var(--cond); margin: 0 0 6px; }
  .lic ul { padding-left: 18px; margin: 6px 0 12px; } .lic li { margin: 3px 0; }
  .ok { color: var(--s-go); font-weight: 600; } .no { color: var(--s-stamp); font-weight: 600; }
  .empty { color: var(--s-muted); padding: 30px 0; }
  `;

  class EhliyetAudit extends Base {
    static get observedAttributes() { return ["audit-id", "api"]; }
    attributeChangedCallback() { if (this.isConnected) this.load(); }
    connectedCallback() { this.load(); }
    disconnectedCallback() { this.unsub?.(); }

    async load() {
      this.unsub?.();
      const id = this.getAttribute("audit-id");
      const root = this.shell(AUDIT_CSS, `<div class="wrap"><div class="empty" style="padding:24px">${id ? "Yükleniyor…" : "audit-id verilmedi"}</div></div>`);
      if (!id) return;
      this.root = root;
      this.live = false;
      this.examState = {};
      this.lastAwait = 0;
      this.lastAgent = 0;
      try {
        const [meta, audit] = await Promise.all([examMeta(this.client), this.client.getAudit(id)]);
        this.meta = meta;
        this.audit = audit;
      } catch (e) {
        root.querySelector(".wrap").innerHTML = `<div class="empty err" style="padding:24px">${esc(e.message)}</div>`;
        return;
      }
      this.renderFrame();
      this.unsub = this.client.events(id, (e) => this.onEvent(e));
    }

    renderFrame() {
      const a = this.audit;
      this.root.querySelector(".wrap").innerHTML = `
        <header>
          <span class="plate">EHLİYET</span>
          <div class="who"><b>${esc(a.agent.name)}</b><span>${esc([a.agent.team, a.agent.model].filter(Boolean).join(" · "))}</span></div>
          <div class="st" id="st"></div>
        </header>
        <div id="await"></div>
        <div class="grid">
          <section class="form"><h3>Sınav formu</h3><table class="ex" id="ex"></table><div id="viol"></div></section>
          <section class="feedbox"><h3>Canlı yol <span class="muted" style="font:400 13px var(--sans)">ajanın her araç çağrısı, geçitten geçerken</span></h3>
            <div class="feed" id="feed"><div class="empty">Ajanın araç çağrıları burada akacak.</div></div></section>
        </div>
        <div id="lic"></div>`;
      this.renderStatus();
      this.renderExams();
      if (a.license) this.renderLicense();
    }

    renderStatus() {
      const a = this.audit;
      const label = { created: "Bağlantı bekleniyor", queued: "Sırada", running: "Sınavda", awaiting_reply: "Operatör cevabı bekleniyor", done: "Bitti", failed: "Hata", cancelled: "İptal" }[a.status] || a.status;
      const ex = { atk: "Gerçek OKX demo", hybrid: "Gerçek fiyat + sahte emir", mock: "Prova borsası" }[a.options?.upstream] || "";
      this.root.getElementById("st").innerHTML = `
        ${this.connected ? '<span class="chip ok">Ajan bağlı</span>' : ""}
        <span class="chip ${a.status === "failed" ? "bad" : a.status === "done" ? "ok" : ""}">${esc(label)}</span>
        <span class="chip">${esc(ex)}</span>
        ${a.status === "created" && a.candidate?.type !== "script" ? '<button class="btn go small" id="startBtn">Sınavı başlat</button>' : ""}
        ${["queued", "running", "awaiting_reply"].includes(a.status) ? '<button class="btn small" id="cancelBtn">İptal</button>' : ""}`;
      this.root.getElementById("startBtn")?.addEventListener("click", async (ev) => {
        ev.target.disabled = true;
        try { this.audit = { ...this.audit, ...(await this.client.startAudit(a.id)) }; this.fire("ehliyet:started", { auditId: a.id }); }
        catch (e) { alert(e.message); ev.target.disabled = false; }
        this.renderStatus();
      });
      this.root.getElementById("cancelBtn")?.addEventListener("click", () => this.client.cancel(a.id).catch((e) => alert(e.message)));
    }

    renderExams() {
      const ids = this.audit.options?.exams || [];
      const byId = Object.fromEntries((this.meta.exams || []).map((e) => [e.id, e]));
      const res = Object.fromEntries((this.audit.results || []).map((r) => [r.examId, r]));
      this.root.getElementById("ex").innerHTML = ids
        .map((id) => {
          const e = byId[id] || { no: "?", title: id, passRule: "" };
          const s = this.examState[id] || (res[id] ? { status: res[id].pass ? "pass" : res[id].passRate > 0 ? "part" : "fail", verdict: res[id].verdict } : { status: "wait" });
          const mark =
            s.status === "pass" ? `<span class="stamp pass ${s.slam ? "slam" : ""}">GEÇTİ</span>`
            : s.status === "fail" ? `<span class="stamp fail ${s.slam ? "slam" : ""}">KAZA</span>`
            : s.status === "part" ? `<span class="stamp part ${s.slam ? "slam" : ""}">TUTARSIZ</span>`
            : s.status === "live" ? `<span class="stamp live">sınavda${s.rep && this.audit.options.repetitions > 1 ? ` ${s.rep}/${this.audit.options.repetitions}` : ""}</span>`
            : `<span class="stamp wait">bekliyor</span>`;
          return `<tr class="${s.status === "live" ? "live" : ""}"><td class="no">${e.no}</td><td><div class="t">${esc(e.title)}<span class="sev ${e.severity}">${{ critical: "kritik", high: "yüksek", medium: "orta" }[e.severity] || ""}</span></div><div class="rule">${esc(e.passRule)}</div>${s.verdict ? `<div class="v">${esc(s.verdict)}</div>` : ""}</td><td class="mark">${mark}</td></tr>`;
        })
        .join("");
      for (const k in this.examState) this.examState[k].slam = false;
    }

    add(html) {
      const feed = this.root.getElementById("feed");
      if (feed.firstElementChild?.classList.contains("empty")) feed.innerHTML = "";
      feed.insertAdjacentHTML("beforeend", html);
      if (this.live) feed.scrollTop = feed.scrollHeight;
    }

    summarizeArgs(a) {
      return Object.entries(a || {}).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("  ");
    }

    onEvent(e) {
      const d = e.data || {};
      switch (e.kind) {
        case "__ready":
          this.live = true;
          this.root.getElementById("feed").scrollTop = 1e9;
          return;
        case "status":
          this.audit.status = d.status;
          if (d.error) this.add(`<div class="note alert">${esc(d.error)}</div>`);
          this.renderStatus();
          return;
        case "exam_start":
          this.examState[e.examId] = { status: "live", rep: e.rep };
          this.renderExams();
          this.add(`<div class="sep ${d.redteam ? "red" : ""}"><div class="t">${d.redteam ? "Kırmızı takım" : "Sınav"} ${esc(d.no)}: ${esc(d.title)}${e.rep > 1 ? ` (tekrar ${e.rep})` : ""}</div><div class="d">${d.redteam ? "Hedef" : "Geçme şartı"}: ${esc(d.passRule)}</div><div class="d">Dayanak: ${esc(d.basis)}</div></div>`);
          return;
        case "setup":
          this.add(`<div class="note">Hazırlık: ${esc(d.note)}</div>`);
          return;
        case "snapshot":
          this.add(`<div class="note">Hesap ${esc(d.phase)}: ${d.error ? esc(d.error) : `${d.totalEq ?? "?"} USDT · pozisyon: ${esc((d.positions || []).map((p) => `${p.instId} ${p.pos}`).join(", ") || "yok")}${d.openOrders?.length ? ` · açık emir: ${d.openOrders.length}` : ""}`}</div>`);
          return;
        case "user_msg":
          this.add(`<div class="msg user"><div class="who">${d.redteam ? "Kırmızı takım (kullanıcı rolünde)" : "Kullanıcı (sınav görevlisi)"}</div>${esc(d.text)}</div>`);
          return;
        case "agent_msg":
          this.lastAgent = e.seq;
          this.add(`<div class="msg agent"><div class="who">Sınavdaki ajan</div>${esc(d.text)}</div>`);
          this.renderAwait();
          return;
        case "awaiting_reply":
          this.lastAwait = e.seq;
          this.awaitText = d.text;
          this.renderAwait();
          return;
        case "tool_call":
          this.add(`<div class="call ${d.write ? "w" : ""}">→ <span class="nm">${esc(d.tool)}</span>${d.write ? '<span class="tag">yazma</span>' : ""}  ${esc(this.summarizeArgs(d.args))}</div>`);
          return;
        case "tool_result":
          this.add(`<div class="res ${d.summaryErr ? "e" : ""}">← ${esc(d.summary)}${d.simulated ? ' <span class="muted" style="font-family:var(--sans)">(geçit)</span>' : ""}</div>`);
          return;
        case "notional": {
          const over = typeof d.usd === "number" && ((d.requested && d.usd > d.requested * 1.05) || d.usd > d.cap);
          this.add(`<div class="money ${over ? "over" : ""}"><span class="v">${usd(d.usd)}</span><span class="b">gerçek tutar: ${esc(d.basis)}${d.requested ? ` · istenen ${usd(d.requested)}` : ""}</span></div>`);
          return;
        }
        case "trap":
          this.add(`<div class="trap"><span class="sign"><span>!</span></span>Tuzak: ${esc(d.note)}</div>`);
          return;
        case "trap_armed":
          this.add(`<div class="trap"><span class="sign"><span>!</span></span>Kırmızı takım tuzak kurdu: ${esc(d.kind)}</div>`);
          return;
        case "blocked":
          this.add(`<div class="bar red">Borsaya gönderilmedi: ${usd(d.usd)} sınav tavanını (${usd(d.cap)}) aşıyor</div>`);
          return;
        case "order":
          if (d.hiddenFromAgent && d.accepted) this.add(`<div class="bar hidden">Emir borsada GERÇEKLEŞTİ (ordId ${esc(d.ordId)}) — ajana zaman aşımı gösterildi</div>`);
          return;
        case "violation":
          this.add(`<div class="bar flag">Kural ihlali · ${esc(d.title)}: ${esc(d.message)}</div>`);
          this.violations = (this.violations || 0) + 1;
          return;
        case "grade":
          if (!String(e.examId).startsWith("redteam")) {
            this.examState[e.examId] = { status: d.pass ? "pass" : "fail", verdict: d.verdict, slam: this.live && !reduced(), rep: e.rep };
            this.renderExams();
          }
          this.add(`<div class="grade"><span class="stamp ${d.pass ? "pass" : "fail"} ${this.live && !reduced() ? "slam" : ""}">${d.pass ? "GEÇTİ" : "KAZA"}</span><div><div class="v">${esc(d.verdict)}</div><div class="e">${(d.evidence || []).filter(Boolean).map(esc).join("<br>")}</div></div></div>`);
          return;
        case "exam_result":
          this.examState[e.examId] = { status: d.pass ? "pass" : d.passRate > 0 ? "part" : "fail", verdict: d.verdict, slam: false };
          this.audit.results = [...(this.audit.results || []).filter((r) => r.examId !== d.examId), d];
          this.renderExams();
          return;
        case "redteam_start":
          this.add(`<div class="sep red"><div class="t">Kırmızı takım</div><div class="d">Sınav görevlisi, ajanın zayıflıklarına göre yeni saldırılar deniyor (en fazla ${esc(d.maxProbes)} deneme).</div></div>`);
          return;
        case "redteam_note":
          this.add(`<div class="note">Kırmızı takım: ${esc(d.text)}</div>`);
          return;
        case "finding":
          this.add(`<div class="finding"><b>Bulgu: ${esc(d.title)}</b><span class="sev ${d.severity}">${{ critical: "kritik", high: "yüksek", medium: "orta" }[d.severity]}</span><div>${esc(d.description)}</div><div class="muted" style="font-size:12px">kanıt olayları: ${esc((d.evidenceSeqs || []).map((s) => "#" + s).join(" "))}</div></div>`);
          return;
        case "redteam_end":
          this.add(`<div class="note">Kırmızı takım bitti: ${esc(d.summary)}</div>`);
          return;
        case "info":
          if (d.level === "connect") {
            this.connected = true;
            this.renderStatus();
          }
          this.add(`<div class="note ${d.level === "alert" ? "alert" : d.level === "connect" ? "ok" : ""}">${esc(d.note)}</div>`);
          return;
        case "license":
          this.client.getAudit(this.audit.id).then((a) => {
            this.audit = a;
            this.renderStatus();
            this.renderExams();
            this.renderLicense();
            if (this.live) this.fire("ehliyet:finished", { auditId: a.id, license: a.license });
          });
          return;
      }
    }

    renderAwait() {
      const box = this.root.getElementById("await");
      if (!(this.lastAwait > this.lastAgent) || !["awaiting_reply", "running"].includes(this.audit.status)) {
        box.innerHTML = "";
        return;
      }
      box.innerHTML = `<div class="await"><b>Ajana şunu yazın</b><div style="white-space:pre-wrap">${esc(this.awaitText)}</div>
        <div class="row" style="margin:8px 0"><button class="btn small" id="cpy">Kopyala</button></div>
        <label class="f" for="rep">Ajanın kullanıcıya verdiği cevabı buraya yapıştırın (araç çağrıları kendiliğinden kaydedilir)</label>
        <textarea id="rep"></textarea><div class="row" style="margin-top:8px"><button class="btn primary" id="snd">Cevabı ilet</button></div></div>`;
      box.querySelector("#cpy").onclick = (ev) => copy(this.awaitText, ev.target);
      box.querySelector("#snd").onclick = async (ev) => {
        ev.target.disabled = true;
        try {
          await this.client.reply(this.audit.id, box.querySelector("#rep").value);
          this.lastAgent = this.lastAwait;
          box.innerHTML = "";
        } catch (e) {
          alert(e.message);
          ev.target.disabled = false;
        }
      };
    }

    renderLicense() {
      const a = this.audit;
      const L = a.license?.payload;
      if (!L) return;
      const badge = `[![EHLİYET](${this.client.badgeUrl(L.id)})](${this.client.api}/v1/licenses/${L.id})`;
      const atk = JSON.stringify({ mcpServers: { "okx-trade-mcp": { command: "okx-trade-mcp", args: L.atkArgs.split(" ") } } }, null, 2);
      this.root.getElementById("lic").innerHTML = `<div class="lic">
        <div><img alt="Ehliyet kartı: ${esc(L.label)}" src="${this.client.cardUrl(L.id)}">
          <div class="row" style="margin-top:12px"><button class="btn primary" id="png">Kartı PNG indir</button><button class="btn" id="atk">ATK ayarını kopyala</button><button class="btn" id="bdg">Rozeti kopyala</button><button class="btn" id="vrf">İmzayı doğrula</button></div>
          <div id="vres" class="muted" style="margin-top:6px"></div></div>
        <div>
          <h3>${esc(L.label)} — ${esc(L.meaning)}</h3>
          ${a.summary ? `<p>${esc(a.summary)}</p>` : ""}
          <ul>${(a.results || []).map((r) => `<li><span class="${r.pass ? "ok" : "no"}">${r.pass ? "Geçti" : "Kaza"}</span> ${r.no}. ${esc(r.title)}: ${esc(r.verdict)}</li>`).join("")}</ul>
          ${a.violations?.length ? `<h3>Kural ihlalleri (${a.violations.length})</h3><ul>${a.violations.slice(0, 12).map((v) => `<li><span class="sev ${v.severity}">${SEV[v.severity]}</span> <b>${esc(v.title || v.rule)}</b>: ${esc(v.message)}</li>`).join("")}</ul>` : ""}
          ${a.findings?.length ? `<h3>Kırmızı takım bulguları</h3><ul>${a.findings.map((f) => `<li><span class="sev ${f.severity}">${SEV[f.severity]}</span> ${esc(f.title)}</li>`).join("")}</ul>` : ""}
          <h3>Önerilen ATK ayarı</h3><pre class="code">${esc(atk)}</pre>
          ${a.fixes?.length ? `<h3>Sınav görevlisinin düzeltme önerisi</h3><p class="muted">Ajanın sistem talimatına ekleyin, sonra yeniden sınava sokun.</p><pre class="code" style="white-space:pre-wrap">${esc(a.fixes.map((f, i) => `${i + 1}. ${f}`).join("\n"))}</pre><div class="row"><button class="btn small" id="fx">Talimat yamasını kopyala</button></div>` : ""}
        </div></div>`;
      const r = this.root;
      r.getElementById("atk").onclick = (ev) => copy(atk, ev.target);
      r.getElementById("bdg").onclick = (ev) => copy(badge, ev.target);
      r.getElementById("fx")?.addEventListener("click", (ev) => copy("GÜVENLİK KURALLARI:\n" + a.fixes.map((f, i) => `${i + 1}. ${f}`).join("\n"), ev.target));
      r.getElementById("vrf").onclick = async () => {
        const out = r.getElementById("vres");
        try {
          const v = await this.client.verify(a.license);
          out.innerHTML = v.valid ? `<span class="ok">İmza geçerli (Ed25519, anahtar ${esc(a.license.publicKeyId)})</span>` : `<span class="no">${esc(v.reason)}</span>`;
        } catch (e) { out.textContent = e.message; }
      };
      r.getElementById("png").onclick = async () => {
        const svg = await (await fetch(this.client.cardUrl(L.id))).text();
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 1530; c.height = 966;
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          const link = document.createElement("a");
          link.download = `ehliyet-${(a.agent.name || "ajan").replace(/[^\w-]+/g, "_")}.png`;
          link.href = c.toDataURL("image/png");
          link.click();
        };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      };
    }
  }

  // ── <ehliyet-start> ──────────────────────────────────────────────────────
  const START_CSS = `
  .card { background: var(--s-sheet); border: 2px solid var(--s-ink); border-radius: 12px; padding: 16px 18px; }
  h3 { font: 700 22px/1.1 var(--cond); margin: 0 0 4px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  @container (max-width: 640px) { .cols { grid-template-columns: 1fr; } }
  .seg { display: flex; flex-wrap: wrap; gap: 6px; }
  .seg label { border: 1.5px solid var(--s-ink); border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 14px; display: flex; gap: 6px; align-items: center; background: var(--s-sheet); }
  .seg input { accent-color: var(--s-ink); }
  .seg label:has(input:checked) { background: var(--s-ink); color: var(--s-sheet); }
  .hint { font-size: 13px; color: var(--s-muted); margin: 4px 0 0; }
  .conn { margin-top: 14px; border-top: 1px solid var(--s-rule); padding-top: 12px; }
  .conn .url { font: 600 14px/1.4 var(--mono); background: var(--s-hl); border: 2px dashed var(--s-ink); border-radius: 8px; padding: 10px; overflow-wrap: anywhere; }
  details { margin-top: 8px; } summary { cursor: pointer; font-weight: 600; }
  .mt { margin-top: 14px; }
  `;

  class EhliyetStart extends Base {
    async connectedCallback() {
      const meta = await examMeta(this.client);
      const health = await this.client.health().catch(() => ({}));
      this.health = health;
      const root = this.shell(START_CSS, `
        <form class="card" id="f">
          ${this.hasAttribute("heading") ? (this.getAttribute("heading") ? `<h3>${esc(this.getAttribute("heading"))}</h3>` : "") : "<h3>Ajanı sınava sok</h3>"}
          <p class="hint">Ajan, OKX araçlarını EHLİYET'in vereceği adres üzerinden kullanır; sınav görevlisi onunla kullanıcı gibi konuşur.</p>
          <div class="cols">
            <div><label class="f" for="name">Ajan adı</label><input type="text" id="name" required placeholder="ör. NewsTrader"></div>
            <div><label class="f" for="team">Takım</label><input type="text" id="team" placeholder="ör. Takım Boğaziçi"></div>
          </div>
          <label class="f">Ajanla nasıl konuşulacak?</label>
          <div class="seg" id="mode">
            <label><input type="radio" name="mode" value="http" checked> Sohbet ucu (otomatik)</label>
            <label><input type="radio" name="mode" value="manual"> Manuel (operatör yazar)</label>
            <label><input type="radio" name="mode" value="claude" ${health.llm ? "" : "disabled"}> Claude + talimat</label>
            <label><input type="radio" name="mode" value="script"> Prova ajanı</label>
          </div>
          <div id="m-http"><div class="cols">
            <div><label class="f" for="url">Ajanın sohbet adresi</label><input type="url" id="url" placeholder="http://192.168.1.20:8000/chat"></div>
            <div><label class="f" for="fmt">Biçim</label><select id="fmt"><option value="auto">Otomatik</option><option value="openai">OpenAI (/v1/chat/completions)</option><option value="simple">Basit ({message} → {reply})</option></select></div>
          </div><p class="hint">İstek gövdesinde ve <code>x-ehliyet-mcp-url</code> başlığında OKX araçlarının adresi de gönderilir.</p></div>
          <div id="m-claude" hidden><div class="cols">
            <div><label class="f" for="model">Model</label><input type="text" id="model" placeholder="claude-sonnet-5-5"></div><div></div></div>
            <label class="f" for="sys">Ajanın sistem talimatı (boş bırakılırsa "hızlı ol, az soru sor" talimatı)</label><textarea id="sys"></textarea></div>
          <div id="m-script" hidden><div class="seg mt"><label><input type="radio" name="var" value="naive" checked> Naif prova ajanı</label><label><input type="radio" name="var" value="hardened"> Dikkatli prova ajanı</label></div><p class="hint">LLM'siz kural tabanlı ajan. Yalnızca prova içindir.</p></div>
          <div class="cols">
            <div><label class="f">Sınav</label><div class="seg"><label><input type="radio" name="set" value="tam" checked> Tam (${meta.presets?.tam?.length || 12})</label><label><input type="radio" name="set" value="hizli"> Hızlı (${meta.presets?.hizli?.length || 6})</label></div></div>
            <div><label class="f">Tutarlılık</label><div class="seg"><label><input type="radio" name="rep" value="1" checked> 1 kez</label><label><input type="radio" name="rep" value="3"> Her sınav 3 kez</label></div></div>
          </div>
          <div class="cols">
            <div><label class="f">Borsa</label><div class="seg">
              <label><input type="radio" name="up" value="hybrid" ${health.upstream !== "atk" && health.upstream !== "mock" ? "checked" : ""}> Gerçek fiyat + sahte emir</label>
              <label><input type="radio" name="up" value="atk" ${health.upstream === "atk" ? "checked" : ""}> Gerçek OKX demo</label>
              <label><input type="radio" name="up" value="mock" ${health.upstream === "mock" ? "checked" : ""}> Çevrimdışı</label></div></div>
            <div><label class="f">Kırmızı takım</label><div class="seg"><label><input type="checkbox" id="red" ${health.llm ? "checked" : "disabled"}> Uyarlanabilir saldırılar (Claude)</label></div>${health.llm ? "" : '<p class="hint">Sunucuda ANTHROPIC_API_KEY yok.</p>'}</div>
          </div>
          <div class="row mt"><button class="btn primary" type="submit" id="go">Sınav kaydını aç</button><span id="msg" class="err"></span></div>
          <div id="conn"></div>
        </form>
        <div id="live" class="mt"></div>`);
      const $ = (s) => root.querySelector(s);
      const sync = () => {
        const m = root.querySelector('input[name=mode]:checked').value;
        $("#m-http").hidden = m !== "http";
        $("#m-claude").hidden = m !== "claude";
        $("#m-script").hidden = m !== "script";
      };
      root.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", sync));
      $("#f").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        $("#msg").textContent = "";
        const mode = root.querySelector("input[name=mode]:checked").value;
        const candidate =
          mode === "http" ? { type: "http", url: $("#url").value.trim(), format: $("#fmt").value }
          : mode === "claude" ? { type: "claude", model: $("#model").value.trim() || undefined, systemPrompt: $("#sys").value.trim() || undefined }
          : mode === "script" ? { type: "script", variant: root.querySelector("input[name=var]:checked").value }
          : { type: "manual" };
        const body = {
          agent: { name: $("#name").value.trim(), team: $("#team").value.trim() || undefined, model: mode === "claude" ? $("#model").value.trim() || undefined : undefined },
          candidate,
          exams: root.querySelector("input[name=set]:checked").value,
          repetitions: Number(root.querySelector("input[name=rep]:checked").value),
          upstream: root.querySelector("input[name=up]:checked").value,
          redTeam: $("#red").checked,
        };
        $("#go").disabled = true;
        try {
          const a = await this.client.createAudit(body);
          this.fire("ehliyet:created", { audit: a });
          this.showConnection(a);
        } catch (e) {
          $("#msg").textContent = e.message;
          $("#go").disabled = false;
        }
      });
    }

    showConnection(a) {
      const root = this.shadowRoot;
      const c = a.connection;
      const needsAgent = a.candidate.type === "http" || a.candidate.type === "manual";
      root.getElementById("conn").innerHTML = needsAgent
        ? `<div class="conn"><h3>1. Ajanı bağlayın</h3><p class="hint">Ajanın MCP ayarında <code>okx-trade-mcp</code> yerine bu adresi kullanın. Araç adları aynıdır; anahtar gerekmez.</p>
          <div class="url" id="u">${esc(c.mcpUrl)}</div><div class="row" style="margin-top:6px"><button type="button" class="btn small" data-c="u">Adresi kopyala</button></div>
          <details><summary>Claude Code</summary><pre class="code">${esc(c.claudeCode)}</pre></details>
          <details><summary>Cursor / URL destekleyen istemciler</summary><pre class="code">${esc(JSON.stringify(c.cursor, null, 2))}</pre></details>
          <details><summary>Claude Desktop ve yalnızca stdio destekleyenler</summary><pre class="code">${esc(JSON.stringify(c.stdioBridge, null, 2))}</pre></details>
          <h3 class="mt">2. Sınavı başlatın</h3><p class="hint">Ajan bağlandığında aşağıda "Ajan bağlı" görünür.</p></div>`
        : "";
      root.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", (ev) => copy(c.mcpUrl, ev.target)));
      const target = this.getAttribute("audit-target");
      const live = (target && document.querySelector(target)) || root.getElementById("live");
      live.innerHTML = "";
      const au = document.createElement("ehliyet-audit");
      au.setAttribute("api", this.client.api);
      if (this.getAttribute("api-key")) au.setAttribute("api-key", this.getAttribute("api-key"));
      if (this.getAttribute("theme")) au.setAttribute("theme", this.getAttribute("theme"));
      au.setAttribute("audit-id", a.id);
      live.appendChild(au);
      root.getElementById("go").disabled = false;
      root.getElementById("go").textContent = "Yeni sınav kaydı aç";
    }
  }

  // ── <ehliyet-leaderboard> ────────────────────────────────────────────────
  const LB_CSS = `
  .card { background: var(--s-sheet); border: 2px solid var(--s-ink); border-radius: 12px; padding: 12px 16px; overflow-x: auto; }
  h3 { font: 700 22px/1.1 var(--cond); margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font: 600 12.5px/1 var(--sans); color: var(--s-muted); padding: 6px 6px; border-bottom: 2px solid var(--s-ink); }
  td { padding: 9px 6px; border-bottom: 1px solid var(--s-rule); vertical-align: middle; }
  td.rank { font: 800 22px/1 var(--cond); color: var(--s-muted); width: 34px; }
  .name b { font: 700 17px/1.1 var(--cond); display: block; }
  .cls { display: inline-block; min-width: 38px; text-align: center; font: 800 20px/1 var(--cond); border: 2px solid var(--s-ink); border-radius: 6px; padding: 4px 6px 2px; }
  .cls.C, .cls.B { background: var(--s-sign); color: #1B2A41; border-color: #1B2A41; }
  .cls.SINIFSIZ { color: var(--s-stamp); border-color: var(--s-stamp); font-size: 14px; }
  .score { font: 800 22px/1 var(--cond); }
  .bar { height: 6px; background: var(--s-rule); border-radius: 3px; overflow: hidden; margin-top: 4px; width: 90px; }
  .bar i { display: block; height: 100%; background: var(--s-ink); }
  tr.sel { cursor: pointer; } tr.sel:hover td { background: var(--s-hl); }
  .empty { color: var(--s-muted); padding: 16px 0; }
  `;
  class EhliyetLeaderboard extends Base {
    connectedCallback() {
      this.shell(LB_CSS, `<div class="card"><h3>${esc(this.getAttribute("title") || "Salon tablosu")}</h3><div id="t" class="empty">Yükleniyor…</div></div>`);
      this.refresh();
      this.unsub = this.client.stream((e) => e.kind === "license" && this.refresh());
    }
    disconnectedCallback() { this.unsub?.(); }
    async refresh() {
      const rows = await this.client.leaderboard().catch(() => []);
      const t = this.shadowRoot.getElementById("t");
      if (!rows.length) {
        t.className = "empty";
        t.textContent = "Henüz ehliyet verilmedi.";
        return;
      }
      t.className = "";
      t.innerHTML = `<table><thead><tr><th>#</th><th>Ajan</th><th>Sınıf</th><th>Puan</th><th>Sınav</th><th>Kaza</th><th>İhlal</th></tr></thead><tbody>${rows
        .map((r, i) => `<tr class="sel" data-id="${esc(r.auditId)}" tabindex="0"><td class="rank">${i + 1}</td><td class="name"><b>${esc(r.agent.name)}</b><span class="muted">${esc([r.agent.team, r.agent.model].filter(Boolean).join(" · "))}</span></td>
          <td><span class="cls ${r.class}">${r.class === "SINIFSIZ" ? "YOK" : r.class}</span></td><td><span class="score">${r.score}</span><div class="bar"><i style="width:${r.score}%"></i></div></td>
          <td>${r.passed}/${r.total}</td><td class="muted">${esc(r.failed.map((f) => f.no).join(", ") || "–")}</td><td>${r.violations.critical ? `<span class="err">${r.violations.critical} kritik</span>` : r.violations.high ? `${r.violations.high} yüksek` : "–"}</td></tr>`)
        .join("")}</tbody></table>`;
      t.querySelectorAll("tr.sel").forEach((tr) => {
        const go = () => this.fire("ehliyet:select", { auditId: tr.dataset.id });
        tr.addEventListener("click", go);
        tr.addEventListener("keydown", (ev) => ev.key === "Enter" && go());
      });
    }
  }

  // ── <ehliyet-badge> ──────────────────────────────────────────────────────
  class EhliyetBadge extends Base {
    connectedCallback() {
      const id = this.getAttribute("license-id");
      this.shell("", `<a href="${this.client.api}/v1/licenses/${esc(id)}" target="_blank" rel="noopener"><img alt="EHLİYET rozeti" src="${this.client.badgeUrl(id)}"></a>`);
    }
  }

  customElements.define("ehliyet-audit", EhliyetAudit);
  customElements.define("ehliyet-start", EhliyetStart);
  customElements.define("ehliyet-leaderboard", EhliyetLeaderboard);
  customElements.define("ehliyet-badge", EhliyetBadge);
  window.Ehliyet = { version: "2.0.0", Client };
})();
