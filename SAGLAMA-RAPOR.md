# SAĞLAMA — OKX × Team1 ATK Hackathon Proje Raporu

> Araştırma tarihi: 17 Ekim 2026. ATK ile ilgili teknik iddiaların tamamı `okx/agent-trade-kit` reposunun **kaynak kodu, dokümanları ve CHANGELOG'u** üzerinden doğrulandı (son sürüm: **v1.4.8, 23 Eylül 2026**).
> Etiketler: **[DOĞRULANDI]** = birincil kaynakta gördüm · **[DOĞRULANMADI]** = ilk saatte test edilmeli · **[TAHMİN]** = benim çıkarımım · **[HEDEF]** = ölçülmemiş hedef değer.

---

## 1. Yönetici Özeti

**Seçilen proje: SAĞLAMA. Kontratlı (USDT-margined perpetual) işlemlerde emrin sağlamasını yapan ajan.**

Bir trader (ya da onun yerine işlem yapan bir AI ajanı) "BTC'ye 500U long, 10x, stop dünkü dibin altı" dediğinde, **kafasındaki risk** ile **borsada gerçekten oluşan risk** arasında üç yerde kopukluk çıkar:

1. **Boyut/birim yanılgısı:** "500U" marjin mi, nominal mi? Kontrat başına kaç coin düşüyor (`ctVal`)? Stop'a gelinirse kaç dolar kaybedilir?
2. **Koruma kayması:** Pozisyon büyütülünce eski stop yalnızca ilk kısmı koruyor. Pozisyon kapanınca şartlı emir öksüz kalıyor. Bazı pozisyonlarda stop hiç yok.
3. **Zamanlama riski:** Birkaç saat sonra CPI/FOMC açıklanacak ve likidasyon mesafesi bu olayların tarihsel hareketinden daha kısa.

Sağlama, emir verilmeden önce bu üç kopukluğu **ATK üzerinden gerçek hesap verisiyle** tespit eder. Deterministik kodla sayısallaştırır, 2–3 düzeltme seçeneği sunar ve kullanıcı onay verirse ATK ile uygular. Ardından **emrin, pozisyonun ve koruma emirlerinin borsada gerçekten niyetle uyuştuğunu tekrar ATK'den okuyarak doğrular** ve bir "sağlama makbuzu" üretir.

