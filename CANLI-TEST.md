# EHLİYET · Canlı test, adım adım

Hiçbir şey bilmediğini varsayıyoruz. Her adımı sırayla yap. Kutunun içindeki yazıyı **kopyala**, Terminal'e **yapıştır**, **Enter**'a bas.

---

## 1. Terminal'i aç

1. Klavyede **Cmd + Boşluk**'a bas.
2. `Terminal` yaz, **Enter**'a bas.
3. Siyah ya da beyaz bir pencere açılır. Bütün komutları buraya yazacağız.

## 2. Proje klasörüne gir

```bash
cd ~/Desktop/ehliyet/ehliyet
```

Hata yazmadıysa doğru yerdesin.

## 3. Kurulum (yalnızca ilk sefer)

```bash
npm install
```

1-2 dakika sürebilir. Bitince yeni satır gelir.

> `command not found: npm` yazarsa: https://nodejs.org adresinden **LTS** sürümünü indir, kur, Terminal'i kapatıp aç, 2. adımdan başla.

## 4. Her şey çalışıyor mu?

```bash
npm test
```

En altta **“Kurulum doğru çalışıyor.”** yazmalı. Yazıyorsa devam.

## 5. Siteyi aç

```bash
npm start
```

Terminal'de **“EHLİYET Denetçi hazır”** yazar. Bu pencereyi **kapatma**; site bu pencere açıkken çalışır.

Tarayıcıda (Chrome, Safari) şu adresi aç: **http://localhost:4747**

## 6. İlk sınavı izle (yaklaşık 36 saniye)

1. Sağ üstteki beyaz **“Sınav aç”** düğmesine bas.
2. **“Prova · naif”** kutusuna bas.
3. İzle: soldaki 12 sınav tek tek ilerler, sağda ajanın her hareketi akar. Kırmızı **KAZA**'lar çıkar.
4. Bitince üstte iki kart görürsün: **Ehliyet yok** ve **Poliçe reddedildi**.

## 7. Ehliyet ve poliçe alan ajan

1. Sol üstteki sarı **EHLİYET** yazısına bas (ana sayfaya döner).
2. **“Ajanı sınava sok”** → **“Prova · orta”**.
3. 36 saniye bekle. Sonuç: **A sınıfı** ehliyet, **poliçe düzenlendi**.

## 8. Tazminatı canlı gör

1. Aynı sayfada **“Sigorta”** sekmesine bas.
2. **“Poliçe dönemini simüle et”** düğmesine bas.
3. Ajan yeniden sınava girer. **7. sınavda** (Çift emir) yeşil **“Tazminat ödendi $30”** kutusu çıkar.
4. Üstteki **“Sigorta”** menüsünde havuzdan çıkan 30 $'ı görebilirsin.

Buraya kadar her şey internetsiz de çalışır. Şimdi ehliyetleri Avalanche'a yazalım.

---

## 9. Avalanche'ı aç (bir kez, yaklaşık 10 dakika)

### 9.1 Siteyi durdur

Terminal penceresine tıkla, **Ctrl + C**'ye bas. (Site kapanır, sorun değil.)

### 9.2 Cüzdan oluştur

```bash
npm run avalanche:setup
```

Ekranda şuna benzer bir satır çıkar:

```
Adres: 0x84De789893E43A17abeD55867576b21c088ed1Ee
```

Bu **senin test cüzdanının adresi**. Fareyle seç, **Cmd + C** ile kopyala.
(Cüzdanın gizli anahtarı `.env` dosyasına yazıldı. O dosyayı kimseye gönderme.)

### 9.3 Cüzdana test AVAX al (ücretsiz, parasal değeri yok)

1. Tarayıcıda aç: **https://build.avax.network/console/primary-network/faucet**
2. Giriş yap (sayfa ne istiyorsa: GitHub, Google ya da e-posta).
3. **C-Chain**'i seç.
4. Kopyaladığın adresi yapıştır, test AVAX iste.

Takılırsan:
- Sayfa yalnızca kendi cüzdanına (Core ya da MetaMask) gönderiyorsa: önce oraya al, sonra o cüzdandan 9.2'deki adrese **0,1 AVAX** gönder.
- Sayfa izin vermiyorsa: Avalanche'ın Discord sunucusunda test AVAX iste.

### 9.4 Sözleşmeyi kur

1-2 dakika bekle, sonra aynı komutu tekrar çalıştır:

```bash
npm run avalanche:setup
```

