# Başka bir siteye entegrasyon

EHLİYET kendi sitesiyle birlikte gelir: `npm start` sonrası `http://localhost:4747` adresi sitenin tamamıdır ve ek bir şey gerekmez. Bu belge, EHLİYET'i **başka bir siteye** (ör. hackathon platformu, takım sayfası) eklemek içindir.

Denetçi, o sitenin yanında **ayrı bir servis** olarak çalışır (varsayılan port 4747). Site ona üç yoldan bağlanabilir. Hangisini seçerseniz seçin, akış aynıdır:

```
1. Site denetim açar         POST /v1/audits                 → id + connection.mcpUrl
2. Yarışmacı ajanını bağlar   ajan, okx-trade-mcp yerine mcpUrl'yi kullanır
3. Site sınavı başlatır       POST /v1/audits/:id/start
4. Site canlı izler           GET  /v1/audits/:id/events?stream=1   (SSE)
5. Ehliyet                    GET  /v1/licenses/:id   ·  card.svg  ·  badge.svg
```

## 0. Denetçiyi çalıştırın (sitenin olduğu bilgisayarda)

```bash
npm install
cp .env.example .env     # ANTHROPIC_API_KEY girin
npm test                 # "Kurulum doğru çalışıyor" görmelisiniz
npm start
```

Açılışta iki adres yazar. **"Ağdaki adres"** yarışmacıların bağlanacağı adrestir: aynı Wi-Fi'da `http://192.168.x.x:4747`. Farklı ağdaysanız bir tünel kullanın (`cloudflared tunnel --url http://localhost:4747`) ve `.env` içine `EHLIYET_PUBLIC_URL=https://...` yazın. Böylece verilen MCP adresleri doğru olur.

## Yol A: Hazır bileşenler (her teknolojiyle çalışır, en hızlısı)

```html
<script src="http://DENETCI:4747/widget.js" defer></script>

<ehliyet-start api="http://DENETCI:4747"></ehliyet-start>               <!-- form + bağlantı talimatı + canlı sınav + ehliyet -->
<ehliyet-leaderboard api="http://DENETCI:4747"></ehliyet-leaderboard>   <!-- salon tablosu, canlı -->
<ehliyet-audit api="http://DENETCI:4747" audit-id="aud_..."></ehliyet-audit>
<ehliyet-badge api="http://DENETCI:4747" license-id="lic_..."></ehliyet-badge>
```

- **Stil:** Bileşenler Shadow DOM kullanır, sitenin CSS'ini bozmaz.
- **Renk ve tema:** Renk için `--ehliyet-sign`, `--ehliyet-ink`, `--ehliyet-sheet`, `--ehliyet-paper`, `--ehliyet-stamp` değişkenlerini kullanın. Tema için `theme="light|dark|auto"` yazın.
- **`ehliyet-start` ayarları:** `heading=""` başlığı gizler. `audit-target="#kutu"` canlı sınavı sayfanın başka bir yerine çizer.
- **Olaylar:** `ehliyet:created`, `ehliyet:started`, `ehliyet:finished` (detail.license) ve `ehliyet:select` (salon tablosunda tıklanan satır).
- **React / Next.js:** Bileşenler yalnızca istemcide çalışır. Next'te `<Script src=".../widget.js" strategy="afterInteractive" />` kullanın ve etiketleri `"use client"` bir bileşende yazın. React 18'de öznitelikleri metin olarak verin, sorun çıkmaz.

`examples/host-site.html` başka bir kaynaktan (CORS) koyu temayla gömülmüş çalışan bir örnektir.

## Yol B: Kendi arayüzünüz (REST + canlı akış)

Tam şema `GET /openapi.json` adresinde.

```js
const API = "http://DENETCI:4747";

// 1) Denetim aç
const a = await fetch(`${API}/v1/audits`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    agent: { name: "NewsTrader", team: "Takım X", model: "gpt-5" },
    candidate: { type: "http", url: "http://yarismaci-ip:8000/chat" },   // aşağıdaki aday türlerine bakın
    exams: "tam",          // "hizli" | "tam" | ["unit_trap", "7", ...]
    repetitions: 1,        // 3 = tutarlılık testi
    redTeam: true,
    upstream: "hybrid",    // "atk" | "hybrid" | "mock"
  }),
}).then((r) => r.json());

// 2) Yarışmacıya gösterin:
a.connection.mcpUrl        // ajanın okx-trade-mcp yerine kullanacağı adres
a.connection.claudeCode    // claude mcp add --transport http okx-trade-mcp <url>
a.connection.cursor        // {"mcpServers":{"okx-trade-mcp":{"url": ...}}}
a.connection.stdioBridge   // Claude Desktop: npx -y mcp-remote <url>

// 3) Başlat (ajan bağlanınca "info" olayında level:"connect" gelir)
await fetch(`${API}/v1/audits/${a.id}/start`, { method: "POST" });

// 4) Canlı izle
const es = new EventSource(`${API}/v1/audits/${a.id}/events?stream=1`);
["exam_start", "tool_call", "notional", "violation", "grade", "finding", "license"].forEach((k) =>
  es.addEventListener(k, (m) => console.log(k, JSON.parse(m.data).data)));
```

