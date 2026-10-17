// Denetim sayfası: başlık, bağlantı/operatör paneli, sonuç (ehliyet + sigorta) ve dört sekme:
// Sınav (form + canlı yol) · Ehliyet · Sigorta · Kanıt.
import { api, isSnapshot, BASE } from "./api.js";
import { Feed, reduceExamState } from "./feed.js";
import {
  $, $$, esc, enc, fmtDate, fmtTime, fmtDur, sevTag, statusChip, STATUS, ACTIVE, UPSTREAM, candidateLabel, clsBadge, CLASS_TEXT, I, BIG, AVAX, shortHash, money, pct, dec, copyText, toast, reducedMotion,
} from "./util.js";

let cur = null; // şu an açık denetim
const AUTH_SHORT = { C: "canlı hesap, spot ve vadeli", B: "canlı hesap, yalnız spot", A: "yalnız demo hesap", SINIFSIZ: "salt okuma" };
const DETAIL_KEY = "ehliyet:feed-detail";
const readDetail = () => {
  try {
    return localStorage.getItem(DETAIL_KEY) === "1";
  } catch {
    return false;
  }
};

export function unmountAudit() {
  cur?.unsub?.();
  cur = null;
}

export async function mountAudit(main, ctx, id, tab) {
  if (cur && cur.id === id) {
    cur.tab = tab;
    renderTabs();
    renderPane();
    return;
  }
  unmountAudit();
  main.innerHTML = `<p class="loading">Denetim yükleniyor…</p>`;
  let audit, events;
  try {
    [audit, events] = await Promise.all([api.audit(id), api.events(id)]);
  } catch (e) {
    main.innerHTML = `<div class="card empty"><strong>Denetim bulunamadı</strong>${esc(e.message)}<div class="actions"><a class="btn" href="#/">Sıralamaya dön</a></div></div>`;
    return;
  }
  cur = {
    id,
    tab,
    ctx,
    main,
    audit,
    events: [],
    seen: new Set(),
    exam: {},
    connected: false,
    awaitText: null,
    lastAwait: 0,
    lastAgent: 0,
    live: false,
    follow: true,
    detail: readDetail(),
    feed: null,
    unsub: null,
    reasons: [],
    policy: null,
  };
  for (const e of events) ingest(e, false);
  renderShell();
  if (ACTIVE.has(audit.status) && !isSnapshot()) subscribe();
}

function subscribe() {
  const since = cur.events.at(-1)?.seq ?? 0;
  const me = cur;
  cur.unsub = api.stream(
    cur.id,
    since,
    (e) => me === cur && onLive(e),
    () => me === cur && (cur.live = true),
  );
}

// ───────────── model ─────────────
function ingest(e, live) {
  if (cur.seen.has(e.seq)) return false;
  cur.seen.add(e.seq);
  cur.events.push(e);
  reduceExamState(cur.exam, e);
  const d = e.data ?? {};
  if (e.kind === "info" && d.level === "connect") cur.connected = true;
  if (e.kind === "awaiting_reply") {
    cur.awaitText = d.text;
    cur.lastAwait = e.seq;
  }
  if (e.kind === "agent_msg") cur.lastAgent = e.seq;
  // Geçmiş olaylar güncel durumu ezmemeli; yalnızca canlı olaylar durumu değiştirir
  if (live && e.kind === "status") cur.audit.status = d.status;
  if (e.kind === "license") {
    cur.reasons = d.classReasons ?? [];
    if (live) cur.audit.status = "done";
  }
  if (live) {
    const A = cur.audit;
    if (e.kind === "exam_result") A.results = [...(A.results ?? []).filter((r) => r.examId !== d.examId), d];
    if (e.kind === "violation") A.violations = [...(A.violations ?? []), { id: `v${e.seq}`, rule: d.rule, title: d.title, severity: d.severity, examId: e.examId, rep: e.rep, message: d.message, seq: e.seq }];
    if (e.kind === "finding") A.findings = [...(A.findings ?? []), d];
    if (e.kind === "anchor") A.chain = { ...(A.chain ?? {}), ...d };
    if (e.kind === "coverage") A.coverage = { policyId: d.policyId, perClaimUsd: d.perClaimUsd, deductiblePct: d.deductiblePct, paidUsd: 0, claims: 0 };
    if (e.kind === "claim" && d.status === "paid" && A.coverage) {
      A.coverage.paidUsd = Math.round((A.coverage.paidUsd + d.amountUsd) * 100) / 100;
      A.coverage.claims++;
    }
  }
  return true;
}

async function onLive(e) {
  if (!ingest(e, true)) return;
  const d = e.data ?? {};
  if (cur.tab === "sinav" && cur.feed) {
    const el = cur.feed.add(e, cur.live && !reducedMotion());
    if (el && cur.follow) {
      const sc = $("#feedScroll");
      if (sc) sc.scrollTop = sc.scrollHeight;
    }
    if (["exam_start", "grade", "exam_result", "violation", "finding", "claim"].includes(e.kind)) renderForm();
  }
  if (cur.live && e.kind === "grade" && !d.pass && !String(e.examId).startsWith("redteam")) toast(`Kaza · Sınav ${d.no}`, d.verdict, "bad");
  if (cur.live && e.kind === "claim" && d.status === "paid") toast(`Tazminat ödendi · ${money(d.amountUsd)}`, `${(d.titles ?? []).join(", ")} · kanıt #${d.refSeq}`, "go");
  if (cur.live && e.kind === "anchor" && d.status === "confirmed") toast("Ehliyet Avalanche'a yazıldı", d.block ? `Blok ${d.block} · değiştirilemez` : "Kayıt zincirde", "go");
  if (cur.live && e.kind === "anchor" && d.status === "failed") toast("Avalanche kaydı yapılamadı", d.error ?? "", "bad");
  if (e.kind === "anchor" && d.status !== "pending") {
    renderOutcome();
    if (cur.tab === "ehliyet") renderPane();
  }
  if (["status", "awaiting_reply", "agent_msg", "info", "coverage", "claim"].includes(e.kind)) {
    renderHead();
    renderPanel();
    renderOutcome();
  }
  renderTabs();
  if (e.kind === "policy" || (e.kind === "status" && !ACTIVE.has(d.status))) {
    try {
      cur.audit = await api.audit(cur.id);
    } catch {
      /* bir sonraki olayda */
    }
    cur.policy = null;
    renderHead();
    renderPanel();
    renderOutcome();
    renderTabs();
    if (cur.tab !== "sinav") renderPane();
    else {
      renderForm();
      if (!ACTIVE.has(cur.audit.status)) $("#followWrap")?.remove();
    }
    // Akış açık kalır: Avalanche onayı ("anchor") ehliyetten sonra gelir
  }
}

// ───────────── iskelet ─────────────
function renderShell() {
  const a = cur.audit;
  cur.main.innerHTML = `
    <div class="eyebrow"><a href="#/">Sıralama</a><span aria-hidden="true">/</span><span>Denetim</span><span class="mono faint">${esc(a.id)}</span></div>
    <header class="audit-head">
      <div><h1 id="aTitle"></h1><div class="meta" id="aMeta"></div></div>
      <div class="actions" id="aActions"></div>
    </header>
    <div id="aPanel"></div>
    <div id="aOutcome"></div>
    <nav class="tabs" id="aTabs" aria-label="Denetim sekmeleri"></nav>
    <div id="aPane"></div>`;
  renderHead();
  renderPanel();
  renderOutcome();
  renderTabs();
  renderPane();
}

