# Birleştirme: yapılan değişiklikler

Tarih: 17.10.2026

AI tarafı (`ehliyet-denetci.zip`) ile web sitesi (`ehliyet-starter/public`) tek projede birleştirildi: **`ehliyet/`**.
Site, API (`/v1`) ve ajanların bağlandığı MCP geçidi (`/mcp/<jeton>`) aynı Node.js servisinden yayınlanır.

```bash
cd ~/Desktop/ehliyet/ehliyet
npm install
npm test          # kurulum testi
npm run prova     # çevrimdışı → http://localhost:4747
npm start         # gerçek OKX fiyatlarıyla
```

## Klasör düzeni

| Ne | Nerede | Durum |
|---|---|---|
| Birleşik proje | `ehliyet/` | **Yeni.** AI tarafının zip'i temel alındı, site baştan yazıldı |
| Eski site başlangıcı | `arsiv/ehliyet-starter/` | Taşındı (silinmedi). Yerini `ehliyet/` aldı |
| Tek dosyalık site | `indir/ehliyet-site.html` | Yeniden üretildi: iki gerçek referans denetim içerir, sunucusuz açılır |
| Proje ZIP'i | `indir/ehliyet-proje.zip` | Yeniden üretildi (`node_modules`, kayıtlar ve anahtarlar hariç) |
| Okuma notu | `BENIOKU.txt` | Güncellendi |
| `EHLIYET-MVP-PLANI.md`, `SAGLAMA-RAPOR.md` | kök | Değişmedi |

## Neden site baştan yazıldı

Eski site, 6 sınavlık eski sözleşmeye (`/api/runs`, PIN, `acemi/egitimli` profilleri) göre yazılmıştı. AI tarafı ise çok daha ileri gitmişti: 12 sınav, `/v1` API, MCP geçidi, politika motoru, kırmızı takım, Ed25519 imzalı ehliyet, hash zinciri. Eski site bu API ile konuşamıyordu. Yeni site doğrudan AI tarafının `/v1` API'sini kullanır.

## Web sitesi (`ehliyet/public/`)

Yeni dosyalar: `index.html`, `style.css`, `js/app.js`, `js/audit.js`, `js/feed.js`, `js/api.js`, `js/util.js`.
Kaldırılan: AI tarafının kendi paneli `public/dashboard.html` (yerini site aldı). `public/widget.js` duruyor (başka sitelere gömmek için). d

**Görsel kimlik:** ehliyet kartıyla aynı dil. Sarı plaka logosu, lacivert mürekkep, KAZA / GEÇTİ mühürleri, trafik işareti biçiminde tuzak simgesi. Yazı tipleri Barlow, Barlow Condensed, JetBrains Mono. Açık ve koyu tema. Emoji, renk geçişi ve pazarlama dili yok; Türkçe metinlerde uzun tire kullanılmadı.

**Sayfalar:**