Ekranın en altında **“HAZIR.”** yazmalı. Hâlâ “test AVAX yok” diyorsa biraz daha bekleyip tekrar çalıştır.

### 9.5 Siteyi yeniden aç

```bash
npm start
```

Terminal'de şu satırı görmelisin:

```
Avalanche:    Avalanche Fuji (test ağı) · sözleşme 0x… · cüzdan 0x… · … AVAX
```

Daha önce verilen ehliyetler de birkaç saniye içinde zincire yazılır.

### 9.6 Sitede kontrol et

1. **http://localhost:4747** sayfasını yenile.
2. Sağ üstte kırmızı Avalanche işareti ve **“Fuji”** yazar.
3. Ana sayfadaki kırmızı şeritte **“Ehliyetler Avalanche'ta kayıtlı”** yazar.
4. Herhangi bir ajana tıkla → **“Ehliyet”** sekmesi → **“Avalanche kaydı · Kayıtlı”**.
5. **“Zincirde doğrula”**'ya bas → yeşil **“Zincirdeki kayıt bu ehliyetle birebir aynı”** yazısı.
6. **“Snowtrace'te aç”**'a bas → işlem Avalanche'ın herkese açık gezgininde görünür.
7. Yeni bir sınav başlat: bitince birkaç saniye içinde **“Ehliyet Avalanche'a yazıldı”** bildirimi çıkar.

Durumu Terminal'den görmek için (siteyi kapatmadan yeni bir Terminal penceresi açıp önce 2. adımı yap):

```bash
npm run avalanche:status
```

---

## 10. (İsteğe bağlı) Gerçek yapay zekâ ajanı: Claude

1. Siteyi durdur (**Ctrl + C**).
2. Ayar dosyasını aç (9. adımı yapmadıysan önce `cp .env.example .env` yaz):
   ```bash
   open -e .env
   ```
3. `ANTHROPIC_API_KEY=` satırını bul, eşittirin hemen arkasına Claude API anahtarını yapıştır. **Cmd + S** ile kaydet, pencereyi kapat.
4. `npm start`
5. “Sınav aç” sayfasında artık **“Acemi ajan”** ve **“Eğitimli ajan”** var. Gerçek sınav birkaç dakika sürebilir.

## 11. Sunum yedeği (internet giderse)

```bash
npm run export -- --out ../indir/ehliyet-site.html
```

Masaüstü → `ehliyet` → `indir` → **ehliyet-site.html**'e çift tıkla. Sunucusuz açılır; Avalanche kayıtları ve doğrulamalar içindedir.

---

## Sorun çıkarsa

| Ekranda ne yazıyor | Ne yap |
|---|---|
| `Port 4747 kullanımda` | Site zaten açık. Ya eski Terminal penceresinde **Ctrl + C** yap ya da `EHLIYET_PORT=4748 npm start` yazıp **http://localhost:4748** aç. |
| `command not found: npm` | Node.js kur (3. adımdaki not). |
| `Cüzdanda yeterli AVAX yok` | 9.3'ü yap. |
| `Avalanche RPC'ye ulaşılamadı` | İnternetini kontrol et, komutu tekrar çalıştır. |
| Tarayıcıda “bu siteye ulaşılamıyor” | Terminal'de `npm start` çalışıyor mu? Pencere açık mı? |
| Ehliyet sekmesinde “Avalanche kaydı yapılamadı” | **“Yeniden dene”** düğmesine bas. |

## Jüriye ne denir (kısa)

- “Ehliyet ajanı güvenli kılmaz. **Belirli bir ayar ve sınav koşulunda davranışını değerlendirir ve kısıtlı bir çalıştırma ayarı önerir.**”
- “200 $ tavanı **yalnızca bizim geçidimizden geçen emirlere** uygulanır. Ajanın başka bir yoldan borsaya erişimi varsa onu sınırlamayız.”
- “Varsayılan modda fiyatlar OKX'ten gerçek, **emirler sahte defterde**; OKX'e emir gitmez. OKX demo hesabı modunda emirler OKX'in sanal para hesabına gider. Hiçbir modda gerçek para yok.”
- “Her ehliyetin özeti **Avalanche'a yazılır**; değiştirilemez, silinemez. İsterseniz şimdi Snowtrace'te açalım.”
- “Poliçe ve havuz **simüle**; gerçek olan hasarı tespit eden mekanizma ve fiyatı üreten ölçüm.”
