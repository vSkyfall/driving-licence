// Canlı yol: denetimin olaylarını (kanıt zinciri) okunur bir akışa çevirir.
// Her sınav bir bölümdür; bir araç çağrısına ait olaylar (tutar, tuzak, ihlal, cevap) tek blokta toplanır.
// Sade görünümde hesap anlık görüntüleri ve sistem notları gizlenir; "Ayrıntılar" hepsini gösterir.
import { esc, usd, money, num, sevTag, UPSTREAM, candidateLabel, CLASS_TEXT, AVAX, shortHash } from "./util.js";

const argText = (args) =>
  Object.entries(args ?? {})
    .map(([k, v]) => {
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}=${s.length > 160 ? s.slice(0, 160) + "…" : s}`;
    })
    .join("  ");

const snapText = (d) => {
  if (d.error) return esc(d.error);
  const pos = (d.positions ?? []).map((p) => `${p.instId} ${p.pos}`).join(", ") || "yok";
  const parts = [`${num(d.totalEq, 2)} USDT`, `pozisyon: ${esc(pos)}`];
  if (d.openOrders?.length) parts.push(`açık emir: ${d.openOrders.length}`);
  if (d.algoOrders?.length) parts.push(`stop/algo: ${d.algoOrders.length}`);
  return parts.join(" · ");
};

const CLAIM_TEXT = {
  paid: "Tazminat ödendi",
  prevented: "Geçit durdurdu: hasar yok",
  no_loss: "Tetik kaydedildi: parasal hasar yok",
  excluded: "Kapsam dışı",
  limit: "Dönem limiti dolu: ödeme yapılmadı",
  inactive: "Poliçe aktif değil",
};

/** Sınav listesi için durum: examId → { status: wait|live|pass|fail|part, verdict, rep } */
export function reduceExamState(state, e) {
  const d = e.data ?? {};
  if (String(e.examId ?? "").startsWith("redteam")) return state;
  if (e.kind === "exam_start") state[e.examId] = { ...(state[e.examId] ?? {}), status: "live", rep: e.rep };
  else if (e.kind === "grade") state[e.examId] = { status: d.pass ? "pass" : "fail", verdict: d.verdict, rep: e.rep };
  else if (e.kind === "exam_result") state[e.examId] = { status: d.pass ? "pass" : d.passRate > 0 ? "part" : "fail", verdict: d.verdict };
  return state;
}

export class Feed {
  constructor(root, audit, { detail = false } = {}) {
    this.root = root;
    this.audit = audit;
    this.detail = detail;
    this.sections = new Map();
    this.calls = new Map(); // callId → araç çağrısı bloğu
    this.callSeq = new Map(); // çağrının olay no'su → blok (ihlaller refSeq ile bağlanır)
    this.count = 0;
  }

  /** Olayı akışa ekler; live=true ise not satırı belirir. Eklenen öğeyi döndürür. */
  add(e, live = false) {
    const d = e.data ?? {};
    if (e.kind === "tool_result") return this.attachResult(e);
    if (e.kind === "exam_start") return this.openSection(e);
    if (e.kind === "redteam_start") return this.openRedTeam(e);
    const html = this.html(e, live);
    if (!html) return null;
    if (this.count === 0) this.root.innerHTML = "";
    const host = ["notional", "blocked", "trap", "order"].includes(e.kind) ? this.calls.get(d.callId) : e.kind === "violation" ? this.callSeq.get(d.refSeq) : null;
    const el = document.createElement("div");
    el.className = host ? "sub" : "ln";
    el.id = `ev-${e.seq}`;
    el.innerHTML = `${html}<span class="seq" title="Kanıt olayı #${e.seq}">#${e.seq}</span>`;
    if (e.kind === "tool_call") {
      this.calls.set(d.callId, el);
      this.callSeq.set(e.seq, el);
    }
    (host ?? this.target(e)).appendChild(el);
    this.count++;
    return el;
  }

  target(e) {
    const key = e.examId != null ? `${e.examId}|${e.rep ?? 1}` : null;
    return (key && this.sections.get(key)) || (e.examId && String(e.examId).startsWith("redteam") && this.sections.get("redteam")) || this.root;
  }

  openSection(e) {
    const d = e.data ?? {};
    if (this.count === 0) this.root.innerHTML = "";
    const reps = this.audit.options?.repetitions ?? 1;
    const sec = document.createElement("section");
    sec.className = "fx";
    sec.id = `fx-${e.examId}-${e.rep ?? 1}`;
    sec.innerHTML = `<div class="fx-head${d.redteam ? " red" : ""}">
        <div class="t"><span class="n">${d.redteam ? "Kırmızı takım" : "Sınav"} ${esc(d.no)}</span> ${esc(d.title)} ${d.redteam ? "" : sevTag(d.severity)}${
          reps > 1 && !d.redteam ? ` <span class="pill">tekrar ${e.rep}/${reps}</span>` : ""
        }</div>
        <div class="d">${d.redteam ? "Hedef" : "Geçme şartı"}: ${esc(d.passRule)}</div>
        ${this.detail ? `<div class="d">Dayanak: ${esc(d.basis)}</div>` : ""}
      </div><div class="fx-body"></div>`;
    const parent = d.redteam ? this.sections.get("redteam") ?? this.root : this.root;
    parent.appendChild(sec);
    this.sections.set(`${e.examId}|${e.rep ?? 1}`, sec.querySelector(".fx-body"));
    this.count++;
    return sec;
  }

  openRedTeam(e) {
    const d = e.data ?? {};
    if (this.count === 0) this.root.innerHTML = "";
    const sec = document.createElement("section");
    sec.className = "fx";
    sec.id = "fx-redteam";
    sec.innerHTML = `<div class="fx-head red"><div class="t"><span class="n">Kırmızı takım</span> Uyarlanabilir saldırılar</div>
      <div class="d">Sınav görevlisi ajanın zayıf noktalarına göre en fazla ${esc(d.maxProbes)} yeni saldırı dener. Her bulgu bir kanıt olayına bağlanmak zorundadır.</div></div><div class="fx-body"></div>`;
    this.root.appendChild(sec);
    this.sections.set("redteam", sec.querySelector(".fx-body"));
    this.count++;
    return sec;
  }

  attachResult(e) {
    const d = e.data ?? {};
    const host = this.calls.get(d.callId);
    const err = d.summaryErr || d.isError;
    const write = !!host?.querySelector(".call.w");
    // Cevap nereden geldi: geçit (borsaya gitmedi), sahte emir defteri ya da OKX demo hesabı
    const src = d.simulated ? "geçit cevabı · borsaya gitmedi" : this.audit.options?.upstream === "atk" ? "OKX demo hesabı" : "sahte emir defteri";
    const showSrc = d.simulated || /_(place|cancel|amend|close|set)/.test(d.tool ?? "");
    const res = `<div class="call${write ? " w" : ""}"><span class="res${err ? " e" : ""}">← ${esc(d.summary)}${showSrc ? ` <span class="gw">· ${src}</span>` : ""}</span>${
      d.text && (d.simulated || /^news_/.test(d.tool)) ? `<details class="raw"><summary>ajanın gördüğü metin</summary><pre class="code wrap">${esc(d.text)}</pre></details>` : ""
    }</div>`;
    if (host) {
      const el = document.createElement("div");
      el.className = "sub";
      el.id = `ev-${e.seq}`;
      el.innerHTML = res;
      host.appendChild(el);
      return el;
    }
    return this.add({ ...e, kind: "__orphan_result", data: { html: res } });
  }

  html(e, live) {
    const d = e.data ?? {};
    const a = this.audit;
    const D = this.detail;
    switch (e.kind) {
      case "__orphan_result":
        return d.html;
      case "created":
        return D ? `<div class="note">Denetim açıldı · ${esc(candidateLabel(d.candidate ?? a.candidate))} · ${esc(UPSTREAM[d.exchange ?? a.options?.upstream]?.long ?? d.exchange)}</div>` : null;
      case "status":
        if (d.status === "failed") return `<div class="bar red">Denetim yarıda kaldı<small>${esc(d.error ?? "")}</small></div>`;
        if (d.status === "cancelled") return `<div class="note alert">Denetim iptal edildi.</div>`;
        if (!D) return null;
        if (d.status === "queued") return `<div class="note">Sıraya alındı.</div>`;
        if (d.status === "running") return `<div class="note">Sınav başladı · ${esc(UPSTREAM[d.exchange]?.long ?? d.exchange ?? "")}</div>${d.note ? `<div class="note alert">${esc(d.note)}</div>` : ""}`;
        return null;
      case "setup":
        return D ? `<div class="note">Hazırlık: ${esc(d.note)}</div>` : null;
      case "snapshot":
        return D ? `<div class="note">Hesap ${esc(d.phase)}: ${snapText(d)}</div>` : null;
      case "user_msg":
        return `<div class="msg user"><div class="who">${d.redteam ? "Kırmızı takım (kullanıcı rolünde)" : "Kullanıcı · sınav görevlisi"}</div>${esc(d.text)}</div>`;
      case "agent_msg":
        return `<div class="msg agent"><div class="who">Sınavdaki ajan</div>${esc(d.text)}</div>`;
      case "awaiting_reply":
        return D ? `<div class="note alert">Operatörün ajandan cevap getirmesi bekleniyor.</div>` : null;
      case "tool_call":
        return `<div class="call${d.write ? " w" : ""}">→ <span class="nm">${esc(d.tool)}</span>${d.write ? '<span class="wtag">yazma</span>' : " "} ${esc(argText(d.args))}</div>`;
      case "notional": {
        const over = typeof d.usd === "number" && ((d.requested && d.usd > d.requested * 1.05) || (d.cap && d.usd > d.cap));
        return `<div class="money${over ? " over" : ""}"><b>${usd(d.usd)}</b><span>gerçek tutar · ${esc(d.basis)}${d.requested ? ` · istenen ${usd(d.requested)}` : ""}</span></div>`;
      }
      case "trap":
        return `<div class="trap"><span class="sign"><i>!</i></span>Tuzak: ${esc(d.note)}</div>`;
      case "trap_armed":
        return `<div class="trap"><span class="sign"><i>!</i></span>Kırmızı takım tuzak kurdu: ${esc(d.kind)}${d.text ? ` · “${esc(String(d.text).slice(0, 140))}”` : ""}</div>`;
      case "blocked":
        return `<div class="bar red">Borsaya gönderilmedi: ${usd(d.usd)} sınav tavanını (${usd(d.cap)}) aşıyor</div>`;
      case "order":
        if (d.hiddenFromAgent && d.accepted) return `<div class="bar hidden-order">Emir borsada gerçekleşti (ordId ${esc(d.ordId)}). Ajana zaman aşımı gösterildi.</div>`;
        return null;
      case "violation":
        return `<div class="bar flag">Kural ihlali · ${esc(d.title ?? d.rule)} ${sevTag(d.severity)}<small>${esc(d.message)}</small></div>`;
      case "grade":
        return `<div class="grade ${d.pass ? "pass" : "fail"}${live ? " pop" : ""}"><span class="verdict ${d.pass ? "pass" : "fail"}">${d.pass ? "GEÇTİ" : "KAZA"}</span><div><div class="v">${esc(d.verdict)}</div>${
          D || !d.pass ? `<div class="e">${(d.evidence ?? []).filter(Boolean).map(esc).join("<br>")}</div>` : ""
        }</div></div>`;
      case "exam_result":
        if ((a.options?.repetitions ?? 1) < 2) return null;
        return `<div class="note ${d.pass ? "good" : "alert"}">Sınav ${esc(d.no)} toplamı: ${esc(d.verdict)}</div>`;
      case "redteam_note":
        return D ? `<div class="note">Kırmızı takım: ${esc(d.text)}</div>` : null;
      case "finding":
        return `<div class="finding"><b>Bulgu: ${esc(d.title)}</b> ${sevTag(d.severity)}<div class="muted" style="margin-top:4px">${esc(d.description)}</div>${
          d.recommendation ? `<div style="margin-top:4px">Öneri: ${esc(d.recommendation)}</div>` : ""
        }<div class="faint" style="font-size:12px;margin-top:6px">Kanıt: ${(d.evidenceSeqs ?? []).map((s) => `<button type="button" class="seqlink" data-seq="${s}">#${s}</button>`).join(" ")}</div></div>`;
      case "redteam_end":
        return D ? `<div class="note">Kırmızı takım bitti${d.summary ? `: ${esc(d.summary)}` : "."}</div>` : null;
      case "info":
        if (d.level === "alert") return `<div class="note alert">${esc(d.note)}</div>`;
        if (d.level === "connect") return `<div class="note good">${esc(d.note)}</div>`;
        return D ? `<div class="note${d.chainOk ? " good" : ""}">${esc(d.note)}</div>` : null;
      case "coverage":
        return `<div class="claim"><span class="amt">${money(d.perClaimUsd)}</span><div class="what">Bu koşu ${esc(d.policyId)} poliçesi kapsamında <span class="tag-sim">SİMÜLE</span><small>Kaza başına teminat ${money(d.perClaimUsd)} · kalan dönem limiti ${money(d.remainingUsd)} · muafiyet %${esc(d.deductiblePct)}. Kural ihlali olursa tazminat havuzdan otomatik ödenir.</small></div></div>`;
      case "claim": {
        const paid = d.status === "paid";
        if (!paid && !D && d.status !== "prevented") return null;
        return `<div class="claim${paid ? " paid" : ""}${live && paid ? " pop" : ""}"><span class="amt">${paid ? money(d.amountUsd) : "$0"}</span><div class="what"><b>${esc(CLAIM_TEXT[d.status] ?? d.status)}</b> · ${esc((d.titles ?? []).join(", "))}<small>${
          paid
            ? `Brüt ${money(d.grossUsd)} − muafiyet ${money(d.deductibleUsd)} · havuz defteri #${esc(d.ledgerSeq)} · kalan limit ${money(d.remainingUsd)}`
            : d.notionalUsd
              ? `Emrin gerçek tutarı ${money(d.notionalUsd)} borsaya ulaşmadı`
              : "Kodla tespit edildi"
        } · tetik <button type="button" class="seqlink" data-seq="${esc(d.refSeq)}">#${esc(d.refSeq)}</button></small></div></div>`;
      }
      case "license": {
        const p = d.license?.payload;
        if (!p) return null;
        return `<div class="grade"><span class="cls ${esc(p.class)} lg">${p.class === "SINIFSIZ" ? "YOK" : esc(p.class)}</span><div><div class="v">${esc(CLASS_TEXT[p.class])} · puan ${p.score} · ${p.exams.passed}/${p.exams.total} sınav</div><div class="e">${(d.classReasons ?? [])
          .map(esc)
          .join("<br>")}${d.classReasons?.length ? "<br>" : ""}imzalı ehliyet ${esc(p.id)}</div></div></div>`;
      }
      case "anchor":
        if (d.status === "pending") return `<div class="claim"><span class="amt">${AVAX(22)}</span><div class="what"><b>Avalanche'a yazılıyor…</b><small>Ehliyet özeti ${esc(shortHash(d.digest, 12))} kayıt sözleşmesine gönderiliyor</small></div></div>`;
        if (d.status === "confirmed")
          return `<div class="claim paid"><span class="amt">${AVAX(22)}</span><div class="what"><b>Avalanche'a yazıldı</b>${d.note ? ` · ${esc(d.note)}` : ""}<small>${d.block ? `Blok ${esc(d.block)} · ` : ""}${
            d.txHash ? `işlem ${d.explorerUrl ? `<a class="link" href="${esc(d.explorerUrl)}" target="_blank" rel="noopener">${esc(shortHash(d.txHash, 12))}</a>` : esc(shortHash(d.txHash, 12))}` : "kayıt zaten zincirde"
          } · değiştirilemez</small></div></div>`;
        return `<div class="claim"><span class="amt">${AVAX(22)}</span><div class="what"><b class="bad">Avalanche kaydı yapılamadı</b><small>${esc(d.error ?? "")}</small></div></div>`;
      case "policy":
        if (d.decision === "issued")
          return `<div class="claim paid"><span class="amt">${money(d.premiumUsd)}</span><div class="what"><b>Poliçe düzenlendi</b> <span class="tag-sim">SİMÜLE</span><small>${esc(d.policyId)} · dönem primi havuza yazıldı</small></div></div>`;
        return `<div class="claim"><span class="amt bad">Ret</span><div class="what"><b>Poliçe reddedildi</b><small>${esc((d.reasons ?? [])[0] ?? "")}</small></div></div>`;
      default:
        return null;
    }
  }
}
