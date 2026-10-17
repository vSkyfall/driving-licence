# EHLİYET: Claude Code için proje kuralları

## Ürün
OKX Agent Trade Kit (ATK) kullanan yapay zekâ işlem ajanlarını 12 tuzaklı sınava sokan, her araç çağrısını denetleyen ve Ed25519 imzalı ehliyet veren tek bir Node.js servisi. Ehliyet sınıfı bir ATK yetki ayarına çevrilir. Ehliyet alan ajana sınav istatistiğinden fiyatlanmış simüle poliçe düzenlenir (`src/insurance.ts`).

## Mimari (tek servis, build yok, `tsx` ile çalışır)
```
Tarayıcı ─► public/ (site)  ──fetch/SSE──►  src/api/handler.ts  (/v1/*, /openapi.json, site dosyaları)
Yarışmacı ajanı ──MCP HTTP──► /mcp/<jeton> ─► src/gateway/gateway.ts (kayıt, tutar, politika, tuzak, tavan)
                                                   └─► src/exchange/ (mock | hybrid | atk)  ─► OKX
src/examiner/runner.ts  sınav görevlisi: hazırlık → sınav × tekrar → kırmızı takım → rapor → imzalı ehliyet
src/exams/bank.ts       12 sınav (para kararını kod, metin kararını hakem verir)
src/store.ts            denetim kayıtları + hash zinciri (data/audits/*.json, *.events.jsonl)
```

## Değişmez kurallar
1. **Para hesabını dil modeli yapmaz.** Dolar tutarı yalnızca `src/gateway/notional.ts` hesaplar (ctVal × fiyat).
2. **Tavan önce gelir.** `maxNotional` / sınavın `capUsd` değerini aşan emir, tuzak dahil hiçbir yoldan borsaya gitmez.
3. **Kanıt değişmez.** `emit()` dışında olay yazılmaz; olaylar sonradan düzenlenmez. Zincir bozulursa ehliyet anlamsızlaşır.
4. **ATK yalnızca demo profille.** `EHLIYET_ATK_ARGS` varsayılanı `--profile demo`; canlı anahtar kullanılmaz.
5. **Sözleşme `/v1` API'sidir.** Site yalnızca `public/js/api.js` üzerinden konuşur. Uç ekler/değiştirirsen `src/api/openapi.ts` ve `public/js/api.js`'i birlikte güncelle.
6. **Jeton gizlidir.** Denetim jetonu (MCP adresi) herkese açık listelerde ve kayıtlı kopyada yer almaz.
7. **Sigorta simüledir ve öyle görünür.** Poliçe kartında, sayfalarda ve metinlerde “SİMÜLE” etiketi kalır. Tazminatı yalnızca politika motorunun ihlal olayı tetikler; dil modeli tazminat kararı vermez. Kaza başına teminat geçit tavanını aşamaz. Ehliyetsiz ajana poliçe yazılmaz. Havuz defteri yalnızca `append()` ile yazılır (hash zinciri).
8. **Avalanche kaydı değiştirilemez.** Sözleşmeye güncelleme/silme eklenmez. Zincire yalnızca özet, ehliyet no, sınıf, puan ve kanıt özeti yazılır; konuşma ya da kişisel veri yazılmaz. Gönderimler `serial()` kuyruğundan ve `sendTx()` nonce takibinden geçer. Özel anahtar yalnızca `.env`'de, yalnızca test ağı için.
9. **Dürüst çerçeve.** Ehliyet “ajanı güvenli kılmaz”; belirli ayar ve sınav koşulunda davranışı değerlendirip kısıtlı ayar önerir. Tavan ve kurallar yalnızca geçitten geçen trafiğe uygulanır; metinler bunu açıkça söyler. Modlar (çevrimdışı prova / gerçek fiyat · sahte emir / OKX demo hesabı) ayrı adlandırılır.

## Site (public/)
- Tek tema siyah (OKX benzeri): yüzeyler siyah/gri; yeşil (`--go`) geçti/ödendi, kırmızı (`--bad`) kaza/ihlal, sarı (`--sign`) yalnızca ehliyet plakası ve “simüle” etiketi. Yazı: Inter, JetBrains Mono (kartlarda Barlow Condensed). Renkler yalnızca `style.css` başındaki değişkenlerden.
- Sayfalar `#/` yollarıyla: `app.js` (yönlendirme, Sıralama, Sınav aç, Sigorta, Sınavlar, Nasıl çalışır), `audit.js` (denetim: Sınav · Ehliyet · Sigorta · Kanıt), `feed.js` (canlı yol).
- Sadelik: bir ekranda tek ana karar. Ayrıntı (hesap anlık görüntüleri, sistem notları) varsayılan olarak gizli, “Ayrıntılar” ile açılır.
- Arayüz metinleri Türkçe, kısa ve somut. Uzun tire (—) yerine iki nokta, nokta ya da “·” kullan. Emoji, gradyan, pazarlama dili yok.
- 375 px genişlikte yatay kaydırma olmamalı (grid sütunlarında `minmax(0, 1fr)`).

## Komutlar
- `npm run prova`: çevrimdışı sunucu, http://localhost:4747
- `npm start`: `.env` ile sunucu
- `npm test`: kurulum testi (naif → ehliyet yok + poliçe reddi, orta → A + poliçe, dikkatli → B; poliçeli orta koşusu tazminat öder, havuz defteri sağlam)
- `npm run typecheck`
- `npm run test:chain`: Avalanche kaydının uçtan uca testi (yerel EVM gerekir: `EHLIYET_CHAIN_RPC`, `EHLIYET_CHAIN_KEY`)
- `npm run avalanche:setup` / `avalanche:status` / `avalanche:compile`
- `npm run export`: tek dosyalık kayıtlı kopya → `dist/ehliyet-site.html`
- `npm run demo-agent -- --port 5055 --variant naive`: uzaktan bağlanan örnek ajan (sohbet ucu: `http://localhost:5055/chat`)

Bir değişiklikten sonra en az `npm run typecheck` ve `npm test` çalıştır; site değiştiyse sayfayı tarayıcıda aç.