function renderHead() {
  const a = cur.audit;
  const live = ACTIVE.has(a.status) && !isSnapshot();
  const o0 = a.options ?? {};
  $("#aTitle").innerHTML = `${esc(a.agent.name)} ${statusChip(a.status)}${
    cur.connected && live && ["http", "manual"].includes(a.candidate?.type) ? ' <span class="pill go">Ajan bağlı</span>' : ""
  }${a.coverage ? ' <span class="pill go">Poliçe kapsamında</span>' : ""} <span class="pill ${o0.upstream === "atk" ? "warn" : ""}" title="${esc(UPSTREAM[o0.upstream]?.where ?? "")}">${esc(UPSTREAM[o0.upstream]?.orders ?? "")}</span>`;
  const o = a.options ?? {};
  const presetName =
    o.exams?.length === (cur.ctx.exams?.exams?.length ?? 12) ? "Tam sınav" : o.exams?.length === 6 && cur.ctx.exams?.presets?.hizli?.every((x) => o.exams.includes(x)) ? "Hızlı sınav" : `${o.exams?.length ?? 0} sınav`;
  const dur = a.startedAt && a.finishedAt ? fmtDur(Date.parse(a.finishedAt) - Date.parse(a.startedAt)) : null;
  const parts = [
    a.agent.team && esc(a.agent.team),
    a.agent.model && a.agent.model !== "bilinmiyor" && `<span class="mono">${esc(a.agent.model)}</span>`,
    esc(candidateLabel(a.candidate)),
    esc(UPSTREAM[o.upstream]?.long ?? o.upstream ?? ""),
    `${esc(presetName)}${o.repetitions > 1 ? ` × ${o.repetitions}` : ""}`,
    o.redTeam && !a.reduced?.includes("redTeam") ? "Kırmızı takım" : null,
    !live ? `${esc(fmtDate(a.finishedAt ?? a.createdAt))}${dur ? ` · ${esc(dur)}` : ""}` : null,
  ].filter(Boolean);
  $("#aMeta").innerHTML = parts.map((p) => `<span>${p}</span>`).join("");

  const acts = [];
  if (a.status === "created" && !isSnapshot()) acts.push(`<button class="btn btn-primary" id="startBtn" type="button">${I.play} Sınavı başlat</button>`);
  if (live) acts.push(`<button class="btn" id="cancelBtn" type="button">${I.stop} İptal</button>`);
  if (a.status === "done" && !isSnapshot()) acts.push(`<a class="btn" href="#/yeni?from=${enc(a.id)}">${I.retry} Yeniden sına</a>`);
  acts.push(`<button class="btn" id="linkBtn" type="button" title="Bu denetimin bağlantısını kopyala">${I.link} Bağlantı</button>`);
  $("#aActions").innerHTML = acts.join("");
  $("#startBtn")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await api.start(a.id);
      // Canlı akış durumu zaten ilerletmiş olabilir; yalnızca hâlâ "created" ise güncelle
      if (cur.audit.status === "created") cur.audit.status = "queued";
      if (!cur.unsub) subscribe();
    } catch (e) {
      toast("Başlatılamadı", e.message, "bad");
    }
    renderHead();
    renderPanel();
  });
  $("#cancelBtn")?.addEventListener("click", async (ev) => {
    if (!confirm("Denetim iptal edilsin mi? Bu sınav için ehliyet verilmez.")) return;
    ev.currentTarget.disabled = true;
    try {
      await api.cancel(a.id);
    } catch (e) {
      toast("İptal edilemedi", e.message, "bad");
    }
  });
  $("#linkBtn").addEventListener("click", (ev) => copyText(location.href.split("#")[0] + `#/denetim/${a.id}`, ev.currentTarget));
}

// Bağlantı / operatör / hata paneli
function renderPanel() {
  const box = $("#aPanel");
  if (!box) return;
  const a = cur.audit;
  const c = a.connection;
  const type = a.candidate?.type;
  if (a.status === "failed") {
    box.innerHTML = `<div class="bar red" style="margin-bottom:24px">Denetim tamamlanamadı<small>${esc(a.error ?? "Bilinmeyen hata")}</small></div>`;
    return;
  }
  const awaiting = cur.lastAwait > cur.lastAgent && ["awaiting_reply", "running"].includes(a.status);
  if (awaiting && type === "manual") {
    box.innerHTML = `<section class="panel" aria-live="polite">
      <h2>Ajana şunu yazın</h2>
      <pre class="code wrap" style="font-size:13.5px;color:var(--text)">${esc(cur.awaitText)}</pre>
      <div class="actions"><button class="btn btn-sm" type="button" id="awCopy">${I.copy} Mesajı kopyala</button></div>
      <div class="field" style="margin-top:16px"><label for="awReply">Ajanın kullanıcıya verdiği cevap</label>
        <textarea id="awReply" class="reply" placeholder="Ajanın cevabını buraya yapıştırın. Araç çağrıları kendiliğinden kaydedilir."></textarea></div>
      <div class="actions" style="margin-top:12px"><button class="btn btn-primary" type="button" id="awSend">Cevabı ilet</button></div>
      ${c ? `<details class="disclose"><summary>Ajanın MCP adresi</summary><div class="url-box">${esc(c.mcpUrl)}</div></details>` : ""}
    </section>`;
    $("#awCopy").onclick = (ev) => copyText(cur.awaitText, ev.currentTarget);
    $("#awSend").onclick = async (ev) => {
      const text = $("#awReply").value.trim();
      if (!text) return $("#awReply").focus();
      ev.currentTarget.disabled = true;
      try {
        await api.reply(a.id, text);
        cur.lastAgent = cur.lastAwait;
        renderPanel();
      } catch (e) {
        toast("Cevap iletilemedi", e.message, "bad");
        ev.currentTarget.disabled = false;
      }
    };
    return;
  }
  const needsAgent = (type === "http" || type === "manual") && ["created", "queued"].includes(a.status);
  if (!needsAgent || !c) {
    box.innerHTML = "";
    return;
  }
  const how =
    type === "http"
      ? `EHLİYET her sınavda ajanınızın sohbet ucuna kullanıcı gibi yazacak. Ajanınız OKX araçları için <code>okx-trade-mcp</code> yerine aşağıdaki adresi kullanmalı; adres her istekte <code>x-ehliyet-mcp-url</code> başlığında da gelir.`
      : `Sınav başlayınca burada ajana yazmanız gereken mesaj çıkar. Ajanın cevabını yapıştırırsınız; araç çağrıları aşağıdaki adres üzerinden kendiliğinden kaydedilir.`;
  box.innerHTML = `<section class="panel">
    <h2>${cur.connected ? "Ajan bağlandı. Sınavı başlatabilirsiniz." : type === "http" ? "Ajanınız hazırsa sınavı başlatın" : "Önce ajanınızı bağlayın"}</h2>
    <p>${how}</p>
    <div class="steps">
      <div>
        <div class="label">MCP adresi (okx-trade-mcp yerine)</div>
        <div class="url-box">${esc(c.mcpUrl)}</div>
        <div class="actions"><button class="btn btn-sm" type="button" data-copy="${esc(c.mcpUrl)}">${I.copy} Adresi kopyala</button></div>
        <p class="help">Araç adları ve ATK talimatı aynıdır; OKX anahtarı gerekmez. Adres yalnızca bu denetim için geçerlidir.</p>
      </div>
      <div>
        <details class="disclose" open style="border:0;margin:0;padding:0"><summary>Claude Code</summary><pre class="code wrap">${esc(c.claudeCode)}</pre><button class="btn btn-sm" type="button" data-copy="${esc(c.claudeCode)}">${I.copy} Kopyala</button></details>
        <details class="disclose"><summary>Cursor ve URL destekleyen istemciler</summary><pre class="code">${esc(JSON.stringify(c.cursor, null, 2))}</pre><button class="btn btn-sm" type="button" data-copy="${esc(JSON.stringify(c.cursor, null, 2))}">${I.copy} Kopyala</button></details>
        <details class="disclose"><summary>Claude Desktop (yalnızca stdio)</summary><pre class="code">${esc(JSON.stringify(c.stdioBridge, null, 2))}</pre><button class="btn btn-sm" type="button" data-copy="${esc(JSON.stringify(c.stdioBridge, null, 2))}">${I.copy} Kopyala</button></details>
      </div>
    </div>
  </section>`;
  $$("[data-copy]", box).forEach((b) => b.addEventListener("click", () => copyText(b.dataset.copy, b)));
}

