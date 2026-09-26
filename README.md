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
- Taslak ve yüklenen font bu tarayıcıda saklanır

## Çalıştırma

`index.html` dosyasını tarayıcıda aç. GitHub Pages kullanmak için depoda **Settings → Pages → Deploy from a branch → main / root** seç.

## Gerçek ölçekte yazdırma

Yazdırma penceresinde A4 kağıt, kenar boşluğu **Yok**, ölçek **%100 / Gerçek boyut** seçilmeli; tarayıcı üstbilgi ve altbilgileri kapatılmalı. Yazıcı donanımı fiziksel kâğıt kenarlarına kadar baskı yapamayabilir; güvenli kenar payı bu sınırı dikkate almak içindir. İlk sayfadaki 100 mm kontrol çizgisini cetvelle ölçerek çıktıyı doğrula.

Sayfa bindirmesi komşu A4’lerde aynı tasarım bölümünün ortak kalan kısmıdır. Baskıları bu ortak alanı kullanarak hizala ve kılavuzlardan kes. Güvenli kenar payı, A4 başına tasarıma ayrılan kullanılabilir alanı azaltır; uygulama sayfa sayısını bu alana göre hesaplar.

## Fontlar

Uygulamayla birlikte gelen **Stardos Stencil**, SIL Open Font License 1.1 altında Google Fonts deposundan alınmıştır. Lisans metni `assets/OFL.txt` içindedir.

**USAAF Stencil** seçeneği, font bilgisayarda yüklüyse onu kullanır. Yüklü değilse arayüzden font dosyasını seçebilirsin. USAAF Stencil'i üçüncü taraf yazılımında kullanmadan önce fontun kendi lisansını kontrol et; DaFont kaydı kişisel kullanım olarak listelenmiştir: https://www.dafont.com/usaaf-stencil.font . Bu nedenle USAAF font dosyası depoya dahil edilmemiştir.

## Not

Köprüler harfin seçilen stencil fontundaki çizimine aittir. Yüklenen fontun gerçekten stencil olduğundan emin ol. Kontur görünümü görsel bir baskı seçeneğidir; asıl stencil kesimi için fontun köprülü, dolu stencil harfleri tercih edilir.
