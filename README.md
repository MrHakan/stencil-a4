# Stencil Maker

Türkçe, tarayıcıda çalışan ve gerçek ölçekte çıktı hazırlayan stencil tasarım aracı. Metni stencil fontuyla düzenler, çalışma alanını A4 sayfalara böler, sayfaları A1/A2/B1 biçiminde kodlar ve birleştirme kılavuzları üretir.

## Özellikler

- Tasarımın genişlik ve yüksekliğini mm, cm veya inç olarak belirleme
- Tek satır ve çok satırlı metin düzeni
- 6 gömülü açık lisanslı stencil font, bilgisayardaki USAAF Stencil'i algılama ve TTF/OTF/WOFF font yükleme
- Sayfa başına güvenli kenar payı ve komşu sayfalar arasında bindirme ayarı
- A4 dikey/yatay yönü, tek A4 veya otomatik döşeme
- A1, A2, B1 gibi sayfa etiketleri; kesim alanı, hizalama işaretleri ve 100 mm kontrol çizgisi
- Dolu stencil ve içi boş kontur önizlemesi
- Gerçek ölçekte SVG indirme ve tarayıcıdan yazdırma / PDF kaydetme
- Kes-bindir kılavuzları: kırmızı ✂ kesim çizgisi, komşu sayfada mavi hizalama çizgisi ve bindirme şeridinde eşleşen hedef işaretleri
- İsteğe bağlı birleştirme haritası sayfası: tüm yerleşim ve sayfa kodları tek A4'te
- Yazı, taşan harf kenarları ve negatif harf aralığı dahil gerçek mürekkep sınırına göre tasarım alanına sığdırılır; harf yüksekliği özet şeridinde görünür
- SVG dışa aktarımında seçilen gömülü veya yüklenen font dosyanın içine gömülür
- Taslak ve yüklenen font bu tarayıcıda saklanır
- Önceki/sonraki A4 düğmeleriyle döşenen sayfalar arasında gezinme
- Boş metin ve geçersiz yazı alanında baskı/SVG engeli; uyarılar canlı önizlemenin yanında görünür
- Kesirli ölçüler ve mm/cm/inç geçişlerinde hassas ölçü gösterimi

## Çalıştırma

`index.html` dosyasını tarayıcıda aç; kurulum veya derleme gerekmez.

### GitHub Pages

`main` dalına her push'ta `.github/workflows/pages.yml` önce testleri çalıştırır, geçerse yalnızca site dosyalarını (`index.html`, `css/`, `js/`, `assets/`) yayınlar. İlk kurulumda bir kez depoda **Settings → Pages → Build and deployment → Source: GitHub Actions** seç. Site adresi: `https://<kullanıcı>.github.io/stencil-a4/`. Yayını elle tetiklemek için **Actions → Deploy to GitHub Pages → Run workflow** kullanılabilir.

## Proje yapısı

```
index.html        Arayüz iskeleti
css/app.css       Stiller ve baskı kuralları
js/font-registry.js  Gömülü fontların kayıt noktası
fonts/*.js        Gömülü OFL stencil fontları (base64 WOFF2, tools/build-fonts.py üretir)
tools/            Font üretim betiği
js/core.js        DOM'suz yerleşim/döşeme hesapları (tarayıcı + Node)
js/app.js         Arayüz, SVG üretimi, baskı ve dışa aktarma
tests/            Birim (node:test) ve tarayıcı (Playwright) testleri
```

Derleme adımı yoktur; dosyalar doğrudan `file://` üzerinden de çalışır.

## Testler

```
npm install
npx playwright install chromium   # ilk seferde
npm test            # yerleşim ve döşeme birim testleri
npm run test:e2e    # yerel HTTP sunucusunda tarayıcı uçtan uca testleri
```

GitHub Actions her push ve pull request'te iki test takımını da çalıştırır.
Sistemde Chromium zaten kuruluysa `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` kullanılabilir.

## Gerçek ölçekte yazdırma