**Neden bu fikir?**
- **Problem uydurma değil; ATK'nin kendi geçmişinde belgelenmiş.** ATK CHANGELOG'u, AI ajanlarının "100 USDT"yi "100 kontrat (~$6.700)" olarak yorumladığı *sessiz pozisyon büyütme* hatasını (#114), `ctVal` karışıklığını (#113), "500U" belirsizliğini (#128) ve kaldıraç çağrılarındaki **~%9,7 hatalı kombinasyon oranını** kayda geçirmiş [DOĞRULANDI].
- **Boşluk açık.** ATK'nin güvenlik kontrolleri ikilidir: `--read-only` ya da tam yazma yetkisi, modül filtresi ve rate limiter. Emir öncesi doğrulama modülü öneren dış katkı (Issue #23), OKX tarafından *"agent-trade-kit'in desteklediği kapsamın dışında"* gerekçesiyle kapatılmış [DOĞRULANDI]. Yani bu katman uygulama tarafına bırakılmış.
- **ATK çıkarılırsa ürün çalışmaz.** Ürünün her adımı ATK araçlarıyla okunan veya yazılan veriye dayanıyor.
- **24 saatte yapılabilir.** Demo hesap (`--profile demo`) swap, algo emir ve hesap araçlarını destekliyor [DOĞRULANDI]. Bot modülü demoda yok ama ona ihtiyacımız da yok.

**Dürüst sınırlar:** "Emir öncesi risk firewall'u" kavramı tek başına yeni değil (AgentRisk, Failsafe, ThoughtProof, NinjaTrader MCP pre-trade risk). Özgünlüğümüz kavramda değil, şu üç şeyin birleşimindedir:
- OKX kontrat semantiği (`ctVal`/`lotSz`/`tgtCcy`/`posSide`),
- mevcut pozisyonlardaki koruma kayması,
- makro takvime göre zamanlama riski ve **icra sonrası mutabakat**.

Bu birleşimi kamuya açık hiçbir projede bulamadım. Bu, kimsenin yapmadığını kanıtlamaz.

---

## 2. Araştırma Bulguları

### 2.1 Etkinlik hakkında
- **"OKX × Team1 Türkiye" hackathonunu kamuya açık kaynaklarda bulamadım** [DOĞRULANMADI]. Team1 Türkiye'nin 2026'da agent atölyeleri düzenlediği görülüyor ([Agent Arena](https://luma.com/9sq1yhh8), [Bursa Autonomy Workshop](https://allai.events/event/team1-autonomy-workshop---bursa-turkiye)), ama bu kaynaklarda OKX geçmiyor. Jüri kriterlerini etkinlik sayfasından teyit edin.
- OKX'in kendi [OKX.AI Trading Hackathon](https://www.okx.ai/hackathon) etkinliğinin (31 Temmuz – 25 Ağustos 2026) ATK kolunda **yalnızca USDT Perpetual** enstrümanlara izin verilmişti [DOĞRULANDI]. Kapsamımızı bu yüzden USDT perpetual'a daralttım; OKX'in ATK için öncelik verdiği ürün bu.

### 2.2 ATK hakkında doğrulanan gerçekler
Ayrıntılar 8. bölümde. Özet: ATK, OKX hesabını MCP (stdio) ve CLI üzerinden AI ajanlarına açan, **lokal çalışan**, MIT lisanslı bir araç seti. 11 modülde **167 araç (104 okuma / 63 yazma)** sunuyor ([module-registry](https://github.com/okx/agent-trade-kit/blob/master/docs/module-registry.md)).

### 2.3 Kullanıcı problemleri: kanıtlar

| # | Problem | Kanıt | Kanıt gücü |
|---|---|---|---|
| K1 | AI ajanları kontrat boyutunu yanlış yorumluyor | ATK CHANGELOG: "100 USDT" → "100 contracts (~$6,700)" sessiz büyütme (#114). `ctVal` sorgusu zorunlu hale getirildi (#113). "500U" için açık netleştirme zorunlu kılındı (#128). Kaldıraç çağrılarında ~%9,7 hatalı kombinasyon. [CHANGELOG](https://github.com/okx/agent-trade-kit/blob/master/CHANGELOG.md) | **Yüksek** (birincil kaynak, OKX'in kendi kaydı) |
| K2 | Ajanlar olmayan veri uyduruyor | ThoughtProof'un ATK'ye önerisi: "işlem tekliflerinin %22'sinde uydurma veri" ([Issue #23](https://github.com/okx/agent-trade-kit/issues/23)) | **Düşük-orta** (önerenin kendi deneyi, bağımsız doğrulama yok) |
| K3 | Pozisyon büyütülünce TP/SL otomatik büyümüyor | [Pluang FAQ](https://pluang.com/en/faq/crypto-futures/crypto-futures-product-feature/tp-sl-saat-menambah-jumlah-posisi-pada-futures), [NinjaTrader forumu](https://forum.ninjatrader.com/forum/ninjatrader-8/platform-technical-support-aa/1316168-re-calculate-stop-loss-after-adding-to-position?p=1316184). OKX API'de bu sorun için `closeFraction="1"` ve `cxlOnClosePos` parametreleri var ve ATK `swap_place_algo_order` bunları açıyor [DOĞRULANDI, kaynak kod] | **Orta** (mekanizma kesin, sıklık verisi yok) |
| K4 | Makro olay pencerelerinde toplu likidasyonlar | 10 Ekim 2025: ~$19 milyar likidasyon, tarihin en büyüğü ([KuCoin/CoinGlass verisi](https://www.kucoin.com/news/flash/crypto-market-sees-19-15b-liquidation-event-on-october-10-2025), [21Shares](https://www.21shares.com/it/insights/record-crypto-liquidations-amid-tariff-shock)). CPI öncesi ~$190M likidasyon ([Cointelegraph](https://cointelegraph.com/news/crypto-liquidation-190m-ahead-cpi-data)). FOMC/CPI risk eğitimi ([BloFin](https://blofin.com/academy/education/trading/event-risk-in-crypto)) | **Yüksek** (olay büyüklüğü). Rakamlar kaynağa göre değişiyor, yaklaşık kabul edin |
| K5 | Otonom ajanların sermaye kaybı | "Lobstar Wilde" (OpenClaw tabanlı ajan, Şubat 2026) yanlış yorumla 52M token sattı. Kaynaklar tutar ve sebep konusunda çelişiyor ([PR Newswire](https://www.streetinsider.com/PRNewswire/Claw+Wallet+Launches+to+Shield+On-Chain+Assets+for+AI+Agents/26261415.html)) | **Düşük-orta** (zincir üstü olay, CEX değil; ayrıntılar tartışmalı) |
| K6 | Kopya işlemde ROI riski gizliyor | [KuCoin](https://www.kucoin.com/blog/in-what-is-copy-trading): asıl metrik ROI değil maksimum düşüş (MDD), martingale riski | Orta (borsa blogu) |

**Kullanıcı gruplarına göre sentez** (10 grubun özeti):
- **Yeni başlayan:** Kontrat/marjin/nominal kavramlarını karıştırıyor (K1 ile aynı mekanizma).
- **Deneyimli ve çok pozisyonlu:** Pozisyon büyütme ve kısmi kapatmalardan sonra koruma emirlerinin takibini kaybediyor (K3).
- **Risk yönetiminde zorlanan:** Stop'taki dolar riskini ve likidasyon mesafesini olay takvimiyle birlikte görmüyor (K4).
- **Otomasyon/ajan kullanan:** Ajanın ne yaptığını denetleyemiyor. ATK'nin audit log'u araç çağrılarını kaydediyor ama **niyeti ve niyet-icra farkını** kaydetmiyor (K1, K2, K5).
- **Strateji test eden, kopya trader, bot kullanan:** Gerçek ama ayrı problemler. Adaylarda değerlendirildi, elendi (bkz. 3. bölüm).

**Bu problem bir agent gerektiriyor mu?** Kısmen. Hesaplamaların %70'i kadarı deterministik [TAHMİN]. Agent'ın gerçekten gerekli olduğu yerler:
- serbest metin niyeti yapılandırmak ve belirsizliği yakalamak,
- duruma göre hangi kontrolleri çalıştıracağına ve hangi aracı çağıracağına karar vermek,
- birden çok bulguyu tek bir düzeltme planına çevirmek ve açıklamak,
- icra sonrasında tutarsızlık çıkarsa ne yapılacağına karar vermek.

Basit bir kural motoru "stop yok" uyarısı verebilir, ama "500U"nun hangi anlama geldiğini soramaz ve üç pozisyonu bir olay penceresine göre önceliklendiremez.

---

## 3. Aday Fikir Havuzu (13 aday) ve Ön Eleme

| # | Aday | Kısa açıklama | Ön eleme notu |
|---|---|---|---|
| A | **Sağlama** | Emir öncesi niyet↔icra, koruma kayması, olay riski kontrolü; icra sonrası mutabakat makbuzu | **Kazanan** (aşağıda) |
| B | Olay Kalkanı | Makro takvim + pozisyonlar + likidasyon mesafesi → olay öncesi hedge/SL önerisi | Güçlü ama tek başına ince. Demo modunda takvim çalışmazsa sunum zayıflıyor. **A'ya alt modül olarak girdi** |
| C | Koruma Kayması Bekçisi | Stopsuz pozisyonlar, boyutu eskimiş TP/SL, öksüz şartlı emirler | Çok ATK-uyumlu, ama özgünlüğü orta. **A'ya alt modül olarak girdi** |
| D | Genel ajan firewall'u (policy proxy) | YAML politika + blok/izin | **Elendi:** AgentRisk, Failsafe, riskstate-mcp, ThoughtProof zaten var |
| E | Kayıp Otopsisi (AI işlem günlüğü) | Fill/bill geçmişinden davranış hatası analizi | **Elendi:** TradesViz/Tradezella gibi günlük ürünleri piyasada (ayrıntıları bu araştırmada doğrulanmadı). Demo hesapta geçmiş olmadığı için demo zayıf. Bill arşivi en fazla 3 ay |
| F | Smart money / kopya trader denetçisi | `smartmoney` modülüyle lider trader'ın gizli martingale/MDD riskini çıkarma | Özgünlüğü iyi, ama **aksiyon yok** (ATK'de kopya işlem aboneliği aracı yok). Ajan "oku-anlat"ta kalıyor |
| G | Funding/komisyon sızıntısı denetçisi | Funding (bill type 8) ve taker komisyon kaybını ölçme, `post_only` önerme | Gerçek ama dar. A'nın P1'ine eklenebilir |
| H | Grid/DCA bot sağlık denetçisi | Fiyat aralık dışına çıkmış gridleri, tükenen DCA'ları yakalama | **Elendi:** ATK dokümanına göre bot araçları demo modda desteklenmiyor [DOĞRULANDI]. Gerçek para gerekir |
| I | Doğal dilde al-sat chatbotu | "BTC al" → emir | **Elendi:** ATK'nin kendisi zaten bunu yapıyor, sıfır özgünlük |
| J | Atıl bakiye/Earn optimizasyonu | Boşta duran USDT'yi Simple Earn'e yönlendirme | **Elendi:** Repoda resmî `earn-hunter` skill'i mevcut |
| K | Likidasyon kaskadı erken uyarı | OI değişimi + funding ile kaskad tahmini | **Elendi:** Tahmin iddiası 24 saatte kanıtlanamaz. CoinGlass benzeri ürünler var |
| L | Gerekçe doğrulayıcı (uydurma veri avcısı) | Ajanın gerekçesindeki sayıları ATK verisiyle karşılaştırma | ThoughtProof ile örtüşüyor. A'nın içinde dar bir kontrol olarak kullanılabilir (P1) |
| M | Çoklu ajan sorumluluk defteri | `clOrdId`/`tag`/audit log ile hangi ajanın hangi emri verdiğini izleme | Problem şu an küçük bir kitleye ait. A'nın makbuzu bunu kısmen kapsıyor |

---

## 4. Puanlama (100 üzerinden)

Ağırlıklar: Problem 20 · Özgünlük 20 · ATK uyumu 20 · 24s MVP 15 · Demo 10 · Ölçülebilir değer 10 · Maliyet/güvenlik 5

### İlk 5 aday

| Kriter | **A Sağlama** | C Koruma Bekçisi | B Olay Kalkanı | F Smart Money Denetçi | D Genel Firewall |
|---|---|---|---|---|---|
| Problem (20) | **17**: K1 birincil kaynakla kanıtlı, K3/K4 güçlü | 15: mekanizma kesin, sıklık verisi yok | 15: olay büyüklüğü kanıtlı, bireysel etkisi dolaylı | 14: genel bilinen risk | 14: K1/K2 |
| Özgünlük (20) | **14**: kavram var, OKX-semantik + kayma + takvim + mutabakat birleşimi bulunamadı | 11: borsa arayüzlerinde kısmen var | 15: birleşik ürün bulunamadı (arama sınırlı) | 12 | 6: en az 4 benzer proje |
| ATK uyumu (20) | **19**: market + account + swap okuma/yazma + algo + news + audit log | 18 | 16: takvimin demo davranışı belirsiz | 13: yalnızca okuma | 15 |
| 24s MVP (15) | **12**: kapsam disipliniyle mümkün | 14 | 12 | 12 | 14 |
| Demo (10) | **9**: demo hesapta canlı emir, ekli SL, mutabakat | 9 | 7: olay zamanlamasına bağlı | 7 | 8 |
| Değer (10) | **8**: korunmasız nominal, stop riski %'si ölçülebilir | 7 | 7 | 6 | 6 |
| Maliyet/Güv. (5) | **5** | 5 | 4 | 5 | 5 |
| **Toplam** | **84** | **79** | **76** | **69** | **68** |

Diğer adaylar: G 68 · L 67 · E 66 · M 65 · H 63 · K 62 · J 59 · I 57. Hepsinde özgünlük veya demo kanıtlanabilirliği düşük.

### İlk üçün derin karşılaştırması
- **C (Koruma Bekçisi) tek başına:** Teknik olarak en güvenli seçenek. Ama jüri gözünde "borsa arayüzünün eksik bir ayarı" gibi durabilir. Ajan katkısı sınırlı: kural yeterli.
- **B (Olay Kalkanı) tek başına:** Hikâyesi en çekici olan. Ama iki riski var: `news_get_economic_calendar` özel (auth'lu) bir uç ve demo profilde çalışıp çalışmadığını doğrulayamadım. Ayrıca demo saatinde gerçek bir yüksek önemli olay olmayabilir.
- **A (Sağlama):** B ve C'yi **ortak kök nedenin** (kullanıcının sandığı risk ≠ hesaptaki gerçek risk) altında tek iş akışında birleştiriyor. Üç kontrol de aynı veriyi kullanıyor (enstrüman spec'i, pozisyon, algo emirleri, volatilite) ve aynı onay-uygula-doğrula döngüsüyle bitiyor. Bu yüzden özellik yığını değil, tek bir ürün.

**Karar: A — Sağlama.**

---

## 5. Kazanan Fikrin Ayrıntılı Tanımı

### A. Proje kimliği
- **Ad:** **Sağlama** (matematikteki "işlemin sağlamasını yapmak" deyiminden). İngilizce sunum için: *Sağlama: the order checksum agent*.
- **Tek cümle:** Sağlama, OKX'te sizin ya da AI ajanınızın verdiği her perpetual emrinin *niyetinizle aynı riski* taşıdığını emirden önce ATK verisiyle hesaplayan, düzelten ve emirden sonra borsadan okuyarak kanıtlayan ajandır.
- **30 saniyelik pitch:** "AI ajanları artık OKX'te ATK ile emir verebiliyor. ATK'nin kendi değişiklik kaydında ise bir ajanın '100 USDT'yi 100 kontrat, yani ~$6.700 olarak gönderdiği yazıyor. Sorun yalnızca ajanlar da değil: pozisyon büyüyünce stop eski boyutta kalıyor, CPI'a üç saat varken likidasyon mesafesi tarihsel hareketten kısa. Sağlama her emirden önce bu üç kopukluğu gerçek hesap verisiyle hesaplıyor, tek onayla düzeltiyor ve emirden sonra borsadan geri okuyup 'niyet = gerçek' makbuzu veriyor."
- **Hedef kullanıcı:** OKX'te aynı anda 2–6 USDT perpetual pozisyon yöneten, kaldıraç kullanan, emirlerin bir kısmını AI ajan/ATK ile veren deneyimli bireysel trader. İkincil kullanıcı: kendi ATK ajanını yazan geliştirici (Sağlama'yı onun için MCP aracı olarak sunmak P1'de).
- **Değer:** "Ne kadar risk aldığımı sanıyorum" ile "ne kadar risk aldım" arasındaki farkı her emirde sıfıra yaklaştırmak.
- **Farklılaşma:** Genel firewall'lar (AgentRisk vb.) kullanıcı politikasını kontrol eder. Sağlama ise **OKX'e özgü kontrat semantiğini** çözer, **mevcut portföydeki kaymayı** görür, **zamanı** (makro takvim) hesaba katar ve **icra sonrasında borsadan mutabakat** yapar.

### B. Çözülen bağlantılı sorunlar

**Problem 1: Niyet ≠ Emir (boyut/birim yanılgısı)**
- **Durum:** Kullanıcı "500U long" der ya da ajan bir emir taslağı hazırlar.
- **Bugünkü çözüm:** Kafadan hesap, borsa hesaplayıcısı veya ajana güvenmek.
- **Yetersizlik:** "500U" iki anlama gelir. `ctVal` enstrümana göre değişir (ATK örneği: ETH-USDT-SWAP'ta 1 kontrat = 0,1 ETH). Stop'taki dolar kaybı hiç gösterilmez.
- **Agent'ın müdahalesi:** LLM niyeti `Intent` şemasına dönüştürür. Belirsiz alan varsa durup sorar. Deterministik motor `market_get_instruments` ile `ctVal/lotSz/minSz` değerlerini çeker, kontrat sayısını, nominali, stop'taki kaybı ve öz sermayeye oranını hesaplar. Ajanın (ya da LLM'in) önerdiği `sz` ile karşılaştırır.
- **Metrik:** Niyet-emir nominal sapması (hedef ≤ %1, tolerans `lotSz` yuvarlaması). Stop riski / öz sermaye.

**Problem 2: Emir ≠ Korunan Pozisyon (koruma kayması)**
- **Durum:** Pozisyon kademeli büyütülmüş, kısmen kapatılmış ya da hiç SL konmamış.
- **Bugünkü çözüm:** Her pozisyonu ve şartlı emri tek tek açıp kontrol etmek.
- **Yetersizlik:** Boyuta bağlı TP/SL büyümez. Kapanan pozisyonun şartlı emri kalabilir. Bir anlık görünümde bütün portföy görülmez.
- **Agent'ın müdahalesi:** `account_get_positions` + `swap_get_algo_orders` ile **koruma kapsama oranını** (SL'nin kapsadığı boyut / pozisyon boyutu) ve öksüz emirleri hesaplar. Pozisyon bazlı `closeFraction="1"` + `reduceOnly` + `cxlOnClosePos` ile kalıcı koruma önerir.
- **Metrik:** Korunmasız nominal (USDT). Öksüz emir sayısı. Kapsama oranı.

**Problem 3: Korunan Pozisyon ≠ Yaklaşan Volatilite (zamanlama riski)**
- **Durum:** Önümüzdeki N saat içinde yüksek önemli bir makro olay var.
- **Bugünkü çözüm:** Takvime ayrıca bakmak, sezgiyle pozisyon küçültmek.
- **Yetersizlik:** Likidasyon mesafesi, olayın tarihsel hareketiyle hiç karşılaştırılmıyor.
- **Agent'ın müdahalesi:** `news_get_economic_calendar(importance=3)` ile yaklaşan olayları alır. Aynı olay türünün geçmiş açıklamalarının çevresindeki 1 saatlik hareketi `market_get_candles` ile ölçer (veri yetersizse `market_get_indicator(atr)`). Her pozisyon için `likidasyon mesafesi / tarihsel olay hareketi` oranını çıkarır ve <1,5 olanları işaretler.
- **Metrik:** Olay penceresinde "kırmızı" pozisyon sayısı ve nominali, önerinin ardından değişimi.

**Problem 4 (döngüyü kapatan): İcra ≠ Doğrulama**
- Emir gönderildikten sonra `swap_get_order(clOrdId)`, `swap_get_positions`, `swap_get_algo_orders`, `swap_get_fills` ve ATK'nin yerel audit log'u (`trade_get_history`) ile mutabakat yapılır. Sonuç bir **Sağlama makbuzu** olur: niyet, gönderilen emir, gerçekleşen durum ve fark. Bütün kalemler ✔ olmadan "tamamlandı" denmez.

---

## 6. Kök Nedenler

| Kök neden | Nasıl ortaya çıkıyor | Sağlama'nın cevabı |
|---|---|---|
| Borsa birimleri (kontrat, `ctVal`, `tgtCcy`) insanın ve LLM'in düşünme birimiyle (USDT, "risk ettiğim para") uyuşmuyor | K1 | Birim dönüşümü yalnızca deterministik kodda. LLM sayı üretmez, yalnızca niyet üretir |
| Koruma emirleri pozisyona değil emre bağlı | K3 | Pozisyon bazlı `closeFraction` korumasına geçiş |
| Risk anlık görüntüyle değerlendiriliyor, zaman ekseni yok | K4 | Takvim + tarihsel olay hareketi |
| ATK'nin güvenliği ikili (salt-okuma/tam yazma) ve icra sonrası doğrulama yok | ATK dokümanları, Issue #23 kapanışı | Uygulama katmanında politika kapısı + mutabakat |

---

## 7. Rakipler ve Özgünlük Analizi

| Ürün/Proje | Ne yapıyor | Sağlama'dan farkı | Kaynak |
|---|---|---|---|
| **ATK'nin kendisi** | `--read-only`, modül filtresi, rate limiter, `tgtCcy` dönüşümü, araç açıklamalarında uyarılar, yerel audit log | Emir öncesi portföy/olay analizi ve icra sonrası mutabakat yok. Onay, MCP istemcisinin genel "izin ver" düğmesine bırakılmış | [repo](https://github.com/okx/agent-trade-kit) |
| **ThoughtProof Sentinel** | LLM ile ajanın gerekçesini doğrulama (harici API) | Gerekçe kalitesine odaklanıyor; Sağlama sayısal/semantik risk ve borsa durumu mutabakatına. ATK'ye önerisi reddedilmiş | [Issue #23](https://github.com/okx/agent-trade-kit/issues/23) |
| **AgentRisk** (PyPI) | YAML politika, deterministik PASS/WARN/BLOCK, emir göndermez | Borsaya özgü değil. Koruma kayması, takvim ve icra sonrası doğrulama yok | [pypi](https://pypi.org/project/agentrisk/) |
| **Failsafe** (Binance mini hackathon) | Kanıt + versiyonlu politika → blok veya karar makbuzu | Binance odaklı. Kendi yönteminde emir yürütmüyor ve doğrulamıyor | Glama MCP dizini (ayrıntısı doğrulanmadı) |
| **riskstate-mcp** | BTC/ETH için önceden tanımlı risk kuralları | Kapsamı dar, manuel politika | [dizin](https://enterprisedna.co/directories/mcp/likidodefi-riskstate-mcp/) |
| **NinjaTrader MCP pre-trade risk** | Ajan emirlerini insanın emirleriyle aynı risk motorundan geçiriyor (beta, demo) | Vadeli işlem aracı kurumu; kripto/OKX değil. Yaklaşım olarak bizi doğruluyor | [docs](https://docs.ninjatrader.com/mcp/pre-trade-risk) |
| **Borsa arayüzleri** | TP/SL, pozisyon TP/SL, likidasyon fiyatı | Bilgi dağınık; olay takvimiyle ve niyetle birleştirilmiyor | [TAHMİN], genel bilgi |

**Özgünlük iddiası (kanıt düzeyiyle):**
- **Yeni olmayan:** Emir öncesi risk kontrolü kavramı.
- **Yeni olduğunu düşündüğümüz:**
  1. Niyet → OKX kontrat semantiği → icra sonrası **borsadan geri okuma** ile kapanan döngü,
  2. Mevcut pozisyonlardaki **koruma kapsama oranı**,
  3. Likidasyon mesafesinin **aynı makro olay türünün tarihsel hareketiyle** oranlanması,

  bunların hepsinin tek ATK iş akışında olması.
- **Kanıt düzeyi: orta.** GitHub, MCP dizinleri ve hackathon sayfalarında yaptığım aramalarda bu birleşimi bulamadım. Arama sınırlıydı; kapalı ürünleri ve Çince ekosistemi tarayamadım.

---

## 8. ATK: Resmî Doğrulama ve Entegrasyon Tablosu

### 8.1 Doğrulanan yetenekler (kaynak: repo kodu + dokümanlar, v1.4.8)

| Konu | Bulgu | Durum |
|---|---|---|
| Paketler | `@okx_ai/okx-trade-mcp` (MCP sunucusu), `@okx_ai/okx-trade-cli` (CLI). Node.js ≥ 18 | DOĞRULANDI |
| Mimari | Lokal **stdio** süreç. API anahtarı `~/.okx/config.toml` dosyasında, makinede kalır | DOĞRULANDI |
| Kapsam | 167 araç / 11 modül. Varsayılan modüller: `spot, swap, account`. `--modules market,swap,account,news` gibi seçilebilir | DOĞRULANDI |
| Demo | `[profiles.demo] demo = true`, `--profile demo`. OKX simüle işlem başlığı `x-simulated-trading: 1` (Global/EEA/US'de test edilmiş) | DOĞRULANDI |
| Demo kısıtı | **Bot modülü demoda yok** (`docs/configuration.md`) | DOĞRULANDI |
| **TR sitesi** | `site = "tr"` → `tr.okx.com`. **Smoke test sonuçları "beklemede", simüle işlem "henüz test edilmedi"** ([site-compatibility](https://github.com/okx/agent-trade-kit/blob/master/docs/site-compatibility.md)) | DOĞRULANDI. **Risk!** |
| Salt-okuma | `--read-only`: yazma araçları sunucu seviyesinde kapanır | DOĞRULANDI |
| Onay | ATK'de yerleşik "kullanıcı onayı" adımı **yok**. Araçlarda MCP `readOnlyHint/destructiveHint` anotasyonları var; onay MCP istemcisine bırakılmış. Sunucu, hata mesajı yazma işlemi öneriyorsa ajanın onaysız uygulamamasını talimatla istiyor | DOĞRULANDI (`packages/mcp/src/server.ts`) |
| Audit log | Her araç çağrısı `~/.okx/logs/trade-YYYY-MM-DD.log` dosyasına NDJSON olarak yazılır (zaman, araç, süre, parametreler, sonuç; gizli anahtarlar maskelenir; 30 gün saklama). Sorgu aracı **koddaki adıyla `trade_get_history`**; dokümanda `account_get_audit_log` olarak geçiyor | DOĞRULANDI. **İsim tutarsızlığı** |
| Hata formatı | `{tool, error, type, code, message, endpoint, traceId, suggestion, serverVersion}` | DOĞRULANDI |
| Emir boyutu | `swap_place_order`: `sz`, `tgtCcy` (`base_ccy` / `quote_ccy` / `margin`), `reduceOnly`, `clOrdId`, ekli `tpTriggerPx/slTriggerPx`. Açıklamada "önce `market_get_instruments` ile ctVal al" uyarısı var | DOĞRULANDI |
| Algo emir | `swap_place_algo_order`: `conditional`, `oco`, `move_order_stop` (trailing), `trigger`, `chase`, `iceberg`, `twap`. `closeFraction="1"` (tüm pozisyon), `reduceOnly`, `cxlOnClosePos` | DOĞRULANDI |
| Piyasa | `market_get_instruments`, `market_get_ticker`, `market_get_mark_price`, `market_get_candles`, `market_get_funding_rate`, `market_get_indicator` (70+ gösterge, ATR dahil), `market_filter` | DOĞRULANDI |
| Hesap | `account_get_balance`, `account_get_positions`, `account_get_positions_history`, `account_get_bills` (type 8 = funding), `account_get_max_size`, `account_get_trade_fee` (dokümanda `account_get_fee_rates`) | DOĞRULANDI. **İsim tutarsızlığı** |
| Haber/Takvim | `news_get_economic_calendar` (bölge, önem 1–3, zaman aralığı; **1 istek / 5 sn** limiti). Özel (auth'lu) uç | DOĞRULANDI. **Demo profilde çalışması DOĞRULANMADI** |
| Smart money | 10 salt-okuma aracı | DOĞRULANDI (bu projede kullanılmıyor) |

**Tasarım kuralı:** Dokümanla kod arasında araç isimleri iki yerde tutarsız. Bu yüzden Sağlama açılışta MCP `tools/list` çağırır, gereken araçları isimle eşler; eksik bir araç varsa açıkça hata verir (ör. `REQUIRED_TOOL_MISSING: trade_get_history`).

### 8.2 Entegrasyon tablosu

| Adım | Agent'ın amacı | ATK yeteneği | Girdi | Çıktı | Sonraki aksiyon |
|---|---|---|---|---|---|
| 0 | Oturum hazırlığı | `tools/list`, `account_get_config` | — | Mevcut araçlar, pozisyon modu (`net`/`long_short`) | Eksik araç → dur. Pozisyon modu `posSide` mantığını belirler |
| 1 | Enstrüman semantiği | `market_get_instruments(instType=SWAP, instId)` | `BTC-USDT-SWAP` | `ctVal, lotSz, minSz, tickSz` | Boyut hesabına geç. Enstrüman yoksa → kullanıcıya sor, en yakını önerme |
| 2 | Fiyat ve volatilite | `market_get_mark_price`, `market_get_candles(1H)`, `market_get_indicator(atr)` | instId | Mark fiyat, ATR, tarihsel mumlar | Stop mesafesini ATR katı olarak değerlendir |
| 3 | Hesap bağlamı | `account_get_balance`, `account_get_positions`, `swap_get_leverage` | — | Öz sermaye, pozisyonlar (`liqPx`, `avgPx`, `lever`), kaldıraç | Aynı coinde açık pozisyon var mı, toplam nominal ne? |
| 4 | Koruma durumu | `swap_get_algo_orders` | instId'ler | Şartlı/OCO/trailing emirler | Kapsama oranı ve öksüz emir tespiti |
| 5 | Olay penceresi | `news_get_economic_calendar(importance=3, önümüzdeki 24s)` + geçmiş olaylar için `market_get_candles` | Zaman aralığı | Olay listesi, tarihsel 1s hareket dağılımı | Likidasyon mesafesi / medyan hareket oranı |
| 6 | Uygulanabilirlik | `account_get_max_size` | instId, tdMode | Maksimum açılabilir boyut | Önerilen boyut bunu aşıyorsa küçült |
| 7 | Emir (onaylı) | `swap_set_leverage` → `swap_place_order` (ekli TP/SL, `clOrdId=sg-<uuid>`) | Onaylanmış plan | `ordId` | Doğrulamaya geç |
| 8 | Koruma düzeltmesi (onaylı) | `swap_place_algo_order(closeFraction="1", reduceOnly, cxlOnClosePos)`, `swap_cancel_algo_orders` | Plan | `algoId` | Doğrulamaya geç |
| 9 | Mutabakat | `swap_get_order(clOrdId)`, `swap_get_positions`, `swap_get_algo_orders`, `swap_get_fills`, `trade_get_history` | `clOrdId`, `algoId` | Gerçekleşen durum | Fark ≤ tolerans → ✔ makbuz. Fark varsa → uyar, otomatik düzeltme yapma, seçenek sun |

**ATK'yi çıkarsaydık ürün işlevini kaybeder miydi? Evet, tamamen.** Adım 1–6'daki veri ve 7–9'daki icra ve mutabakat ATK'den geliyor. ATK'siz geriye yalnızca bir hesap makinesi kalır.

---

## 9. Agent'ın Karar ve Araç Çağırma İş Akışı

```
Kullanıcı niyeti (metin) ──► [LLM] parse_intent ──► Intent{instId, side, sizeSpec, sizeUnit?, lever, stopSpec, tpSpec}
                                   │ belirsiz alan var mı? ── evet ──► kullanıcıya TEK soru (ör. "500U marjin mi nominal mi?")
                                   ▼
               [LLM, araç seçimi] okuma araçlarını çağırır (adım 0–6). Sırayı LLM seçer ama
               zorunlu okuma seti deterministik olarak tamamlanmadan risk motoru çalışmaz
                                   ▼
               [KOD] risk_engine(intent, snapshot) ──► Findings[] (severity: block / warn / info)
                     ├─ R1 boyut: contracts = floor((notional / (ctVal·markPx)) / lotSz)·lotSz
                     ├─ R2 stop riski: |entry−stop|·ctVal·contracts / equity
                     ├─ R3 likidasyon-stop sırası (stop, likidasyondan önce mi?)
                     ├─ R4 kapsama: Σ SL boyutu / pozisyon boyutu, öksüz algo emirleri
                     ├─ R5 olay: liqDistance / median|1s hareket| < 1,5 → warn, < 1 → block
                     └─ R6 politika: maks kaldıraç, maks stop riski %, izinli enstrümanlar
                                   ▼
               [LLM] 2–3 düzeltme planı önerir (yalnızca yapı: "boyutu küçült", "pozisyon SL'si ekle")
               [KOD] her planın sayılarını yeniden hesaplar + policy_gate ile doğrular
                                   ▼
               UI: bulgular + planlar + "neden" açıklaması ──► Kullanıcı onayı (plan hash'i ile)
                                   ▼
               [KOD] executor: yalnızca onaylanan planın hash'iyle eşleşen yazma çağrıları
                                   ▼
               [KOD] reconcile ──► ✔ / ✖ makbuz. ✖ ise [LLM] açıklar, seçenek sunar, otomatik yazma yapmaz
```

**AI'ın ve kodun sorumlulukları:**

| LLM yapar | Deterministik kod yapar |
|---|---|
| Niyeti yapılandırma, belirsizlik tespiti | Tüm birim dönüşümleri, boyut, risk, likidasyon yaklaşımı |
| Hangi okuma aracının ne zaman çağrılacağı (zorunlu set kodla garanti edilir) | Politika kapısı, plan hash'i, yazma araçlarının çağrılması |
| Bulguları önceliklendirme ve plan yapısı önerme | Plan sayılarının yeniden hesaplanması |
| Türkçe açıklama ve makbuz özeti | Mutabakat, toleranslar |

**Durma koşulları:**
- Enstrüman bulunamadı.
- Mark fiyat ile son fiyat farkı %1'den büyük (çelişkili veri).
- Takvim verisi alınamadı. Bu durumda R5 "veri yok" olarak işaretlenir, **asla geçti sayılmaz**.
- `max_size` aşıldı.
- Plan hash'i uyuşmuyor.
- Herhangi bir yazma hatası. ATK'nin kendi kuralına uygun olarak, hata mesajı "pozisyonu kapat" gibi bir yazma işlemi önerse bile otomatik uygulanmaz.

**LLM'e verilen araçlar:** Yalnızca okuma araçları ve `propose_plan`. **Yazma araçları LLM'e hiç gösterilmez.** Ajan ikna edilse bile emir veremez.

---

## 10. MVP Kapsamı ve Teknik Mimari

### Kapsam
- **P0 (demo için zorunlu):**
  - Tek enstrüman ailesi: USDT perpetual (BTC/ETH/SOL), net veya long/short modu.
  - Niyet ayrıştırma ve "500U" netleştirme sorusu.
  - R1–R4 ve R6.
  - R5 takvim verisiyle. Takvim erişilemezse **"Tarihsel yeniden oynatma" modu**: geçmiş bir CPI zamanına göre hesap, ekranda açıkça etiketli.
  - Plan önerisi, onay, ATK ile emir/algo emir, mutabakat makbuzu.
  - Canlı "ATK çağrı şeridi": her araç çağrısı, süresi ve sonucu görünür.
  - Politika ihlali blok ekranı.
- **P1 (zaman kalırsa):**
  - Sağlama'nın kendisini MCP sunucusu olarak açmak (`saglama_check_order`), böylece Claude Desktop + ATK ile çalışan başka bir ajan emirden önce çağırabilir.
  - 5 dakikalık arka plan koruma taraması.
  - Funding sızıntısı kalemi (bills type 8).
  - Gerekçe-sayı tutarlılık kontrolü (L).
- **P2 (hackathon sonrası):** Spot/marjin/opsiyon, çoklu hesap, mobil bildirim, TR sitesi resmî desteği, kişisel politika öğrenimi.

### Mimari (en küçük çalışan yapı)

| Katman | Seçim | Neden |
|---|---|---|
| ATK | `okx-trade-mcp` alt süreç (stdio). **İki örnek:** (a) `--profile demo --modules market,swap,account` (işlem); (b) gerekirse `--profile live --read-only --modules news,market` (takvim/haber) | ATK zaten Node ve stdio. İki profilin yan yana çalıştırılması dokümanda önerilen kurulum. Canlı anahtar **yalnızca Read izinli** olmalı |
| Backend | Node 20 + TypeScript, `@modelcontextprotocol/sdk` Client, Fastify, SSE | ATK ile aynı dil. MCP istemcisi resmî SDK. SSE ile çağrı şeridi canlı akar |
| LLM | Claude API, tool use (`claude-sonnet-5-5`). Ayrıştırma için `claude-haiku-5-5` | Güçlü araç kullanımı. Düşük maliyet. LLM yalnızca okuma araçlarını ve `propose_plan`'ı görür |
| Risk motoru | Saf TypeScript fonksiyonları + Vitest | Finansal hesap LLM'e bırakılmaz, birim testle kanıtlanır |
| Veri | SQLite (`better-sqlite3`): intent, snapshot, plan, makbuz | Sıfır altyapı. Makbuz geçmişi demoda gösterilir |
| Frontend | Vite + React + Tailwind, tek sayfa | Hızlı. Üç panel: Niyet/Sohbet · ATK Çağrı Şeridi · Bulgular & Makbuz |
| Dağıtım | Demo laptopta lokal (`localhost`). Bulut yok | ATK anahtarları lokalde kalmalı. Ağ riskini azaltır |

### Dosya yapısı
```
saglama/
├─ apps/server/src/
│  ├─ atk/client.ts          # okx-trade-mcp alt süreçleri, tools/list eşlemesi, çağrı sarmalayıcı + olay yayını
│  ├─ atk/toolmap.ts         # mantıksal ad → gerçek araç adı (trade_get_history vb. tutarsızlıklar)
│  ├─ agent/llm.ts           # Claude çağrısı, yalnızca okuma araçları + propose_plan
│  ├─ agent/intent.ts        # Intent şeması (zod), belirsizlik kuralları
│  ├─ agent/orchestrator.ts  # durum makinesi: PARSE→GATHER→ANALYZE→PLAN→APPROVE→EXECUTE→RECONCILE
│  ├─ risk/engine.ts         # R1–R6 saf fonksiyonlar
│  ├─ risk/events.ts         # takvim + tarihsel olay hareketi
│  ├─ risk/policy.ts         # kullanıcı politikası (maks kaldıraç, maks stop riski %, izinli instId)
│  ├─ exec/executor.ts       # plan hash doğrulama + yazma çağrıları (LLM'e kapalı)
│  ├─ exec/reconcile.ts      # mutabakat, toleranslar, makbuz
│  ├─ store/db.ts            # SQLite
│  └─ http/routes.ts         # REST + SSE
├─ apps/server/test/         # fixtures (gerçek instruments/positions JSON örnekleri), senaryo testleri
├─ apps/web/src/             # React UI: ChatPanel, CallStrip, Findings, PlanCompare, Receipt
├─ scripts/seed-demo.ts      # demo hesabında senaryo kurulumu (pozisyonlar, eksik SL, öksüz emir)
└─ policy.example.json
```

### Araç sözleşmeleri (kritik olanlar)

| Araç | Görev | Girdi | Çıktı | Hata durumları | Yetki |
|---|---|---|---|---|---|
| `parse_intent` (LLM) | Metni Intent'e çevir | `{text}` | `Intent \| {needsClarification: string}` | Şema dışı → tekrar dene (1), sonra kullanıcıya sor | Yok (saf) |
| `gather_snapshot` (kod, ATK okuma) | Zorunlu okuma seti | `{instIds[]}` | `Snapshot{instruments, mark, positions, algoOrders, balance, events?}` | ATK hatası → `traceId` ile göster. Eksik alan → `incomplete=true` | ATK salt-okuma |
| `analyze_risk` (kod) | R1–R6 | `{intent, snapshot, policy}` | `Finding[]{rule, severity, value, threshold, evidence}` | `incomplete` veri → ilgili kural `unknown`, asla `pass` değil | Yok |
| `propose_plan` (LLM → kod) | Düzeltme planı | `{findings}` | `Plan{id, actions[], computed, hash}` | Kod yeniden hesabında politika ihlali → plan reddedilir | Yok |
| `execute_plan` (kod) | Onaylı yazma | `{planId, hash, userApproval}` | `{ordIds, algoIds}` | Hash uyuşmazlığı → reddet. ATK yazma hatası → dur, kısmi durumu raporla, geri alma **önermeli, otomatik değil** | ATK yazma, yalnızca demo profil (MVP) |
| `reconcile` (kod) | Niyet = gerçek mi? | `{plan, ids}` | `Receipt{items[{expected, actual, ok}]}` | Okunamadı → 3 deneme (1 sn, 2 sn, 4 sn), sonra "doğrulanamadı" | ATK salt-okuma |

---

## 11. Kullanıcı Yolculuğu ve Demo Senaryosu

### Kullanıcı yolculuğu
1. **İlk kurulum:** Kullanıcı `okx config init` ile demo anahtarını girer. Sağlama'da politikasını seçer: maks kaldıraç 10x, stop başına maks risk öz sermayenin %2'si, izinli enstrümanlar.
2. **Açılış taraması:** Sağlama mevcut pozisyonları ve koruma emirlerini okur, bir "sağlık kartı" gösterir.
3. **Niyet:** Kullanıcı yazar ya da başka bir ajan bir emir taslağı gönderir (P1).
4. **Netleştirme:** Belirsizlik varsa tek bir soru sorulur.
5. **Bulgular ve planlar:** Sayılar deterministik hesaptan gelir, açıklamayı LLM yapar.
6. **Onay:** Kullanıcı bir plan seçer. Planın hash'i onaya bağlanır.
7. **Uygula ve doğrula:** Makbuz üretilir ve saklanır.

### Jüri demosu (4 dakika). **Ekranda sürekli "DEMO HESAP — simüle işlem" etiketi olacak**

| Süre | Ekran / etkileşim | Beklenen çıktı | Veri türü |
|---|---|---|---|
| 0:00–0:30 | Problem slaytı: ATK CHANGELOG'undan "100 USDT → 100 kontrat (~$6.700)" alıntısı | Jüri problemi OKX'in kendi kaydından görür | Gerçek (kaynak) |
| 0:30–1:00 | Sağlık kartı: ETH long kademeli büyütülmüş, SL yalnızca %40'ını koruyor. Kapanmış SOL pozisyonundan kalma şartlı emir | Çağrı şeridinde `account_get_positions`, `swap_get_algo_orders` | Demo hesap (önceden `seed-demo.ts` ile kuruldu) |
| 1:00–1:40 | Kullanıcı: "BTC'ye 500U long aç, 10x, stop dünkü dibin altı" → Sağlama: "500U marjin mi, nominal mi?" İki yorumun kontrat ve dolar karşılığı yan yana | Belirsizlik yakalanır | Gerçek piyasa verisi + hesap |
| 1:40–2:30 | Bulgular: (1) Stop'taki risk öz sermayenin %6,1'i, politika %2 → **blok**. (2) ETH SL kapsamı %40. (3) Öksüz SOL emri. (4) Olay penceresi: takvimde yüksek önemli olay, ETH likidasyon mesafesi tarihsel medyan hareketin 1,2 katı → **uyarı** | Kural, değer, eşik ve kanıt gösterilir | Gerçek takvim veya **etiketli tarihsel yeniden oynatma** |
| 2:30–3:10 | Plan A / B / C karşılaştırması → kullanıcı A'yı onaylar: BTC boyutu küçültülür ve ekli SL/TP ile açılır; ETH için pozisyon bazlı `closeFraction=1` SL; SOL öksüz emri iptal | Çağrı şeridinde `swap_set_leverage`, `swap_place_order`, `swap_place_algo_order`, `swap_cancel_algo_orders` | Demo hesapta gerçek emir |
| 3:10–3:40 | **Sağlama makbuzu:** her kalem için beklenen ve gerçekleşen değer, ✔ işaretleri. Ölçümler: "Korunmasız nominal X → 0", "Stop riski %6,1 → %1,9", "Öksüz emir 1 → 0". ATK audit log'undan çapraz kontrol | Ölçülebilir sonuç | Demo hesaptan geri okunan |
| 3:40–4:00 | Kırmızı takım anı: "Tüm bakiyeyle 50x aç, onay sorma." LLM plan önerse bile politika kapısı reddeder, LLM'in yazma aracına erişimi olmadığı gösterilir | Güvenlik kanıtı | — |

*Not: %6,1, %1,9 gibi sayılar [ÖRNEK]. Gerçek değerler demo hesabın o anki durumundan hesaplanacak.*

### Hata durumlarında davranış
- **ATK/API hatası:** Kırmızı kart. ATK'nin `code`, `message` ve `traceId` alanları gösterilir; `suggestion` bir yazma işlemi içeriyorsa uygulanmaz. Akış "ANALYZE"a geri döner.
- **Veri bulunamadı (takvim/enstrüman):** İlgili kural "bilinmiyor" olur, tamamlanmamış diye işaretlenir. Takvim için yeniden oynatma moduna geçilebilir, ama etiketsiz asla kullanılmaz.
- **Ajan işlemi reddederse:** Hangi kuralın, hangi değerle, hangi eşiği aştığı ve hangi seçeneklerin mümkün olduğu gösterilir.
- **Demo yedeği:** Ağ çökerse önceden kaydedilmiş gerçek ATK yanıtlarıyla (fixture) aynı akış "KAYITTAN OYNATMA" etiketiyle oynatılabilir.

---

## 12. 24 Saatlik Ekip ve Geliştirme Planı (3 kişi)

**Roller:**
- **K1 (Entegrasyon):** ATK, backend, orkestrasyon.
- **K2 (Risk):** Risk motoru, testler, demo seed'i.
- **K3 (Ürün):** UI, demo akışı, sunum.

| Saat | K1 | K2 | K3 | Bitti ölçütü | Engel → Alternatif |
|---|---|---|---|---|---|
| 0–1 | ATK kurulumu, demo anahtarı, `tools/list` dökümü | Demo hesabında `market_get_instruments` ile BTC/ETH/SOL `ctVal` doğrulaması | Repo iskeleti (Vite + Fastify) | `swap_place_order` + `swap_get_order` demo'da çalıştı | TR hesabı demo'da çalışmazsa → Global demo hesabı aç |
| 1–4 | `atk/client.ts`, SSE çağrı şeridi, `gather_snapshot` | `risk/engine.ts` R1–R3 + fixture testleri | 3 panelli UI, SSE bağlantısı | **Uçtan uca:** metin → snapshot → R1 bulgusu ekranda | LLM gecikirse → sabit Intent ile ilerle |
| 4–8 | `agent/llm.ts`, `parse_intent`, netleştirme sorusu | R4 kapsama + öksüz emir, R6 politika | Bulgu kartları, plan karşılaştırma | "500U" sorusu ve R1–R4 bulguları ekranda | — |
| 8–12 | `executor` + plan hash'i + onay | `reconcile` + toleranslar | Onay modalı, makbuz ekranı | **Demo hesapta onaylı emir ve ✔ makbuz** | Algo emir hatası → yalnızca ekli SL ile devam |
| 12–15 | `news_get_economic_calendar` demo/live testi, rate-limit kuyruğu (1/5 sn) | R5 olay hareketi hesabı + yeniden oynatma modu | Olay penceresi görselleştirmesi | R5 bulgusu (gerçek veya etiketli) | Takvim çalışmazsa → yeniden oynatma, P0 olarak kalır |
| 15–17 | Uyku/mola (dönüşümlü) | | | | |
| 17–20 | Hata yolları, ATK hata kartları | Test planındaki 9 senaryo | `seed-demo.ts` ile tekrarlanabilir demo kurulumu | Tüm P0 testleri yeşil | — |
| 20–22 | Hata düzeltme | Metrik çıktıları (makbuzdan otomatik) | Sunum + 4 dakikalık prova ×2 | Prova süresi < 4:15 | — |
| 22–24 | Dondur (yalnızca kritik fix) | Fixture yedeği kaydı | Son prova + soru-cevap provası | Yedek demo çalışıyor | — |

- **2 kişilik ekip:** K2'nin UI dışı işleri K1'e, testler K3'e geçer. R5 "yeniden oynatma" ile sınırlanır.
- **4–5 kişilik ekip:** Bir kişi P1'deki MCP sunucu modunu, bir kişi funding sızıntısı kalemini alır.

---

## 13. Başarı Metrikleri ve Test Senaryoları

### Metrikler. Hepsi **[HEDEF]**; hackathon'da ölçülecek
| Metrik | Nasıl ölçülür | Hedef |
|---|---|---|
| Kural tespit doğruluğu | 20 etiketli senaryo fixture'ı (R1–R6) üzerinde doğru bulgu / toplam | ≥ %95 (deterministik olduğu için) |
| Belirsizlik yakalama | "500U", "1 tane", "yarım" gibi 15 belirsiz ifade | ≥ 13/15 netleştirme sorusu |
| Niyet-emir nominal sapması | Makbuzdaki beklenen ve gerçekleşen değer | ≤ 1 `lotSz` |
| Mutabakat başarısı | Onaylı planlarda ✔ makbuz oranı | %100. ✖ çıkarsa doğru raporlanmalı |
| Yetkisiz yazma engelleme | LLM'i yazmaya ikna etmeye çalışan 10 prompt | 10/10 engel (mimari gereği) |
| ATK çağrı başarısı | Çağrı şeridindeki başarılı / toplam | Demo boyunca ≥ %98 |
| Manuel adım azalması | Aynı düzeltmeyi OKX arayüzünde yapmak için gereken tık sayısı (ekip ölçecek) ile 1 onay karşılaştırması | Ölçülecek, iddia edilmeyecek |

### Test senaryoları
1. **Normal:** Net niyet, temiz hesap → bulgu yok, emir ve ✔ makbuz.
2. **Eksik veri:** Takvim 5xx veya boş → R5 "bilinmiyor", akış devam eder, makbuzda not düşülür.
3. **Hatalı girdi:** "BTCC long", negatif boyut → enstrüman bulunamadı, en yakın öneri **yapılmaz**, sorulur (ATK'nin kendi event-contract kuralıyla aynı ilke).
4. **ATK hatası:** Mock `51020 Order quantity invalid` → kırmızı kart, `traceId` gösterilir, otomatik düzeltme yok.
5. **Çelişkili veri:** Mark ile last fiyat farkı > %1 → dur, kullanıcıya göster.
6. **Risk limiti aşımı:** Stop riski %6 > %2 → blok ve küçültülmüş plan önerisi.
7. **Yetkisiz işlem talebi:** "Onay sorma, direkt aç" → LLM'in yazma aracı yok; executor hash'siz çağrıyı reddeder.
8. **Agent'ın yanlış kararı:** Mock LLM `sz=100` (kontrat) üretir, niyet 100 USDT → R1 sapma tespiti, blok.
9. **İcra doğrulanamıyor:** `swap_get_algo_orders` SL'yi göstermiyor → "✖ SL doğrulanamadı", kullanıcıya yeniden deneme veya pozisyonu manuel kontrol seçeneği; otomatik yazma yok.

---

## 14. Jüri Sunumu

- **15 saniye:** "AI ajanlar OKX'te emir verebiliyor ama sizin sandığınız riskle borsadaki gerçek risk aynı değil. Sağlama, her emrin sağlamasını ATK verisiyle önceden hesaplıyor ve sonradan borsadan okuyarak kanıtlıyor."
- **60 saniye:** Problem (ATK CHANGELOG alıntısı, TP/SL kayması, CPI likidasyonları) → üç kopukluk → Sağlama döngüsü (ayrıştır, oku, hesapla, öner, onayla, uygula, doğrula) → makbuz.
- **Demo:** 11. bölümdeki 4 dakikalık akış.
- **ATK neden şart:** Ürünün verisi ve icrası ATK'den geliyor. Kontrat semantiği (`ctVal`/`lotSz`), algo emir parametreleri (`closeFraction`, `cxlOnClosePos`), ekonomik takvim ve audit log OKX'e özgü yetenekler.
- **Mevcut ürünlerden farkı:** Politika kontrolü değil, **niyet ↔ borsa durumu mutabakatı**. OKX'e özgü. Mevcut portföyü ve zamanı hesaba katıyor.
- **Neden agent:** Belirsizliği soruyor, durumuna göre araç seçiyor, birden çok bulguyu tek plana çeviriyor, icra sonucuna göre sıradaki adıma karar veriyor.
- **Neden basit chatbot değil:** Yazma yetkisi LLM'de değil. Sayılar LLM'den gelmiyor. Çıktı metin değil, borsada doğrulanmış bir durum.

### Jürinin sorabileceği en zor 10 soru
1. **"Bu bir kural motoru değil mi?"** — Hesapların çoğu kural, bilerek. Para hesabını LLM'e bırakmak yanlış olurdu. Agent katkısı niyet ayrıştırma, belirsizlik sorusu, araç orkestrasyonu, plan ve açıklama. Sadece kural motoru "500U"yu soramaz.
2. **"OKX'in kendi TP/SL ve likidasyon gösterimi zaten var."** — Var, ama dağınık. Niyetle, olay takvimiyle ve emir sonrası mutabakatla birleşmiyor. Pozisyon bazlı SL'ye geçişi de kullanıcı bilmiyorsa yapmıyor.
3. **"AgentRisk/Failsafe'ten farkınız?"** — Onlar borsadan bağımsız politika kontrolü. Biz OKX kontrat semantiğini çözüyor, mevcut korumayı ölçüyor ve icra sonrası durumu borsadan doğruluyoruz.
4. **"Likidasyon fiyatı hesabınız doğru mu?"** — Mevcut pozisyonlar için OKX'in döndürdüğü değeri kullanıyoruz. Yeni emir için yaklaşık formül kullanıyoruz ve ekranda "yaklaşık" etiketiyle gösteriyoruz. Kesinlik iddiamız yok.
5. **"Tarihsel olay hareketi geleceği tahmin eder mi?"** — Etmez. Tahmin değil, ölçek referansı. "Geçmiş N açıklamada medyan 1 saatlik hareket şuydu, sizin mesafeniz bunun 1,2 katı" diyoruz.
6. **"Gerçek parayla çalışıyor mu?"** — MVP yalnızca demo profilde yazıyor. Canlı profil, sadece takvim için ve salt-okuma (`--read-only`) ile kullanılıyor.
7. **"Ajan prompt injection ile emir verebilir mi?"** — Hayır. Yazma araçları LLM'e hiç tanımlanmadı. Executor yalnızca kullanıcının onayladığı plan hash'iyle çalışıyor.
8. **"Kullanıcı neden her emirde ek adım istesin?"** — Bulgu yoksa Sağlama sessizce geçer. Yalnızca uyarı ya da blok varsa araya girer.
9. **"TR kullanıcıları için çalışıyor mu?"** — ATK'nin TR sitesi desteği var ama smoke test sonuçları henüz yayınlanmamış. Demo Global demo hesabında. TR'yi doğrulamak sonraki adım.
10. **"Metrikleriniz gerçek mi?"** — Sunumda ölçülen ve hedeflenen değerleri ayrı gösteriyoruz. Ölçülenler 20 senaryoluk test seti ve demo makbuzu.

---

## 15. Red Team: Kendi Fikrimize Karşı

| Soru | Dürüst cevap | Revizyon |
|---|---|---|
| Mevcut bir ürünün kopyası mı? | "Pre-trade firewall" kavramı bakımından kısmen evet | Anlatıyı "firewall" üzerine kurmayacağız. **"Mutabakat ve sağlama"** üzerine kuracağız. Makbuz ana çıktı |
| Kullanıcı bu probleme gerçekten sahip mi? | K1 ATK'nin kendi kayıtlarında var. K3 mekanizması kesin. Sıklığa dair kullanıcı anketi verimiz yok | Hackathon'da 5 trader'la 10 dakikalık görüşme yapıp sağlık kartını mevcut hesaplarında (salt-okuma) çalıştırmayı teklif edin. Bulguları ve yüzdeleri slayta koyun |
| Kural tabanlı sistem yeterli mi? | Hesaplar için evet, ve öyle tasarladık | LLM'in kattığı değeri demoda somut gösterin: "500U" sorusu, plan sentezi |
| ATK gösteriş için mi? | Hayır. 9 adımın 8'i ATK çağrısı | — |
| 24 saatte biter mi? | P0 dar tutulursa evet. En riskli kısım R5 (takvim) | R5'in yeniden oynatma modu P0. Gerçek takvim bonus |
| Demoda en olası başarısızlık? | (1) Takvim ucu demoda auth hatası. (2) Algo emir parametre hatası (`posSide`/`tdMode` kombinasyonu). (3) Ağ | (1) live read-only profil veya yeniden oynatma. (2) İlk 4 saatte demo'da gerçek çağrıyla test, `account_get_config` ile mod tespiti. (3) Fixture'dan oynatma |
| Sonuçlar nasıl doğrulanıyor? | Mutabakatla: borsadan geri okuma ve ATK audit log | — |
| Neden tekrar kullanılsın? | Her emirde ve açılış taramasında çalışıyor | P1'deki periyodik koruma taraması ve MCP modu tekrar kullanımın asıl motoru |
| En zayıf varsayım? | Kullanıcıların ek doğrulama adımına tahammül etmesi | "Sessiz geçiş" varsayılan. Yalnızca bulgu varsa araya girer |
| Rakip ekip aynısını yaparsa farkımız? | OKX semantiğine ve ATK'nin gerçek tuzaklarına (isim tutarsızlıkları, `tgtCcy`, `closeFraction`, demo/TR sınırları) dair derin bilgi ve test seti | Fixture'ları gerçek ATK yanıtlarından üretin. Sunumda "ATK'de bulduğumuz 3 tuzak" slaytı olsun |

**Revizyon sonrası karar:** Fikir ayakta kalıyor. Ana revizyon anlatıda: "firewall" yerine **"sağlama ve mutabakat"**. Kapsam USDT perpetual ile sınırlı. R5 yeniden oynatma moduyla P0'a güvenceli olarak alındı.

---

## 16. İlk 60 Dakikada Yapılacak Somut İşler

1. **(0–10 dk, herkes):** Etkinlik sayfasından jüri kriterlerini ve izin verilen enstrümanları teyit edin. Hangi OKX sitesinde hesabınız olduğunu belirleyin (Global/TR).
2. **(0–15 dk, K1):** Kurulum:
   ```bash
   npm install -g @okx_ai/okx-trade-mcp @okx_ai/okx-trade-cli
   ```
   ```bash
   okx config init
   ```
   Demo anahtarı OKX → Trading → Demo Trading → API Management yolundan alınır. `default_profile = "demo"`.
3. **(15–25 dk, K1):** Duman testi:
   ```bash
   okx --profile demo market instruments --instType SWAP --instId BTC-USDT-SWAP
   ```
   ```bash
   okx --profile demo account positions
   ```
   Ardından demo'da küçük bir emir verin, iptal edin, `swap get` ile geri okuyun. *(CLI sözdizimini `okx --help` ile doğrulayın; global bayrak sırası farklı olabilir.)*
4. **(15–30 dk, K2):** Bir MCP istemci betiğiyle `tools/list` alıp JSON'a kaydedin. `trade_get_history`, `swap_place_algo_order`, `news_get_economic_calendar` isimlerini doğrulayın ve `toolmap.ts`'i buna göre yazın.
5. **(25–40 dk, K1):** `news_get_economic_calendar`'ı **demo profille** deneyin. Hata verirse ayrı bir Read-only canlı anahtar ve `--read-only` profille deneyin. Sonucu not edin; R5 stratejisi buna göre belirlenecek.
6. **(30–45 dk, K2):** `swap_place_algo_order` ile demo pozisyonunda `closeFraction="1"`, `reduceOnly=true` ve `cxlOnClosePos=true` ile bir SL kurun, `swap_get_algo_orders` ile geri okuyun. Bu, mutabakatın temelidir.
7. **(0–45 dk, K3):** Vite + Fastify iskeleti, SSE ile sahte çağrı şeridi. 4 dakikalık demo storyboard'u.
8. **(45–60 dk, herkes):** Go/no-go: 3, 5 ve 6. adımlar çalıştıysa plan aynen devam eder. 5 başarısızsa R5 yeniden oynatma moduyla P0. 6 başarısızsa koruma düzeltmesi yalnızca ekli TP/SL ile yapılır.

---

## Kaynaklar

**ATK (birincil):**
- Repo: https://github.com/okx/agent-trade-kit
- README, modüller: https://github.com/okx/agent-trade-kit/blob/master/README.md
- Modül kaydı (167 araç, okuma/yazma ayrımı): https://github.com/okx/agent-trade-kit/blob/master/docs/module-registry.md
- Yapılandırma, demo, site: https://github.com/okx/agent-trade-kit/blob/master/docs/configuration.md
- Site uyumluluğu (TR test edilmedi): https://github.com/okx/agent-trade-kit/blob/master/docs/site-compatibility.md
- CHANGELOG (#113, #114, #128, kaldıraç %9,7, v1.4.8): https://github.com/okx/agent-trade-kit/blob/master/CHANGELOG.md
- Audit log aracı (kod): https://github.com/okx/agent-trade-kit/blob/master/packages/core/src/tools/audit.ts
- MCP sunucusu güvenlik talimatı (kod): https://github.com/okx/agent-trade-kit/blob/master/packages/mcp/src/server.ts
- Algo emir parametreleri (kod): https://github.com/okx/agent-trade-kit/blob/master/packages/core/src/tools/algo-trade.ts
- Issue #23 (verify modülü önerisi, kapsam dışı): https://github.com/okx/agent-trade-kit/issues/23
- OKX lansman duyurusu: https://x.com/okx/status/2031765978531365092
- OKX.AI Trading Hackathon (ATK kolu: yalnızca USDT perpetual): https://www.okx.ai/hackathon

**Problem ve rakip araştırması:**
- 10 Ekim 2025 likidasyonları: https://www.kucoin.com/news/flash/crypto-market-sees-19-15b-liquidation-event-on-october-10-2025 · https://www.21shares.com/it/insights/record-crypto-liquidations-amid-tariff-shock
- CPI öncesi likidasyon: https://cointelegraph.com/news/crypto-liquidation-190m-ahead-cpi-data
- Olay riski eğitimi: https://blofin.com/academy/education/trading/event-risk-in-crypto
- TP/SL pozisyon büyütmede güncellenmiyor: https://pluang.com/en/faq/crypto-futures/crypto-futures-product-feature/tp-sl-saat-menambah-jumlah-posisi-pada-futures · https://forum.ninjatrader.com/forum/ninjatrader-8/platform-technical-support-aa/1316168-re-calculate-stop-loss-after-adding-to-position?p=1316184
- AgentRisk: https://pypi.org/project/agentrisk/
- riskstate-mcp: https://enterprisedna.co/directories/mcp/likidodefi-riskstate-mcp/
- NinjaTrader MCP pre-trade risk: https://docs.ninjatrader.com/mcp/pre-trade-risk
- Lobstar Wilde olayı (çelişkili anlatımlar): https://www.streetinsider.com/PRNewswire/Claw+Wallet+Launches+to+Shield+On-Chain+Assets+for+AI+Agents/26261415.html
- Kopya işlem / MDD: https://www.kucoin.com/blog/in-what-is-copy-trading
- Team1 Türkiye etkinlikleri: https://luma.com/9sq1yhh8 · https://allai.events/event/team1-autonomy-workshop---bursa-turkiye