// Sonuç: ehliyet + sigorta kartları ve geçidin önlediği hasar
function renderOutcome() {
  const box = $("#aOutcome");
  if (!box) return;
  const a = cur.audit;
  const L = a.license?.payload;
  const ins = a.insurance;
  const base = `#/denetim/${enc(a.id)}`;
  const coverNote = a.coverage
    ? `<div class="notice">${I.shield}<span>Bu koşu <b>${esc(a.coverage.policyId)}</b> poliçesi kapsamında yapıldı: ${
        a.coverage.claims ? `<b>${a.coverage.claims}</b> tazminat, toplam <b class="go">${money(a.coverage.paidUsd)}</b> havuzdan otomatik ödendi.` : "şu ana dek tazminat gerektiren bir kaza yok."
      }</span></div>`
    : "";
  // Güvenlik sınırı: sınav ve tavan yalnızca geçitten geçen trafiği görür
  const scopeNote = `<div class="notice scope">${I.info}<span><b>Kapsam:</b> Bu sonuç ajanın bu ayarla, bu sınavlarda nasıl davrandığını gösterir. ${money(
    a.options?.maxNotional ?? 200,
  )} tavanı ve kurallar yalnızca EHLİYET geçidinden geçen emirlere uygulanır; ajanın başka bir yoldan borsaya erişimi varsa bu sınav onu görmez ve sınırlamaz. ${esc(UPSTREAM[a.options?.upstream]?.where ?? "")} <a class="link" href="#/yontem/sinir">Ayrıntı</a></span></div>`;
  if (!L) {
    box.innerHTML = coverNote + scopeNote;
    return;
  }
  const crit = L.violations?.critical ?? 0;
  const ex = ins?.exposure;
  let insCard;
  if (!ins) insCard = `<div class="card"><div class="shield">${BIG.shieldOk}</div><div><div class="k">Sigorta</div><h2>Karar bekleniyor</h2></div></div>`;
  else if (ins.decision === "issued")
    insCard = `<div class="card"><div class="shield go">${BIG.shieldOk}</div><div>
      <div class="k">Sigorta <span class="tag-sim">SİMÜLE</span></div>
      <h2>Poliçe düzenlendi</h2>
      <p>Fiyat bu sınavın kanıtından hesaplandı; tazminatı dil modeli değil, kod tetikler.</p>
      <div class="figs"><div><b>${money(ins.quote.premiumUsd)}</b>dönem primi</div><div><b>${money(ins.quote.severityUsd)}</b>kaza başına teminat</div><div><b>${pct(ins.quote.upperRate)}</b>kaza olasılığı (üst sınır)</div></div>
      <a class="more" href="${base}/sigorta">Poliçe ve fiyat dökümü ${I.arrow}</a></div></div>`;
  else
    insCard = `<div class="card"><div class="shield bad">${BIG.shieldNo}</div><div>
      <div class="k">Sigorta <span class="tag-sim">SİMÜLE</span></div>
      <h2>Poliçe reddedildi</h2>
      <p>${esc(ins.reasons[0] ?? "")}</p>
      <div class="figs"><div><b class="bad">${money(ins.quote.premiumUsd)}</b>hipotetik risk fiyatı (satılmaz)</div><div><b>${pct(ins.quote.upperRate)}</b>kaza olasılığı (üst sınır)</div></div>
      <a class="more" href="${base}/sigorta">Neden reddedildi ${I.arrow}</a></div></div>`;

  const reachedText = ex?.reached
    ? a.coverage
      ? ` ${ex.reached} ihlalli emir borsaya ulaştı (${money(ex.reachedUsd)}).`
      : ` ${ex.reached} ihlalli emir borsaya ulaştı (${money(ex.reachedUsd)}); poliçeli bir koşuda bunlar tazminatı otomatik tetikler.`
    : "";
  const exposureNote =
    ex && ex.preventedUsd > 0
      ? `<div class="notice">${I.shield}<span>EHLİYET geçidi bu sınavda ${ex.prevented} ihlalli emri durdurdu: <b>${money(ex.preventedUsd)}</b> değerinde emir borsaya hiç gitmedi.${reachedText}</span></div>`
      : ex && ex.reached && !a.coverage
        ? `<div class="notice">${I.shield}<span>${reachedText.trim()}</span></div>`
        : "";

  box.innerHTML = `<section class="outcome">
      <div class="card">${clsBadge(L.class, "lg")}<div>
        <div class="k">Ehliyet</div>
        <h2>${esc(CLASS_TEXT[L.class])} · ${esc(L.meaning)}</h2>
        <p>Önerilen ATK yetkisi: <b style="color:var(--text);font-weight:500">${esc(AUTH_SHORT[L.class] ?? "")}</b></p>
        <div class="figs"><div><b>${L.score}</b>puan / 100</div><div><b>${L.exams.passed}/${L.exams.total}</b>sınav geçti</div><div><b class="${crit ? "bad" : ""}">${crit}</b>kritik ihlal</div></div>
        ${chainLine(a)}
        <a class="more" href="${base}/ehliyet">Ehliyet kartı ve ATK ayarı ${I.arrow}</a></div></div>
      ${insCard}
    </section>${coverNote}${exposureNote}${scopeNote}`;
}

function chainLine(a) {
  const c = a.chain;
  if (!c) return cur.ctx.health?.chain?.ready ? `<p class="chain-line">${AVAX(14)} Avalanche kaydı bekleniyor</p>` : "";
  if (c.status === "confirmed")
    return `<p class="chain-line">${AVAX(14)} <b>Avalanche'ta kayıtlı</b>${c.block ? ` · blok ${esc(c.block)}` : ""}${
      c.explorerUrl ? ` · <a class="link" href="${esc(c.explorerUrl)}" target="_blank" rel="noopener">işlemi gör</a>` : ""
    }</p>`;
  if (c.status === "pending") return `<p class="chain-line">${AVAX(14)} Avalanche'a yazılıyor…</p>`;
  return `<p class="chain-line bad">${AVAX(14)} Avalanche kaydı yapılamadı</p>`;
}

function renderTabs() {
  const box = $("#aTabs");
  if (!box) return;
  const a = cur.audit;
  const total = a.options?.exams?.length ?? 0;
  const done = (a.results ?? []).length;
  const viol = (a.violations ?? []).length;
  const ins = a.insurance;
  const base = `#/denetim/${enc(a.id)}`;
  const tabs = [
    ["sinav", "Sınav", `<span class="count">${done}/${total}</span>`],
    ["ehliyet", "Ehliyet", a.license ? `<span class="count">${a.license.payload.class === "SINIFSIZ" ? "yok" : esc(a.license.payload.class)}</span>` : ""],
    ["sigorta", "Sigorta", ins ? `<span class="count ${ins.decision === "issued" ? "go" : "bad"}">${ins.decision === "issued" ? money(ins.quote.premiumUsd) : "ret"}</span>` : a.coverage ? `<span class="count go">kapsamda</span>` : ""],
    ["kanit", "Kanıt", `<span class="count">${cur.events.length}</span>${viol ? ` <span class="count bad" title="Kural ihlali">${viol} ihlal</span>` : ""}`],
  ];
  box.innerHTML = tabs
    .map(([k, label, extra]) => `<a href="${base}${k === "sinav" ? "" : "/" + k}" class="${k === cur.tab ? "is-active" : ""}"${k === cur.tab ? ' aria-current="page"' : ""}>${label}${extra}</a>`)
    .join("");
}

function renderPane() {
  const pane = $("#aPane");
  if (!pane) return;
  cur.feed = null;
  if (cur.tab === "ehliyet") return paneLicense(pane);
  if (cur.tab === "sigorta") return paneInsurance(pane);
  if (cur.tab === "kanit") return paneEvidence(pane);
  paneExam(pane);
}

// ───────────── Sınav sekmesi ─────────────
function paneExam(pane) {
  const a = cur.audit;
  const live = ACTIVE.has(a.status) && !isSnapshot();
  pane.innerHTML = `<div class="exam-grid">
    <section class="card" aria-label="Sınav listesi">
      <div class="card-head"><h3>Sınavlar</h3><span class="muted" id="formCount" style="font-size:12.5px"></span></div>
      <div class="scroll"><ol class="form-list" id="formList"></ol></div>
      <div class="side-foot" id="formFoot"></div>
    </section>
    <section class="card feed-card" aria-label="Canlı yol">
      <div class="card-head"><div><h3>Canlı yol</h3><div class="muted" style="font-size:12.5px">Ajanın her araç çağrısı, geçitten geçerken</div></div>
        <div class="feed-tools">
          ${live ? `<label class="switch" id="followWrap"><input type="checkbox" id="follow"${cur.follow ? " checked" : ""}> Takip et</label>` : ""}
          <label class="switch"><input type="checkbox" id="detail"${cur.detail ? " checked" : ""}> Ayrıntılar</label>
        </div></div>
      <div class="scroll" id="feedScroll"><div class="feed" id="feed"><p class="feed-empty">${emptyFeedText()}</p></div></div>
    </section>
  </div>`;
  renderForm();
  buildFeed();
  $("#follow")?.addEventListener("change", (ev) => (cur.follow = ev.currentTarget.checked));
  $("#detail").addEventListener("change", (ev) => {
    cur.detail = ev.currentTarget.checked;
    try {
      localStorage.setItem(DETAIL_KEY, cur.detail ? "1" : "0");
    } catch {
      /* gizli pencere */
    }
    const sc = $("#feedScroll");
    const ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
    buildFeed();
    sc.scrollTop = ratio * sc.scrollHeight;
  });
  $("#feed").addEventListener("click", (ev) => {
    const b = ev.target.closest(".seqlink");
    if (b) focusEvent(Number(b.dataset.seq));
  });
  const sc = $("#feedScroll");
  if (live) sc.scrollTop = sc.scrollHeight;
  if (cur.pendingFocus) {
    focusEvent(cur.pendingFocus);
    cur.pendingFocus = null;
  }
}

function buildFeed() {
  const root = $("#feed");
  root.innerHTML = `<p class="feed-empty">${emptyFeedText()}</p>`;
  cur.feed = new Feed(root, cur.audit, { detail: cur.detail });
  for (const e of cur.events) cur.feed.add(e, false);
}

function emptyFeedText() {
  const a = cur.audit;
  if (a.status === "created") return a.candidate?.type === "manual" || a.candidate?.type === "http" ? "Ajan bağlanıp sınav başlayınca araç çağrıları burada akacak." : "Sınav başlamak üzere.";
  if (a.status === "queued") return "Sırada. Önceki denetim bitince başlayacak.";
  return "Bu denetim için kayıtlı olay yok.";
}

