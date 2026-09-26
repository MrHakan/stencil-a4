# Stencil Maker

Türkçe, tarayıcıda çalışan ve gerçek ölçekte çıktı hazırlayan stencil tasarım aracı. Metni stencil fontuyla düzenler, çalışma alanını A4 sayfalara böler, sayfaları A1/A2/B1 biçiminde kodlar ve birleştirme kılavuzları üretir.

## Özellikler

- Tasarımın genişlik ve yüksekliğini mm, cm veya inç olarak belirleme
- Tek satır ve çok satırlı metin düzeni
- Stencil font seçimi, bilgisayardaki USAAF Stencil'i algılama ve TTF/OTF/WOFF font yükleme
- Sayfa başına güvenli kenar payı ve komşu sayfalar arasında bindirme ayarı
- A4 dikey/yatay yönü, tek A4 veya otomatik döşeme
- A1, A2, B1 gibi sayfa etiketleri; kesim alanı, hizalama işaretleri ve 100 mm kontrol çizgisi
- Dolu stencil ve içi boş kontur önizlemesi
- Gerçek ölçekte SVG indirme ve tarayıcıdan yazdırma / PDF kaydetme
- Bindirme şeritleri ve komşu sayfa kodları (← A1, A3 →) her sayfada işaretlenir
- İsteğe bağlı birleştirme haritası sayfası: tüm yerleşim ve sayfa kodları tek A4'te
- Yazı, gerçek harf çizimine (mürekkep sınırına) göre tasarım alanına sığdırılır; harf yüksekliği özet şeridinde görünür
- SVG dışa aktarımında Stardos Stencil veya yüklenen font dosyanın içine gömülür
- Taslak ve yüklenen font bu tarayıcıda saklanır

## Çalıştırma

`index.html` dosyasını tarayıcıda aç; kurulum veya derleme gerekmez.

### GitHub Pages

`main` dalına her push'ta `.github/workflows/pages.yml` önce testleri çalıştırır, geçerse yalnızca site dosyalarını (`index.html`, `css/`, `js/`, `assets/`) yayınlar. İlk kurulumda bir kez depoda **Settings → Pages → Build and deployment → Source: GitHub Actions** seç. Site adresi: `https://<kullanıcı>.github.io/stencil-a4/`. Yayını elle tetiklemek için **Actions → Deploy to GitHub Pages → Run workflow** kullanılabilir.

## Proje yapısı

```
index.html        Arayüz iskeleti
css/app.css       Stiller ve baskı kuralları
js/fonts.js       Gömülü Stardos Stencil (base64, çevrimdışı çalışma ve SVG gömme için)
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
npm run test:e2e    # tarayıcıda uçtan uca testler
```

GitHub Actions her push ve pull request'te iki test takımını da çalıştırır.

## Gerçek ölçekte yazdırma

Yazdırma penceresinde A4 kağıt, kenar boşluğu **Yok**, ölçek **%100 / Gerçek boyut** seçilmeli; tarayıcı üstbilgi ve altbilgileri kapatılmalı. Yazıcı donanımı fiziksel kâğıt kenarlarına kadar baskı yapamayabilir; güvenli kenar payı bu sınırı dikkate almak içindir. İlk sayfadaki 100 mm kontrol çizgisini cetvelle ölçerek çıktıyı doğrula.

Sayfa bindirmesi komşu A4’lerde aynı tasarım bölümünün ortak kalan kısmıdır ve sayfa görünümünde açık kırmızı şeritle gösterilir. Baskıları bu şeritleri üst üste getirerek hizala; kenardaki oklar (ör. `→ A2`) hangi sayfanın komşu olduğunu gösterir. Güvenli kenar payı, A4 başına tasarıma ayrılan kullanılabilir alanı azaltır; uygulama sayfa sayısını bu alana göre hesaplar.

## Fontlar

Uygulamayla birlikte gelen **Stardos Stencil**, SIL Open Font License 1.1 altında Google Fonts deposundan alınmıştır. Lisans metni `assets/OFL.txt` içindedir.

**USAAF Stencil** seçeneği, font bilgisayarda yüklüyse onu kullanır. Yüklü değilse arayüzden font dosyasını seçebilirsin. USAAF Stencil'i üçüncü taraf yazılımında kullanmadan önce fontun kendi lisansını kontrol et; DaFont kaydı kişisel kullanım olarak listelenmiştir: https://www.dafont.com/usaaf-stencil.font . Bu nedenle USAAF font dosyası depoya dahil edilmemiştir.

## Not

Köprüler harfin seçilen stencil fontundaki çizimine aittir. Yüklenen fontun gerçekten stencil olduğundan emin ol. Kontur görünümü görsel bir baskı seçeneğidir; asıl stencil kesimi için fontun köprülü, dolu stencil harfleri tercih edilir.