Yazdırma penceresinde A4 kağıt, kenar boşluğu **Yok**, ölçek **%100 / Gerçek boyut** seçilmeli; tarayıcı üstbilgi ve altbilgileri kapatılmalı. Yazıcı donanımı fiziksel kâğıt kenarlarına kadar baskı yapamayabilir; güvenli kenar payı bu sınırı dikkate almak içindir. İlk sayfadaki 100 mm kontrol çizgisini cetvelle ölçerek çıktıyı doğrula.

### Sayfaları birleştirme

Her sayfa, solundaki ve üstündeki komşunun **üzerine** bindirilir:

1. Sol/üst kenardaki **kırmızı ✂ çizgiyi** cetvelle kes. Dışında kalan gri şerit atılır. Çizgi kâğıdın bir ucundan öbür ucuna uzanır.
2. Kesilen kenarı, komşu sayfadaki **mavi hizalama çizgisine** oturt. Mavi çizgi o kenarın tam olarak nereye geleceğini gösterir; üzerindeki etiket hangi sayfanın geleceğini yazar (ör. `A2 kesim kenarı bu çizgiye`).
3. Bindirme şeridinde her iki sayfada da aynı yerde basılan **hedef işaretlerini** ve harf çizgilerini üst üste getir, sonra bantla veya yapıştır.
4. Önce her satırı soldan sağa (A1 → A2 → …), sonra satırları üstten alta birleştir.

Baskının başındaki **birleştirme haritası** sayfası tüm düzeni, sayfa kodlarını ve bu adımları gösterir (varsayılan olarak açık). Varsayılan bindirme 15 mm’dir (10–20 mm önerilir); hedef işaretleri 4 mm ve üzeri bindirmede çizilir.

## Fontlar

Uygulamada 6 stencil font gömülü gelir. Hepsi **SIL Open Font License 1.1** ile lisanslıdır (Google Fonts), bu yüzden siteye gömülüp dağıtılabilir. Lisans metinleri `assets/licenses/` içindedir.

| Font | Tarz | Türkçe (Ğ Ş İ) | Kalın |
|---|---|---|---|
| Black Ops One | Askeri stencil, USAAF'a en yakın | ✓ | – |
| Big Shoulders Stencil | Dar gotik/grotesk stencil | ✓ | ✓ |
| Saira Stencil One | Geniş, modern | ✓ | – |
| Stick No Bills | Sokak/afiş | ✓ | ✓ |
| Emblema One | Kalın, dekoratif | ✓ | – |
| Stardos Stencil | Klasik serifli | ✗ | ✓ |

Seçilen fontta bulunmayan bir harf yazılırsa uygulama uyarır.

Fontlar `tools/build-fonts.py` ile üretilir. Betik fontları Google Fonts deposundan indirir, Latin + Latin Genişletilmiş alt kümesine indirir, değişken fontları sabit kalınlıklara çevirir ve base64 WOFF2 olarak `fonts/*.js` dosyalarına yazar. Böylece site `file://` üzerinden de çalışır ve SVG dışa aktarımı fontu içinde taşır.

```
pip install fonttools brotli
python3 tools/build-fonts.py
```

**USAAF Stencil** ve **Stencil Gothic** (Brain Eaters) DaFont'ta "Free for personal use" lisanslıdır. Herkese açık bir siteye gömmek yeniden dağıtım sayılacağından depoya eklenmemiştir. Bu fontları kullanmak için:

- Font bilgisayarda yüklüyse **USAAF Stencil** seçeneği onu otomatik algılar.
- Yüklü değilse **Font yükle** ile TTF/OTF/WOFF dosyasını seç. Dosya yalnızca bu tarayıcıda saklanır, sunucuya gönderilmez.

USAAF bulunamazsa yerine Black Ops One kullanılır. İndirme: https://www.dafont.com/usaaf-stencil.font

## Not

Köprüler harfin seçilen stencil fontundaki çizimine aittir. Yüklenen fontun gerçekten stencil olduğundan emin ol. Kontur görünümü görsel bir baskı seçeneğidir; asıl stencil kesimi için fontun köprülü, dolu stencil harfleri tercih edilir.