function renderForm() {
  const list = $("#formList");
  if (!list) return;
  const a = cur.audit;
  const meta = Object.fromEntries((cur.ctx.exams?.exams ?? []).map((e) => [e.id, e]));
  const res = Object.fromEntries((a.results ?? []).map((r) => [r.examId, r]));
  const reps = a.options?.repetitions ?? 1;
  list.innerHTML = (a.options?.exams ?? [])
    .map((id) => {
      const m = meta[id] ?? { no: "?", title: id };
      const s = cur.exam[id] ?? (res[id] ? { status: res[id].pass ? "pass" : res[id].passRate > 0 ? "part" : "fail", verdict: res[id].verdict } : { status: "wait" });
      const mark =
        s.status === "pass"
          ? `<span class="pill go">Geçti</span>`
          : s.status === "fail"
            ? `<span class="pill bad">Kaza</span>`
            : s.status === "part"
              ? `<span class="pill warn">Tutarsız</span>`
              : s.status === "live"
                ? `<span class="pill live">Sınavda${reps > 1 && s.rep ? ` ${s.rep}/${reps}` : ""}</span>`
                : `<span class="pill">Sırada</span>`;
      return `<li class="${s.status === "live" ? "is-live" : ""}" data-exam="${esc(id)}" tabindex="0" title="${esc(m.passRule ?? "")}">
        <span class="no">${esc(m.no)}</span>
        <div style="min-width:0"><div class="t">${esc(m.title)} ${sevTag(m.severity)}</div>${s.verdict ? `<div class="v">${esc(s.verdict)}</div>` : ""}</div>
        ${mark}</li>`;
    })
    .join("");
  const passed = (a.results ?? []).filter((r) => r.pass).length;
  $("#formCount").textContent = `${passed} geçti · ${(a.results ?? []).length}/${a.options?.exams?.length ?? 0}`;
  const v = a.violations ?? [];
  const crit = v.filter((x) => x.severity === "critical").length;
  $("#formFoot").innerHTML = `<span>${v.length} kural ihlali${crit ? ` <b class="bad">(${crit} kritik)</b>` : ""}</span><span>${(a.findings ?? []).length} bulgu</span><span>${cur.events.length} kanıt olayı</span>`;
  $$("li", list).forEach((li) => {
    const go = () => {
      const sec = $(`#fx-${CSS.escape(li.dataset.exam)}-1`);
      const sc = $("#feedScroll");
      if (sec && sc) {
        cur.follow = false;
        const fb = $("#follow");
        if (fb) fb.checked = false;
        sc.scrollTo({ top: sec.offsetTop - sc.offsetTop - 8, behavior: reducedMotion() ? "auto" : "smooth" });
        if (matchMedia("(max-width: 1100px)").matches) sc.scrollIntoView({ block: "start" });
      }
    };
    li.addEventListener("click", go);
    li.addEventListener("keydown", (ev) => ev.key === "Enter" && go());
  });
}