| Sayfa | İçerik |
|---|---|
| Salon `#/` | Sıralama (sınıf, puan, kaza yapılan sınavlar, ihlaller, önerilen yetki, tarih). Süren denetimler canlı güncellenir. Boşken tek tıkla hazır denemeler |
| Yeni sınav `#/yeni` | Kendi ajanın (sohbet ucu ya da elle), Claude referans ajanı (Acemi / Eğitimli / kendi talimatın), LLM'siz prova ajanı. Tam / hızlı / seçerek, 3 tekrar, kırmızı takım, borsa modu. Sağda canlı “sınav kapsamı” |
| Denetim · Sınav | Sınav formu (mühürlerle) ve canlı yol. Her araç çağrısı tek blokta: çağrı → gerçek dolar tutarı → tuzak / ihlal / tavan → borsanın cevabı. Kanıt numaraları (#seq), “ajanın gördüğü metin”, kaza bildirimleri |
| Denetim · Ehliyet | Kart (satır içi SVG), PNG indirme (yazı tipleri gömülü), imza doğrulama, ATK komutu ve MCP ayarı, düzeltme önerisi, **Düzeltmeyle yeniden sına**, sonuç tablosu, ihlaller, kırmızı takım bulguları, rozet |
| Denetim · Kanıt | Hash zinciri durumu, ehliyetin kapsadığı olay aralığı, tüm olaylar (türe göre süzme), JSON |
| Sınavlar `#/sinavlar` | 12 sınav: kullanıcı isteği, geçme şartı, dayanak + kaynak linki, düzeltme önerisi. Politika kuralları, sınıf tablosu |
| Yöntem `#/yontem` | Mimari, ATK'nin nerede kullanıldığı, puanlama, kanıt ve imza, dürüstlük notları, kaynaklar |
| Ajanını bağla `#/entegrasyon` | Diğer takımlar için: MCP adresini Claude Code / Cursor / Claude Desktop'a ekleme, sohbet ucu biçimi, başka siteye gömme |

Kendi ajanın seçildiğinde denetim sayfasında MCP adresi ve hazır ayarlar çıkar; manuel modda “Ajana şunu yazın” paneli ve cevap kutusu çıkar.

## AI tarafındaki değişiklikler (`ehliyet/src/`)

| Dosya | Değişiklik |
|---|---|
| `candidates/profiles.ts` | **Yeni.** Acemi ve Eğitimli referans profilleri (Eğitimli = Acemi talimatı + 12 sınavın düzeltme önerileri) |
| `api/handler.ts` | Site dosyalarını yayınlar (güvenli yol kontrolüyle). `GET /v1/profiles` eklendi. `/v1/health` artık `auth`, `maxNotional`, modeller ve ATK argümanlarını da döner. `/v1/exams` sınıf tablosu ve ağırlıkları da döner |
| `api/openapi.ts` | `/v1/profiles` ve Claude adayının `profile` alanı belgelendi |
| `types.ts` | Claude adayına `profile` alanı |
| `examiner/runner.ts` | `profile` ile talimat seçimi; `upstream` değeri doğrulanır |
| `exams/bank.ts` | Sınav 1–6'ya herkese açık kaynak linki (`source`) |
| `license.ts` | Sınıf tablosu dışa açıldı (`CLASS_TABLE`) |
| `license.ts`, `runner.ts`, `bank.ts`, `gateway.ts`, `policy.ts`, `claude.ts`, `server.ts` | Kullanıcıya görünen Türkçe metinlerde uzun tire yerine iki nokta / nokta / “·” |

Sınav mantığı, puanlama, politika motoru, tuzaklar ve imza değişmedi.

## Diğer

- `scripts/export.ts` **yeni**: `npm run export` siteyi bitmiş denetimlerle birlikte tek HTML dosyasına gömer. Denetim jetonları ve MCP adresleri kopyaya yazılmaz.
- `package.json`: ad `ehliyet`; `export` komutu; `typescript` (eksikti, `npm run typecheck` çalışmıyordu) ve `esbuild` geliştirme bağımlılığı.
- `tsconfig.json`: `scripts/` eklendi. `.gitignore`: `dist/`, `.DS_Store`.
- `README.md` birleşik projeye göre yeniden yazıldı; `CLAUDE.md` yeni (proje kuralları); `ENTEGRASYON.md` başına “başka siteye gömmek içindir” notu.
- `data/`: test denetimleri silindi; iki referans denetim bırakıldı (naif prova ajanı: ehliyet yok, puan 8; dikkatli prova ajanı: B, puan 92), gerçek OKX fiyatlarıyla.

## Doğrulananlar

- `npm test`: naif → ehliyet yok, dikkatli → B; imza geçerli, zincir sağlam.
- `npm run typecheck`: hatasız.
- Sahte Anthropic sunucusuyla LLM yolları (hakem, kırmızı takım, Claude adayı, özet).
- Tarayıcıda: tüm sayfalar, 1440 / 1024 / 375 px, açık ve koyu tema; JS hatası ve yatay taşma yok.
- Uçtan uca: dışarıdan bağlanan örnek ajanla canlı sınav, manuel mod, iptal, “Düzeltmeyle yeniden sına”, PNG kart, kayıtlı kopya.
- Hibrit mod gerçek OKX fiyatlarıyla (ETH 2.437,47 → naif ajanın “100 dolar”ı 24.375 dolarlık emir).

## Henüz denenmedi

- **Gerçek Claude** (API anahtarı yoktu): sunumdan önce `.env` içine `ANTHROPIC_API_KEY` yazıp Acemi ve Eğitimli ajanları gerçekten koşturun.
- **OKX demo hesabı modu** (`EHLIYET_UPSTREAM=atk`, `~/.okx/config.toml` demo profili gerekir): 6. sınavdaki davranışı sunumdan önce bu modda bir kez görün.

---

# 2. tur: Sigorta katmanı ve siyah tema

Kimi'nin “EHLİYET + SİGORTA” konsept dokümanı (`ehliyet-sigorta.agent.final.md`) koda çevrildi. Doküman eski 6 senaryolu sözleşmeye göre yazılmıştı; kavramlar gerçek motora şöyle eşlendi:

| Doküman | Uygulama |
|---|---|
| 6 senaryo, `crash` olayı | 12 sınav, politika motorunun `violation` ve `blocked` olayları |
| `MAX_FORWARD_USD` 600 $ | Geçidin kodla dayattığı tavan `maxNotional` (200 $) = kaza başına teminat |
| Prim = P(kaza) × hasar × yük | `işlem (100) × maruziyet (%2, varsayım) × kaza oranı %95 üst sınırı × tavan × 1,25` |
| Rule of three | 0 kazada `1 − 0,05^(1/n)`, diğerlerinde Wilson üst sınırı |
| Telematik | Poliçe parmak izine bağlı; aynı ajanın sonraki koşusu otomatik olarak poliçe kapsamında |
| Parametrik tetik | Kural ihlali → geçit durdurduysa hasar 0; borsaya ulaştıysa gerçek tutar, limit ve muafiyetle havuzdan otomatik ödeme |
| Havuz (simüle) | 10.000 $ simüle sermaye; hash zincirli defter; her tazminat kanıt olayına bağlı |
| SINIFSIZ'a poliçe yok | Kodda uygulanıyor; “reddedilmiş teklif” ve hipotetik risk fiyatı gösteriliyor |
| `RiskQuote`, `PolicyOffer`, `payout_triggered` | `RiskQuote`, Ed25519 imzalı poliçe, `policy` / `coverage` / `claim` olayları |

## Motor (`ehliyet/src/`)

- `insurance.ts` **yeni**: fiyatlama, sigortalama kararı, imzalı poliçe, tazminat tetikleri, hash zincirli havuz defteri, poliçe kartı SVG.
- `examiner/runner.ts`: koşu başında aktif poliçe kontrolü (telematik), her sınav notundan sonra tazminat, ehliyetten sonra sigorta kararı.
- `api/handler.ts`: `/v1/insurance`, `/v1/policies`, `/v1/policies/:id`, `/card.svg`, `/simulate`, `/v1/policies/verify`; sıralamaya sigorta bilgisi.
- `license.ts`: ortak imza fonksiyonu (`signDoc` / `verifyDoc`); poliçe ehliyetle aynı anahtarla imzalanır.
- `candidates/script-brain.ts`: üçüncü prova ajanı **orta** (dikkatli gibi davranır, tek zaafı zaman aşımında kontrol etmeden tekrar denemek → A sınıfı, poliçe alır, poliçeli koşuda tazminat tetikler).
- `config.ts`, `.env.example`: `EHLIYET_EXPOSURE`, `EHLIYET_POLICY_TASKS`, `EHLIYET_PREMIUM_LOAD`, `EHLIYET_POOL_SEED`.
- `test/selftest.ts`: naif (ret), dikkatli (B + poliçe), orta (A + poliçe), poliçeli orta koşusu (30 $ tazminat), havuz bakiyesi ve defter zinciri doğrulanır.

## Site (`ehliyet/public/`)

- **Siyah tema** (OKX benzeri): siyah yüzeyler, beyaz hap düğmeler, Inter yazı tipi; renk yalnızca anlam için (yeşil geçti/ödendi, kırmızı kaza/ihlal, sarı plaka ve “simüle”).
- **Sadeleştirme:** menü 4 öğe (Sıralama · Sigorta · Sınavlar · Nasıl çalışır) + “Sınav aç”; “Ajanını bağla” Nasıl çalışır'a taşındı; canlı yol varsayılan olarak sade, “Ayrıntılar” anahtarıyla açılıyor; sınav listesi tek satırlık; katalog açılır satırlar.
- **Ana sayfa:** kısa tanıtım + canlı rakamlar (denetlenen ajan, geçidin durdurduğu emir tutarı, havuz, ödenen tazminat) + sigorta sütunlu sıralama.
- **Denetim:** sonuç iki kart (Ehliyet · Sigorta) ve “geçit şu kadar emri durdurdu” notu; yeni **Sigorta** sekmesi: poliçe kartı, satır satır fiyat dökümü, teminat, tetikler, koşullar, kapsam dışı, hasar maruziyeti tablosu, poliçe dönemi simülasyonu, imza doğrulama, PNG.
- **Sigorta sayfası:** havuz bakiyesi, prim, tazminat, açık teminat, karşılama oranı; imzalı poliçeler; zincirli havuz defteri; 1000/1001 tablosu, formül, sınıf şartları, tetikler, dürüstlük notu.
- Canlı akışta poliçe kapsamı, “Tazminat ödendi” blokları ve bildirimleri.

## Doğrulananlar

- `npm test`, `npm run typecheck`, sahte Anthropic ile LLM yolu testi.
- Tarayıcıda 24 sayfa durumu (1440 px) ve tüm ana sayfalar (375 px): JS hatası ve yatay taşma yok.
- Arayüzden uçtan uca: poliçe dönemi simülasyonu → canlı tazminat (40 $ emir − %25 muafiyet = 30 $), havuz ve defter güncellendi.
- Kayıtlı kopya: sigorta sayfaları, poliçe kartları ve imza sonuçları sunucusuz açılıyor; jeton yok.

## Henüz denenmedi

- Gerçek Claude ile Acemi/Eğitimli poliçe karşılaştırması (API anahtarı gerekli).
- OKX demo hesabı modunda (`atk`) poliçeli koşu.

---

# 3. tur: Tempo, dürüst çerçeve, Avalanche

## Tempo
- Her sınav en az 3 saniye sürer (`EHLIYET_PACE_MS`, varsayılan 3000): tam sınav ≈ 36 sn (ölçüldü: 36 sn). Araç çağrısı önce görünür, cevap kısa süre sonra gelir. Testlerde kapalıdır.

## Ehliyetin neyi garanti ettiği
- Ehliyet sekmesinde “Gösterir / Önerir / Garanti etmez” kutusu ve “Bu ayar nasıl uygulanır” bölümü (ATK tarafı, geçit tarafı, uygulanmayan).
- Nasıl çalışır sayfasına “Ehliyet neyi garanti eder”, “Güvenlik sınırı”, “Borsa modları” bölümleri.
- Ana sayfa metni: “belirli bir ayarda … davranışını değerlendirir ve kısıtlı bir çalıştırma ayarı önerir”.

## Güvenlik sınırı ve modlar
- Her denetim sayfasında “Kapsam” notu: tavan ve kurallar yalnızca geçitten geçen emirlere uygulanır.
- Üç mod ayrı adlandırıldı: Çevrimdışı prova · Gerçek fiyat · sahte emir · OKX demo hesabı. Denetim başlığında mod rozeti; canlı yolda her emir cevabının kaynağı (geçit cevabı · borsaya gitmedi / sahte emir defteri / OKX demo hesabı).
- Sigorta sayfasına kapsam notu.

## Avalanche
- `contracts/EhliyetRegistry.sol`: değiştirilemez kayıt sözleşmesi (güncelleme/silme yok, aynı özet ikinci kez yazılamaz, yalnızca kurucu cüzdan yazar).
- `src/chain/`: RPC yedekli istemci, nonce takibi + tek sıralı gönderim, otomatik kayıt, açılışta bekleyenleri yazma, zincirden doğrulama.
- `npm run avalanche:setup` (cüzdan → bakiye → sözleşme → .env), `avalanche:status`, `avalanche:compile`, `test:chain`.
- Site: üst çubukta Avalanche durumu, ana sayfada Avalanche şeridi, sıralamada zincir simgesi, ehliyet sekmesinde kayıt paneli (“Zincirde doğrula”, “Snowtrace'te aç”, “Yeniden dene”), ehliyet kartında Avalanche işareti ve blok numarası, canlı yolda kayıt olayları, kayıtlı kopyada kopya anındaki doğrulama.

## Düzeltilen hatalar
- `.env`'de boş bırakılan değer (`EHLIYET_PORT=` gibi) 0 sayılıyordu; artık varsayılana düşer.
- Zincir yazımında eski nonce hatası (düğüm işlemden hemen sonra eski sayıyı döndürüyordu): yerel nonce takibi ve tek yeniden deneme.
- Toplu (batch) RPC istekleri bazı düğümlerde bozuk cevap veriyordu: kapatıldı.
- `test/llm-paths.ts` projenin gerçek `data/` klasörüne yazıyordu ve tempo kapanmıyordu: geçici klasör, doğru sıra.
- Mobilde ana sayfa 18 px taşıyordu (arka plan ışığı): düzeltildi.
- Avalanche kapalıyken ana sayfa “kayıtlı” diyordu: metinler gerçek duruma bağlandı.

## Doğrulananlar
- `npm test`, `npm run typecheck`, hibrit düşüş testi, sahte Anthropic ile LLM yolu.
- `npm run test:chain` yerel EVM'de art arda 7 kez 9/9: sözleşme kurulumu, otomatik kayıt, kanıt zincirinde kayıt olayı, zincirden doğrulama, puanı değiştirilmiş sahte ehliyetin yakalanması, aynı ehliyetin ikinci kez yazılamaması, başka cüzdanın yazamaması, tekrar istekte yeni işlem gönderilmemesi.
- Kurulum betiği: boş cüzdan (musluk talimatı), dolu cüzdan (sözleşme kurulumu), tekrar çalıştırma, durum; gerçek Fuji ağına bağlantı ve bakiye okuma.
- Tarayıcı: 36 sayfa durumu (1440 px) ve ana sayfalar (375 px), JS hatası ve taşma yok; Avalanche açık ve kapalı hâller; canlı sınavda zincir kaydı ve bildirim; kayıtlı kopyada zincir paneli.

## Henüz denenmedi
- Gerçek Fuji ağına yazma: test AVAX gerektirir (musluk insan doğrulaması istiyor). Adımlar CANLI-TEST.md'de.