### Aday türleri

| `candidate` | Ne zaman |
|---|---|
| `{ type: "http", url, format?: "auto" \| "openai" \| "simple" }` | Yarışmacının ajanı bir sohbet ucu sunuyorsa. Tam otomatik çalışır. `openai`: `/v1/chat/completions` biçimi. `simple`: `{message, session_id, history, mcp_url}` gönderilir, `{reply}` beklenir. MCP adresi her istekte `x-ehliyet-mcp-url` başlığıyla da gönderilir. |
| `{ type: "manual" }` | Ajanın sohbet ucu yoksa (Claude Desktop, Cursor, Telegram botu…). Denetçi `awaiting_reply` olayında "ajana şunu yazın" metnini verir. Operatör ajanın cevabını `POST /v1/audits/:id/reply {text}` ile iletir. Araç çağrıları yine MCP üzerinden kendiliğinden kaydedilir. |
| `{ type: "claude", model?, systemPrompt? }` | Yarışmacının "model + sistem talimatı" ikilisini sunucudaki Claude ile sınamak için. Hemen başlar. |
| `{ type: "script", variant: "naive" \| "hardened" }` | Prova. LLM kullanmaz, hemen başlar. |

### Olay türleri (SSE `event:` alanı)

| Olay | Anlamı |
|---|---|
| `exam_start` | `data.no`, `title`, `passRule`, `basis` (kırmızı takımda `redteam: true`) |
| `user_msg` / `agent_msg` | Sınav görevlisinin ve ajanın mesajları |
| `awaiting_reply` | Manuel modda operatörden cevap bekleniyor (`data.text` = ajana yazılacak) |
| `tool_call` / `tool_result` | Ajanın her araç çağrısı ve sonucu (`data.summary`) |
| `notional` | Emrin gerçek dolar tutarı (`usd`, `basis`, `requested`) |
| `trap`, `blocked`, `order` | Tuzak, tavan nedeniyle gönderilmeyen emir, borsadaki gerçek emir sonucu |
| `violation` | Politika ihlali (`rule`, `severity`, `title`, `message`) |
| `grade`, `exam_result` | Tekrar notu, sınavın toplam sonucu |
| `finding` | Kırmızı takım bulgusu ve kanıt olayları |
| `license` | Ehliyet verildi (`data.license`, `fixes`, `summary`) |

Her olayda `seq`, `prev` ve `hash` alanları bulunur (kanıt zinciri). `GET /v1/audits/:id/evidence` tüm zinciri doğrular.

## Yol C: Node / Express sitesine gömmek

```js
import express from "express";
import { createEhliyetHandler, loadAll } from "./ehliyet-denetci/src/index.ts";  // tsx ile çalıştırın
loadAll();
const app = express();
app.use(createEhliyetHandler({ basePath: "/ehliyet" }));
// → /ehliyet/widget.js  /ehliyet/v1/...  /ehliyet/mcp/<jeton>
```

## Güvenlik

- **API anahtarı:** `EHLIYET_API_KEY` tanımlanırsa POST uçları `Authorization: Bearer <anahtar>` ister. Tarayıcıdaki bileşene `api-key` vermek anahtarı açığa çıkarır. Hackathon için anahtarsız bırakın ya da isteği sitenin sunucusundan geçirin.
- **CORS:** `EHLIYET_CORS_ORIGIN` ile sınırlayın (varsayılan `*`).
- **Webhook:** `EHLIYET_WEBHOOK_URL` tanımlıysa denetim bitince oraya POST atılır. İmza `x-ehliyet-signature: sha256=<hmac>` başlığıyla gelir (`EHLIYET_WEBHOOK_SECRET`).
- **Jeton:** Denetim jetonu (MCP adresindeki parça) yalnızca o denetime erişim verir ve denetim bitince geçersizleşir.

## Sitenin yapay zekâ asistanına verilecek hazır istem

> Bu projeye EHLİYET Denetçi'yi entegre et. Denetçi `http://DENETCI:4747` adresinde çalışıyor; uçların şeması `http://DENETCI:4747/openapi.json` adresinde. Sitede bir "Ajan Denetimi" sayfası oluştur: `<script src="http://DENETCI:4747/widget.js">` yükle, sayfaya `<ehliyet-start api="http://DENETCI:4747" audit-target="#canli">`, altına `<div id="canli">` ve `<ehliyet-leaderboard api="http://DENETCI:4747">` koy. Takım profil sayfalarında, takımın son ehliyeti için `<ehliyet-badge api=... license-id=...>` göster (lisans kimliği `GET /v1/leaderboard` cevabındaki `licenseId`). Bileşenler Shadow DOM kullanır; renkleri sitenin temasına `--ehliyet-sign`, `--ehliyet-ink`, `--ehliyet-sheet` değişkenleriyle uydur. React/Next kullanılıyorsa bileşenleri yalnızca istemci tarafında çiz.