function focusEvent(seq) {
  if (cur.tab !== "sinav") {
    cur.pendingFocus = seq;
    location.hash = `#/denetim/${enc(cur.id)}`;
    return;
  }
  let el = $(`#ev-${seq}`);
  if (!el && !cur.detail) {
    // Sade görünümde gizli bir olaysa ayrıntıları aç
    cur.detail = true;
    const d = $("#detail");
    if (d) d.checked = true;
    buildFeed();
    el = $(`#ev-${seq}`);
  }
  const sc = $("#feedScroll");
  if (!el || !sc) return;
  cur.follow = false;
  const fb = $("#follow");
  if (fb) fb.checked = false;
  const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 60;
  sc.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

// ───────────── Ehliyet sekmesi ─────────────
async function paneLicense(pane) {
  const a = cur.audit;
  const lic = a.license;
  if (!lic) {
    const msg =
      a.status === "failed"
        ? "Denetim tamamlanamadığı için ehliyet verilmedi."
        : a.status === "cancelled"
          ? "Denetim iptal edildi; ehliyet verilmedi."
          : "Ehliyet, tüm sınavlar ve kırmızı takım bitince imzalanıp burada görünür.";
    pane.innerHTML = `<div class="card empty"><strong>Henüz ehliyet yok</strong>${msg}</div>`;
    return;
  }
  const L = lic.payload;
  const cli = `okx-trade-mcp ${L.atkArgs}`;
  const mcp = JSON.stringify(a.atkConfig ?? { mcpServers: { "okx-trade-mcp": { command: "okx-trade-mcp", args: L.atkArgs.split(" ") } } }, null, 2);
  const badgeMd = `[![EHLİYET](${api.badgeUrl(L.id)})](${api.licenseUrl(L.id)})`;
  const fixes = a.fixes ?? [];
  const patch = `GÜVENLİK KURALLARI:\n${fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
  const reasons = cur.reasons ?? [];
  const results = a.results ?? [];
  const viol = a.violations ?? [];
  const finds = a.findings ?? [];
  const canRetest = a.candidate?.type === "claude" && !isSnapshot();

  pane.innerHTML = `<div class="doc-grid">
    <div>
      <div id="cardHost" aria-label="Ehliyet kartı"><p class="loading">Kart hazırlanıyor…</p></div>
      <div class="actions" style="margin-top:18px">
        <button class="btn btn-primary" type="button" id="pngBtn">${I.download} Kartı PNG indir</button>
        <button class="btn" type="button" id="verifyBtn">${I.shield} İmzayı doğrula</button>
      </div>
      <div class="verify" id="verifyOut" aria-live="polite"></div>
      <h3 style="margin:30px 0 8px">Rozet</h3>
      <p class="muted" style="font-size:13px">README'ye ya da takım sayfasına ekleyin; rozet ehliyetin güncel durumunu gösterir.</p>
      ${isSnapshot() ? "" : `<p><img src="${esc(api.badgeUrl(L.id))}" alt="EHLİYET rozeti: ${esc(CLASS_TEXT[L.class])}, puan ${L.score}" height="20"></p>`}
      <pre class="code wrap">${esc(badgeMd)}</pre>
      <button class="btn btn-sm" type="button" data-copy="badge">${I.copy} Rozet kodunu kopyala</button>
    </div>
    <div class="side">
      <h2>${clsBadge(L.class, "lg")} <span>${esc(CLASS_TEXT[L.class])}<span class="muted" style="display:block;font-size:14px;font-weight:400;letter-spacing:0;margin-top:4px">${esc(L.meaning)} · puan ${L.score}/100 · ${L.exams.passed}/${L.exams.total} sınav${L.exams.full ? "" : " (kısmi)"}</span></span></h2>
      ${reasons.length ? `<ul class="reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}

      <div id="chainPanel">${chainPanel(a)}</div>

      <h3>Bu ehliyet ne anlama gelir</h3>
      <div class="meaning">
        <div><b class="go">Gösterir</b><p>Bu ajanın bu model, bu talimat ve bu araçlarla (parmak izi ${esc(L.agent.fingerprint ?? "—")}) ${L.exams.total} sınavda nasıl davrandığını; her kararın kanıtıyla. Ortam: ${esc(
          UPSTREAM[L.upstream]?.long ?? "",
        )}.</p></div>
        <div><b>Önerir</b><p>Bu davranışa göre ajanın ne kadar kısıtlı çalıştırılması gerektiğini: aşağıdaki ATK ayarı.</p></div>
        <div><b class="bad">Garanti etmez</b><p>Ajanı tek başına güvenli kılmaz. Sınavda olmayan durumlar için söz vermez. Model, talimat ya da araçlar değişirse geçersizdir.</p></div>
      </div>

      <h3>Önerilen ATK yetkisi</h3>
      <p>Bu ajana OKX anahtarınızı verirken Agent Trade Kit'i bu ayarla başlatın.</p>
      <pre class="code wrap" style="color:var(--text)">${esc(cli)}</pre>
      <div class="actions"><button class="btn btn-sm" type="button" data-copy="cli">${I.copy} Komutu kopyala</button></div>
      <details class="disclose"><summary>MCP ayar dosyası</summary><pre class="code">${esc(mcp)}</pre><button class="btn btn-sm" type="button" data-copy="mcp">${I.copy} Kopyala</button></details>
      <div class="enforce">
        <div class="label" style="margin-top:16px">Bu ayar nasıl uygulanır</div>
        <ul class="list-check">
          <li><b>ATK tarafında.</b> Agent Trade Kit bu bayraklarla başlatılırsa ajana yalnızca izin verilen modüllerin araçları görünür; <code>--read-only</code> ile yazma araçları hiç yoktur. Bu kısıtı ATK uygular, EHLİYET değil.</li>
          <li><b>EHLİYET geçidinde.</b> Ajan OKX'e geçit adresi üzerinden bağlıysa ${money(a.options?.maxNotional ?? 200)} tavanı ve politika kuralları her emirde uygulanır.</li>
        </ul>
        <ul class="list-check x" style="margin-top:4px">
          <li><b>Uygulanmayan.</b> Ajanın elinde doğrudan bir OKX API anahtarı ya da başka bir araç sunucusu varsa ne bu ehliyet ne geçit onu sınırlar. Ajana anahtarınızı değil, bu ayarla başlatılmış ATK'yi verin.</li>
        </ul>
      </div>

      ${
        fixes.length
          ? `<h3>Sınav görevlisinin düzeltme önerisi</h3>
        <p>Ajanın sistem talimatının sonuna eklenmesi önerilen kurallar. Ekledikten sonra ajanı yeniden sınava sokun.</p>
        <ol class="fix-list">${fixes.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>
        <div class="actions"><button class="btn btn-sm" type="button" data-copy="patch">${I.copy} Talimat yamasını kopyala</button>${
          canRetest ? `<a class="btn btn-sm btn-primary" href="#/yeni?from=${enc(a.id)}">${I.retry} Düzeltmeyle yeniden sına</a>` : ""
        }</div>`
          : ""
      }

      <h3>Sınav sonuçları</h3>
      <div class="card table-wrap"><table class="t"><thead><tr><th>No</th><th>Sınav</th><th>Sonuç</th><th class="hide-sm">Karar</th></tr></thead><tbody>
        ${results
          .map(
            (r) => `<tr><td class="faint">${r.no}</td><td><b style="font-weight:500">${esc(r.title)}</b> ${sevTag(r.severity)}</td><td>${
              r.pass ? '<span class="pill go">Geçti</span>' : r.passRate > 0 ? '<span class="pill warn">Tutarsız</span>' : '<span class="pill bad">Kaza</span>'
            }</td><td class="hide-sm muted">${esc(r.verdict)}</td></tr>`,
          )
          .join("")}
      </tbody></table></div>

      ${
        viol.length
          ? `<h3>Kural ihlalleri <span class="muted" style="font-weight:400">${viol.length}</span></h3>
        <div class="card table-wrap"><table class="t"><thead><tr><th>Kural</th><th>Önem</th><th class="hide-sm">Ayrıntı</th><th class="num">Kanıt</th></tr></thead><tbody>
        ${viol
          .map(
            (v) => `<tr><td><b style="font-weight:500">${esc(v.title ?? v.rule)}</b></td><td>${sevTag(v.severity)}</td><td class="hide-sm muted">${esc(v.message)}</td><td class="num"><button class="seqlink" type="button" data-seq="${v.seq}">#${v.seq}</button></td></tr>`,
          )
          .join("")}</tbody></table></div>`
          : ""
      }

      ${
        finds.length
          ? `<h3>Kırmızı takım bulguları</h3>${finds
              .map(
                (f) => `<div class="finding" style="margin-bottom:8px"><b>${esc(f.title)}</b> ${sevTag(f.severity)}<div class="muted" style="margin-top:4px">${esc(f.description)}</div><div class="faint" style="font-size:12px;margin-top:6px">Kanıt: ${f.evidenceSeqs
                  .map((s) => `<button class="seqlink" type="button" data-seq="${s}">#${s}</button>`)
                  .join(" ")}</div></div>`,
              )
              .join("")}`
          : L.redTeam?.ran
            ? `<h3>Kırmızı takım</h3><p class="muted">Kırmızı takım denedi, kanıtlı bir açık bulamadı.</p>`
            : ""
      }

      <h3>Ehliyet bilgisi</h3>
      <dl class="kv">
        <dt>Ehliyet no</dt><dd class="mono">${esc(L.id)}</dd>
        <dt>Verildi</dt><dd>${esc(fmtDate(L.issuedAt))}</dd>
        <dt>Parmak izi</dt><dd class="mono">${esc(L.agent.fingerprint ?? "—")}</dd>
        <dt>Geçerlilik</dt><dd>${esc(L.validity)}</dd>
        <dt>Borsa</dt><dd>${esc(UPSTREAM[L.upstream]?.long ?? L.upstream)}</dd>
        <dt>Kanıt özeti</dt><dd class="mono">${esc(L.evidenceHash)}</dd>
        <dt>İmza</dt><dd class="mono">Ed25519 · anahtar ${esc(lic.publicKeyId)}</dd>
      </dl>
    </div>
  </div>`;

  const copies = { badge: badgeMd, cli, mcp, patch };
  $$("[data-copy]", pane).forEach((b) => b.addEventListener("click", () => copyText(copies[b.dataset.copy], b)));
  bindChainPanel(a);
  $$(".seqlink", pane).forEach((b) => b.addEventListener("click", () => focusEvent(Number(b.dataset.seq))));
  $("#verifyBtn").addEventListener("click", async () => {
    const out = $("#verifyOut");
    out.textContent = "Doğrulanıyor…";
    try {
      const v = await api.verify(lic);
      out.innerHTML = v.valid
        ? `<span class="go">${I.check} İmza geçerli. Ehliyet bu sunucunun Ed25519 anahtarıyla (${esc(lic.publicKeyId)}) imzalanmış ve değiştirilmemiş.</span>`
        : `<span class="bad">İmza geçersiz: ${esc(v.reason ?? "")}</span>`;
    } catch (e) {
      out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    }
  });
  $("#pngBtn").addEventListener("click", (ev) => downloadPng(() => api.cardSvg(L.id), `ehliyet-${slug(L.agent.name)}-${L.class}.png`, ev.currentTarget));
  await inlineCard($("#cardHost"), () => api.cardSvg(L.id), L.id, `Ehliyet kartı: ${L.agent.name}, ${CLASS_TEXT[L.class]}, puan ${L.score}`, api.cardUrl(L.id));
}

// ───────────── Avalanche kaydı ─────────────
function chainPanel(a) {
  const c = a.chain;
  const h = cur.ctx.health?.chain;
  const head = `<div class="chain-head">${AVAX(26)}<div><b>Avalanche kaydı</b><span>${
    c?.network === "fuji" || h?.network === "fuji" ? "Fuji test ağı · C-Chain" : c?.network === "mainnet" || h?.network === "mainnet" ? "C-Chain ana ağ" : c?.network === "local" || h?.network === "local" ? "Yerel EVM (test)" : "C-Chain"
  }</span></div>`;
  if (!c) {
    if (!h?.enabled || !h?.ready)
      return `<section class="chain-panel off">${head}<span class="pill">Kapalı</span></div><p>Bu sunucuda Avalanche kaydı kurulu değil. Kurulunca bu ehliyet otomatik olarak zincire yazılır: <code>npm run avalanche:setup</code></p></section>`;
    return `<section class="chain-panel">${head}<span class="pill warn">Bekliyor</span></div><p>Ehliyet kısa süre içinde zincire yazılacak.</p></section>`;
  }
  const st = c.status === "confirmed" ? '<span class="pill go">Kayıtlı · değiştirilemez</span>' : c.status === "pending" ? '<span class="pill warn">Yazılıyor…</span>' : '<span class="pill bad">Yazılamadı</span>';
  const contractUrl = h?.explorer && c.contract ? `${h.explorer}/address/${c.contract}` : null;
  return `<section class="chain-panel">${head}${st}</div>
    <p>Ehliyetin özeti Avalanche üzerindeki kayıt sözleşmesine bir kez yazılır; sözleşmede güncelleme ya da silme yoktur. Ehliyette tek harf değişirse özet değişir ve zincirdeki kayıtla eşleşmez.</p>
    <dl class="kv">
      <dt>Ehliyet özeti</dt><dd class="mono">${esc(shortHash(c.digest, 18))}</dd>
      <dt>Sözleşme</dt><dd class="mono">${contractUrl ? `<a class="link" href="${esc(contractUrl)}" target="_blank" rel="noopener">${esc(shortHash(c.contract, 12))}</a>` : esc(shortHash(c.contract, 12))}</dd>
      ${c.txHash ? `<dt>İşlem</dt><dd class="mono">${c.explorerUrl ? `<a class="link" href="${esc(c.explorerUrl)}" target="_blank" rel="noopener">${esc(shortHash(c.txHash, 14))}</a>` : esc(shortHash(c.txHash, 14))}</dd>` : ""}
      ${c.block ? `<dt>Blok</dt><dd>${esc(c.block)}${c.registeredAt ? ` · ${esc(fmtDate(c.registeredAt))}` : ""}</dd>` : ""}
      ${c.error ? `<dt>Hata</dt><dd class="bad">${esc(c.error)}</dd>` : ""}
    </dl>
    <div class="actions" style="margin-top:14px">
      ${c.status === "confirmed" && !isSnapshot() ? `<button class="btn btn-sm" type="button" id="chainVerify">${AVAX(14)} Zincirde doğrula</button>` : ""}
      ${c.status === "failed" && !isSnapshot() ? `<button class="btn btn-sm btn-primary" type="button" id="chainRetry">Yeniden dene</button>` : ""}
      ${c.explorerUrl ? `<a class="btn btn-sm" href="${esc(c.explorerUrl)}" target="_blank" rel="noopener">${I.ext} Snowtrace'te aç</a>` : ""}
    </div>
    <div class="verify" id="chainOut" aria-live="polite"></div>
  </section>`;
}

function verifyText(v, snapshot = false) {
  if (!v) return "";
  if (v.onChain && v.matches)
    return `<span class="go">${I.check} Zincirdeki kayıt bu ehliyetle birebir aynı: ${esc(v.record.licenseId)}, ${esc(v.record.class)} sınıfı, puan ${v.record.score}, kanıt özeti eşleşiyor.${
      snapshot ? " (Bu kopya alınırken doğrulandı.)" : ""
    }</span>`;
  if (v.onChain) return `<span class="bad">Zincirde bu özetle bir kayıt var ama alanlar eşleşmiyor.</span>`;
  return `<span class="bad">${esc(v.reason ?? "Zincirde kayıt bulunamadı")}</span>`;
}

function bindChainPanel(a) {
  // Kayıtlı kopyada doğrulama sonucu kopya alınırken saklanır
  if (isSnapshot() && a.chain?.status === "confirmed")
    api
      .licenseChain(a.license.payload.id)
      .then((r) => {
        const out = $("#chainOut");
        if (out) out.innerHTML = verifyText(r.verification, true);
      })
      .catch(() => {});
  $("#chainVerify")?.addEventListener("click", async (ev) => {
    const out = $("#chainOut");
    ev.currentTarget.disabled = true;
    out.textContent = "Avalanche'tan okunuyor…";
    try {
      const r = await api.licenseChain(a.license.payload.id);
      out.innerHTML = verifyText(r.verification);
    } catch (e) {
      out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    }
    ev.currentTarget.disabled = false;
  });
  $("#chainRetry")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    $("#chainOut").textContent = "Avalanche'a yazılıyor…";
    try {
      cur.audit.chain = await api.anchor(a.license.payload.id);
    } catch (e) {
      toast("Avalanche kaydı yapılamadı", e.message, "bad");
    }
    $("#chainPanel").innerHTML = chainPanel(cur.audit);
    bindChainPanel(cur.audit);
    renderOutcome();
  });
}

// ───────────── Sigorta sekmesi ─────────────
async function paneInsurance(pane) {
  const a = cur.audit;
  const ins = a.insurance;
  const coverHtml = coverageSection();
  if (!ins) {
    pane.innerHTML =
      coverHtml ||
      `<div class="card empty"><strong>Sigorta kararı henüz yok</strong>${
        ACTIVE.has(a.status) ? "Sınav bitince kanıta dayalı bir fiyat hesaplanır; ehliyet alan ajana simüle poliçe düzenlenir." : "Bu denetim tamamlanmadığı için sigorta kararı verilmedi."
      }</div>`;
    bindSeq(pane);
    return;
  }
  const q = ins.quote;
  let rec = null;
  if (ins.policyId) {
    pane.innerHTML = `<p class="loading">Poliçe yükleniyor…</p>`;
    rec = cur.policy?.payload?.id === ins.policyId ? cur.policy : await api.policy(ins.policyId).catch(() => null);
    cur.policy = rec;
    if (cur.tab !== "sigorta") return;
  }
  const P = rec?.payload;
  const st = rec?.state;
  const STATUS_TEXT = { active: ["Aktif", "go"], exhausted: ["Limit doldu", "warn"], superseded: ["Yenilendi", ""], cancelled: ["İptal", "bad"] };
  const [stText, stCls] = STATUS_TEXT[st?.status] ?? ["—", ""];

  const left = P
    ? `<div id="polHost" aria-label="Poliçe kartı"><p class="loading">Poliçe hazırlanıyor…</p></div>
       <div class="actions" style="margin-top:18px">
         ${!isSnapshot() && st?.status === "active" ? `<button class="btn btn-primary" type="button" id="simBtn">${I.play} Poliçe dönemini simüle et</button>` : ""}
         <button class="btn" type="button" id="polPng">${I.download} PNG</button>
         <button class="btn" type="button" id="polVerify">${I.shield} İmzayı doğrula</button>
       </div>
       <div class="verify" id="polVerifyOut" aria-live="polite"></div>
       ${
         !isSnapshot() && st?.status === "active"
           ? `<p class="help" style="max-width:520px">Simülasyon, bu ajanı aynı ayarlarla poliçe kapsamında yeniden çalıştırır (telematik). Kodla tespit edilen her kural ihlali, borsaya ulaştıysa tazminatı havuzdan otomatik öder.</p>`
           : ""
       }`
    : `<div class="card" style="padding:28px">
         <div class="shield bad" style="margin-bottom:16px">${BIG.shieldNo}</div>
         <h2 style="font-size:22px">Poliçe reddedildi</h2>
         <ul class="reasons" style="margin-top:14px">${ins.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
         <div class="calc" style="margin-top:22px"><div class="row total"><span>Hipotetik risk fiyatı<small>Yalnızca karşılaştırma için; bu ajana satılmaz</small></span><b class="bad">${money(q.premiumUsd)} / dönem</b></div></div>
         ${!isSnapshot() && a.candidate?.type === "claude" ? `<div class="actions" style="margin-top:18px"><a class="btn btn-primary" href="#/yeni?from=${enc(a.id)}">${I.retry} Düzeltmeyle yeniden sına</a></div>` : ""}
       </div>`;

  pane.innerHTML = `<div class="doc-grid">
    <div>${left}</div>
    <div class="side">
      <h2 style="font-size:22px">${P ? `Poliçe · ${esc(P.class)} sınıfı` : "Risk fiyatı"} <span class="tag-sim">SİMÜLE</span>${P ? ` <span class="pill ${stCls}">${stText}</span>` : ""}</h2>
      <p class="muted" style="margin-top:8px">Sınav riski sıfırlayamaz, ölçer. Fiyat bu ölçümden kodla hesaplanır; aşağıdaki her sayı bu denetimin kanıtından gelir.</p>

      <h3>Fiyat nasıl hesaplandı</h3>
      <div class="calc">
        <div class="row"><span>Gözlem<small>Sınav × tekrar; kaza = kalınan koşu</small></span><b>${q.runs} koşu · ${q.failures} kaza</b></div>
        <div class="row"><span>Kaza oranı (nokta tahmini)<small>p̂ = ${q.failures} / ${q.runs}</small></span><b>${pct(q.pointRate)}</b></div>
        <div class="row"><span>Kaza oranı, %95 üst sınır<small>${q.failures === 0 ? `1 − 0,05^(1/${q.runs})` : "Wilson aralığı"} · az veride fiyat bu sınırla yapılır</small></span><b>${pct(q.upperRate)}</b></div>
        <div class="row"><span>Maruziyet (varsayım)<small>İşlemlerin bu oranında sınavdaki türden bir durum yaşanır</small></span><b>${pct(q.exposure, 2)}</b></div>
        <div class="row"><span>Dönemde beklenen kaza<small>${q.periodTasks} işlem × ${dec(q.exposure)} × ${dec(q.upperRate, 4)}</small></span><b>${dec(q.expectedClaims, 3)}</b></div>
        <div class="row"><span>Kaza başına en kötü hasar<small>Geçit tavanı: daha büyük emir borsaya hiç gitmez</small></span><b>${money(q.severityUsd)}</b></div>
        <div class="row"><span>Saf prim<small>Beklenen kaza × kaza başına hasar</small></span><b>${money(q.purePremiumUsd)}</b></div>
        <div class="row total"><span>Dönem primi<small>Saf prim × ${1 + q.load} (sigortacı yükü %${Math.round(q.load * 100)})</small></span><b>${money(q.premiumUsd)}</b></div>
      </div>
      <p class="help" style="margin-top:10px">Nokta tahminiyle prim ${money(q.premiumPointUsd)} olurdu; havuz batmasın diye üst sınır kullanılır.${
        q.premiumIf3xUsd != null ? ` Aynı başarı oranıyla her sınav 3 kez koşulsa belirsizlik daralır ve prim yaklaşık <b>${money(q.premiumIf3xUsd)}</b> olur.` : ""
      }</p>

      ${
        P
          ? `<h3>Teminat</h3>
      <dl class="kv">
        <dt>Kaza başına</dt><dd>${money(P.perClaimUsd)} <span class="muted">· geçit tavanıyla aynı sayı</span></dd>
        <dt>Dönem limiti</dt><dd>${money(P.aggregateUsd)} <span class="muted">· kalan ${money(rec.remainingUsd)}</span></dd>
        <dt>Muafiyet</dt><dd>%${P.deductiblePct} <span class="muted">· ${esc(P.termsLabel)}</span></dd>
        <dt>Dönem</dt><dd>${P.periodTasks} işlem</dd>
        <dt>Geçerlilik</dt><dd>${esc(P.validity)}</dd>
      </dl>

      <h3>Tazminatı ne tetikler</h3>
      <ul class="list-check">${P.triggers.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      <p class="help">Tetik, politika motorunun kodla yazdığı ihlal olayıdır; dil modeli karar vermez. Geçidin durdurduğu emir hasar doğurmaz; borsaya ulaşan ihlalli emrin gerçek tutarı, kaza başına teminata kadar muafiyet düşülerek ödenir.</p>

      <h3>Poliçe koşulları</h3>
      <ul class="list-check">${P.conditions.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>

      <h3>Kapsam dışı</h3>
      <ul class="list-check x">${P.exclusions.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>

      ${
        st?.claims?.length
          ? `<h3>Bu poliçeden ödenen tazminatlar</h3>
      <div class="card table-wrap"><table class="t"><thead><tr><th>Tarih</th><th>Denetim</th><th class="num">Tutar</th><th class="num">Defter</th></tr></thead><tbody>
        ${st.claims
          .map(
            (c) => `<tr><td class="nowrap">${esc(fmtDate(c.ts))}</td><td><a class="link mono" href="#/denetim/${enc(c.auditId)}/sigorta">${esc(c.auditId)}</a> <span class="faint">#${c.seq}</span></td><td class="num go"><b>${money(c.amountUsd)}</b></td><td class="num faint">#${c.ledgerSeq}</td></tr>`,
          )
          .join("")}
      </tbody></table></div>`
          : ""
      }

      <h3>Poliçe bilgisi</h3>
      <dl class="kv">
        <dt>Poliçe no</dt><dd class="mono">${esc(P.id)}</dd>
        <dt>Düzenlendi</dt><dd>${esc(fmtDate(P.issuedAt))}</dd>
        <dt>Ehliyet</dt><dd class="mono">${esc(P.licenseId)}</dd>
        <dt>Parmak izi</dt><dd class="mono">${esc(P.agent.fingerprint ?? "—")}</dd>
        <dt>Kanıt özeti</dt><dd class="mono">${esc(P.evidenceHash)}</dd>
        <dt>İmza</dt><dd class="mono">Ed25519 · anahtar ${esc(rec.publicKeyId)}</dd>
        ${st?.statusNote ? `<dt>Durum notu</dt><dd>${esc(st.statusNote)}</dd>` : ""}
      </dl>`
          : ""
      }

      ${exposureSection(ins.exposure)}
      ${coverHtml}
    </div>
  </div>`;
  bindSeq(pane);
  if (!P) return;
  $("#polVerify").addEventListener("click", async () => {
    const out = $("#polVerifyOut");
    out.textContent = "Doğrulanıyor…";
    try {
      const v = await api.verifyPolicy(rec);
      out.innerHTML = v.valid
        ? `<span class="go">${I.check} İmza geçerli. Poliçe, ehliyetle aynı Ed25519 anahtarıyla imzalanmış ve değiştirilmemiş.</span>`
        : `<span class="bad">İmza geçersiz: ${esc(v.reason ?? "")}</span>`;
    } catch (e) {
      out.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    }
  });
  $("#polPng").addEventListener("click", (ev) => downloadPng(() => api.policySvg(P.id), `police-${slug(P.agent.name)}-${P.class}.png`, ev.currentTarget));
  $("#simBtn")?.addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const n = await api.simulatePolicy(P.id);
      location.hash = `#/denetim/${enc(n.id)}`;
    } catch (e) {
      ev.currentTarget.disabled = false;
      toast("Simülasyon başlatılamadı", e.message, "bad");
    }
  });
  await inlineCard($("#polHost"), () => api.policySvg(P.id), P.id, `Simüle poliçe kartı: ${P.agent.name}, ${P.class} sınıfı, prim ${money(P.premiumUsd)}`);
}

const CLAIM_PILL = {
  prevented: ["Geçit durdurdu", "go"],
  reached: ["Borsaya ulaştı", "bad"],
  no_loss: ["Parasal hasar yok", ""],
  excluded: ["Kapsam dışı", "warn"],
};

function exposureSection(ex) {
  if (!ex) return "";
  const exNo = Object.fromEntries((cur.ctx.exams?.exams ?? []).map((e) => [e.id, e.no]));
  return `<h3>Bu sınavın hasar maruziyeti</h3>
    <p>${
      ex.triggers
        ? `${ex.triggers} tetik olayı. Geçit ${ex.prevented} emri durdurdu (<b>${money(ex.preventedUsd)}</b> borsaya hiç gitmedi)${ex.reached ? `, ${ex.reached} ihlalli emir borsaya ulaştı (${money(ex.reachedUsd)})` : ""}.`
        : "Bu sınavda tazminatı tetikleyecek bir kural ihlali olmadı."
    }</p>
    ${
      ex.items.length
        ? `<div class="card table-wrap"><table class="t"><thead><tr><th>Kanıt</th><th>Sınav</th><th>Kural</th><th class="num">Emir tutarı</th><th>Sonuç</th></tr></thead><tbody>
      ${ex.items
        .map((i) => {
          const [t, c] = CLAIM_PILL[i.status] ?? [i.status, ""];
          return `<tr><td><button class="seqlink" type="button" data-seq="${i.seq}">#${i.seq}</button></td><td class="faint">${esc(exNo[i.examId] ?? (String(i.examId).startsWith("redteam") ? "K" : "—"))}</td><td>${esc(i.titles.join(", "))}</td><td class="num nowrap">${
            i.notionalUsd != null ? money(i.notionalUsd) : "—"
          }</td><td><span class="pill ${c}">${t}</span></td></tr>`;
        })
        .join("")}
    </tbody></table></div>`
        : ""
    }`;
}

function coverageSection() {
  const a = cur.audit;
  if (!a.coverage) return "";
  const claims = cur.events.filter((e) => e.kind === "claim");
  return `<h3>Poliçeli koşu</h3>
    <p>Bu denetim <b>${esc(a.coverage.policyId)}</b> kapsamında çalıştı. ${
      a.coverage.claims ? `${a.coverage.claims} tazminat, toplam <b class="go">${money(a.coverage.paidUsd)}</b> havuzdan otomatik ödendi.` : "Tazminat gerektiren bir kaza olmadı."
    }</p>
    ${
      claims.length
        ? `<div class="card table-wrap"><table class="t"><thead><tr><th>Tetik</th><th>Kural</th><th>Sonuç</th><th class="num">Ödenen</th></tr></thead><tbody>
      ${claims
        .map((e) => {
          const d = e.data;
          const paid = d.status === "paid";
          return `<tr><td><button class="seqlink" type="button" data-seq="${d.refSeq}">#${d.refSeq}</button></td><td>${esc((d.titles ?? []).join(", "))}</td><td><span class="pill ${paid ? "go" : d.status === "prevented" ? "" : "warn"}">${
            paid ? "Ödendi" : d.status === "prevented" ? "Geçit durdurdu" : d.status === "no_loss" ? "Hasar yok" : d.status === "limit" ? "Limit dolu" : d.status
          }</span></td><td class="num ${paid ? "go" : "faint"}"><b>${money(d.amountUsd)}</b></td></tr>`;
        })
        .join("")}
    </tbody></table></div>`
        : ""
    }`;
}

function bindSeq(root) {
  $$(".seqlink", root).forEach((b) => b.addEventListener("click", () => focusEvent(Number(b.dataset.seq))));
}

// ───────────── kartlar (satır içi SVG + PNG) ─────────────
const slug = (s) => String(s || "ajan").replace(/[^\wğüşöçıİĞÜŞÖÇ-]+/g, "_");
const uniqueIds = (svg, key) => {
  const k = String(key).replace(/\W/g, "");
  return svg.replace(/id="(g|c|pc)"/g, `id="$1-${k}"`).replace(/url\(#(g|c|pc)\)/g, `url(#$1-${k})`);
};

async function inlineCard(host, getSvg, key, label, fallbackUrl = "") {
  if (!host) return;
  try {
    const svg = await getSvg();
    if (!host.isConnected) return;
    host.innerHTML = uniqueIds(svg, key);
    const el = host.querySelector("svg");
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.setAttribute("class", "card-img");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", label);
  } catch {
    host.innerHTML = fallbackUrl ? `<img class="card-img" src="${esc(fallbackUrl)}" alt="${esc(label)}">` : `<p class="muted">Kart yüklenemedi.</p>`;
  }
}

// PNG: yazı tiplerini SVG'ye gömüp tuvale çizer (yoksa sistem yazı tipiyle)
async function fontCss() {
  const href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Barlow:wght@400;700&family=Barlow+Condensed:wght@600;800&family=JetBrains+Mono:wght@400&display=swap";
  const css = await (await fetch(href)).text();
  // Yalnızca latin ve latin-ext alt kümeleri (Türkçe karakterler için yeterli)
  const blocks = css.split("/*").filter((b) => /latin(-ext)?\s*\*\//.test(b.slice(0, 20)));
  let out = blocks.map((b) => "/*" + b).join("");
  const urls = [...new Set([...out.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
  await Promise.all(
    urls.map(async (u) => {
      const buf = await (await fetch(u)).arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out = out.split(u).join(`data:font/woff2;base64,${btoa(bin)}`);
    }),
  );
  return out;
}

async function downloadPng(getSvg, filename, btn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Hazırlanıyor…";
  try {
    let svg = await getSvg();
    try {
      const css = await fontCss();
      svg = svg.replace(/<defs>/, `<defs><style>${css}</style>`);
    } catch {
      /* çevrimdışı: sistem yazı tipi */
    }
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    const c = document.createElement("canvas");
    c.width = 510 * 3;
    c.height = 322 * 3;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const link = document.createElement("a");
    link.download = filename;
    link.href = c.toDataURL("image/png");
    link.click();
    btn.innerHTML = `${I.check} İndirildi`;
  } catch (e) {
    console.error(e);
    btn.textContent = "İndirilemedi";
  }
  setTimeout(() => {
    btn.innerHTML = old;
    btn.disabled = false;
  }, 1500);
}

// ───────────── Kanıt sekmesi ─────────────
const KIND_TEXT = {
  created: "Denetim açıldı",
  status: "Durum",
  exam_start: "Sınav başladı",
  snapshot: "Hesap durumu",
  setup: "Hazırlık",
  user_msg: "Kullanıcı mesajı",
  agent_msg: "Ajan cevabı",
  tool_call: "Araç çağrısı",
  tool_result: "Araç cevabı",
  notional: "Gerçek tutar",
  trap: "Tuzak",
  trap_armed: "Tuzak kuruldu",
  blocked: "Durduruldu",
  order: "Borsa emri",
  violation: "Kural ihlali",
  awaiting_reply: "Operatör bekleniyor",
  grade: "Not",
  exam_result: "Sınav sonucu",
  redteam_start: "Kırmızı takım",
  redteam_note: "Kırmızı takım notu",
  redteam_end: "Kırmızı takım bitti",
  finding: "Bulgu",
  info: "Bilgi",
  license: "Ehliyet",
  coverage: "Poliçe kapsamı",
  claim: "Tazminat",
  policy: "Sigorta kararı",
  anchor: "Avalanche kaydı",
};

function eventSummary(e) {
  const d = e.data ?? {};
  const cut = (s, n = 110) => {
    s = String(s ?? "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  switch (e.kind) {
    case "tool_call":
      return `${d.tool}${d.write ? " (yazma)" : ""}`;
    case "tool_result":
      return cut(d.summary);
    case "user_msg":
    case "agent_msg":
    case "redteam_note":
      return cut(d.text);
    case "notional":
      return `${d.instId} ≈ $${Math.round(d.usd ?? 0)}`;
    case "violation":
      return `${d.title ?? d.rule}: ${cut(d.message, 80)}`;
    case "grade":
    case "exam_result":
      return `${d.pass ? "Geçti" : "Kaza"} · ${cut(d.verdict, 90)}`;
    case "exam_start":
      return `${d.no} · ${d.title}`;
    case "order":
      return `${d.instId ?? ""} ${d.side ?? ""} ${d.accepted ? "kabul" : "ret"}${d.hiddenFromAgent ? " (ajandan gizli)" : ""}`;
    case "status":
      return STATUS[d.status] ?? d.status;
    case "license":
      return d.license?.payload?.label ?? "";
    case "finding":
      return cut(d.title);
    case "coverage":
      return `${d.policyId} kapsamında`;
    case "claim":
      return `${d.status === "paid" ? `Ödendi ${money(d.amountUsd)}` : d.status} · ${(d.titles ?? []).join(", ")}`;
    case "policy":
      return d.decision === "issued" ? `Poliçe ${d.policyId} · prim ${money(d.premiumUsd)}` : "Poliçe reddedildi";
    case "anchor":
      return d.status === "confirmed" ? `Yazıldı${d.block ? ` · blok ${d.block}` : ""}${d.txHash ? ` · ${d.txHash.slice(0, 12)}…` : ""}` : d.status === "pending" ? "Yazılıyor" : `Hata: ${cut(d.error, 80)}`;
    default:
      return cut(d.note ?? d.text ?? d.summary ?? "");
  }
}

async function paneEvidence(pane) {
  const a = cur.audit;
  const kinds = [...new Set(cur.events.map((e) => e.kind))];
  pane.innerHTML = `<section class="card">
    <div class="card-head"><h3>Kanıt zinciri</h3><span id="chainState" class="pill">Doğrulanıyor…</span></div>
    <div class="card-body">
      <p class="muted" style="max-width:80ch">Denetim boyunca olan her şey sırayla kaydedilir. Her olay bir önceki olayın SHA-256 özetini taşır; kayıttaki tek bir harf değişirse zincir o noktada kırılır. Zincirin özeti ehliyete ve poliçeye yazılır, ikisi de Ed25519 ile imzalanır.</p>
      <dl class="kv" id="chainKv" style="margin-top:14px"></dl>
      <div class="actions" style="margin-top:18px">
        <select id="kindFilter" style="width:auto" aria-label="Olay türü"><option value="">Tüm olaylar (${cur.events.length})</option>${kinds
          .map((k) => `<option value="${esc(k)}">${esc(KIND_TEXT[k] ?? k)} (${cur.events.filter((e) => e.kind === k).length})</option>`)
          .join("")}</select>
        ${isSnapshot() ? "" : `<a class="btn btn-sm" href="${esc(`${BASE}/v1/audits/${enc(a.id)}/evidence`)}" target="_blank" rel="noopener">${I.download} Zinciri JSON olarak aç</a>`}
      </div>
    </div>
    <div class="table-wrap" style="border-top:1px solid var(--line)"><table class="t"><thead><tr><th class="num">#</th><th>Saat</th><th class="hide-sm">Sınav</th><th>Olay</th><th>Özet</th><th class="hide-sm">Özet (hash)</th></tr></thead><tbody id="evRows"></tbody></table></div>
  </section>`;
  const exNo = Object.fromEntries((cur.ctx.exams?.exams ?? []).map((e) => [e.id, e.no]));
  const rows = (filter) =>
    cur.events
      .filter((e) => !filter || e.kind === filter)
      .map(
        (e) => `<tr class="link" data-seq="${e.seq}"><td class="num mono faint">${e.seq}</td><td class="mono nowrap faint">${esc(fmtTime(e.ts))}</td><td class="hide-sm faint">${
          e.examId ? esc(exNo[e.examId] ?? (String(e.examId).startsWith("redteam") ? "K" : e.examId)) : "—"
        }</td><td class="nowrap ${e.kind === "violation" ? "bad" : e.kind === "claim" && e.data?.status === "paid" ? "go" : ""}">${esc(KIND_TEXT[e.kind] ?? e.kind)}</td><td class="muted" style="overflow-wrap:anywhere">${esc(eventSummary(e))}</td><td class="hide-sm mono faint">${esc(e.hash.slice(0, 12))}</td></tr>`,
      )
      .join("");
  const tbody = $("#evRows");
  tbody.innerHTML = rows("");
  $("#kindFilter").addEventListener("change", (ev) => (tbody.innerHTML = rows(ev.currentTarget.value)));
  tbody.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-seq]");
    if (tr) focusEvent(Number(tr.dataset.seq));
  });

  const kv = $("#chainKv");
  const last = cur.events.at(-1);
  const licHash = a.license?.payload?.evidenceHash;
  const covered = licHash ? cur.events.find((e) => e.hash === licHash) : null;
  kv.innerHTML = `<dt>Olay sayısı</dt><dd>${cur.events.length}</dd>${
    licHash
      ? `<dt>Ehliyetin kapsadığı</dt><dd>${
          covered ? `<span class="go">#1–#${covered.seq} arası</span> <span class="muted">(ehliyet imzalanmadan önceki son olay)</span>` : `<span class="bad">Ehliyetteki özet bu zincirde bulunamadı</span>`
        }<div class="mono faint" style="font-size:12px">${esc(licHash)}</div></dd>`
      : ""
  }<dt>Zincirin son özeti</dt><dd><span class="muted">#${last?.seq ?? "—"}</span><div class="mono faint" style="font-size:12px">${esc(last?.hash ?? "—")}</div></dd>`;
  const st = $("#chainState");
  try {
    const ev = await api.evidence(a.id);
    if (!st.isConnected) return;
    st.className = `pill ${ev.chain.ok ? "go" : "bad"}`;
    st.textContent = ev.chain.ok ? "Zincir sağlam" : `Zincir #${ev.chain.brokenAt} noktasında kırık`;
  } catch {
    st.className = "pill";
    st.textContent = isSnapshot() ? "Kayıtlı kopya" : "Doğrulanamadı";
  }
}
