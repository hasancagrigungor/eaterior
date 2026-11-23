# Eatery Plan

**Restoran, kafe ve bar kat planları için açık bir JSON formatı.** Masalar, bölgeler, duvarlar, kapılar,
mobilyalar, iklimlendirme cihazları ve sensörler tek bir dosyada tutulur. Aynı plan web, iOS, Android ve
masaüstünde birebir aynı çizilir; kâğıda çizilmiş bir plandan veya fotoğraftan da üretilebilir.

[English](README.md)

## Temel fikir

- **Tek plan, her ekran.** Koordinatlar ekrandan bağımsız birimlerde tutulur: başlangıç sol üst, x sağa, y aşağı.
  İstemci planı ekrana sığdırır, gerçek mekânın en-boy oranı korunur.
- **Sadece fiziksel yerleşim.** Siparişler, rezervasyonlar, canlı masa durumu ve sensör ölçümleri mevcut
  sistemlerinizde kalır ve id üzerinden bağlanır.
- **Resimden üretilebilir.** Piksel koordinatlı bir ara format (`detection.schema.json`) ve kesin kurallarla çalışan
  bir dönüştürücü, herhangi bir çizimi doğrulanmış bir plana çevirir. Emin olunamayan nesneler `needsReview` ile
  işaretlenir.
- **Sıkı doğrulama.** Yapı JSON Schema ile, referanslar ve geometri Python doğrulayıcı ile kontrol edilir.
- **Görünüm veri, çizim kod.** İsteğe bağlı `appearance` alanları (zemin, malzeme, renk, sandalye tipi) sayesinde
  aynı plan sade bir plan ya da renkli bir illüstrasyon olarak çizilir; hiçbir resim dosyası kullanılmaz.
- **Genişletilebilir.** Her nesnede uygulamaya özel veriler için `extensions` alanı vardır.

## Kullanım

```bash
pip install -e python
eateryplan validate examples/plan.json
eateryplan import examples/detection.json plan.json --image cizim.png --name "Kafem"
```

```js
import { toSvg } from "./js/src/eateryplan-render.mjs";
import { buildIllustratedScene } from "./js/src/eateryplan-illustrated.mjs";
element.innerHTML = toSvg(buildIllustratedScene(plan, { tableStates }));
```

![Garden Bistro](docs/images/restaurant-illustrated.png)

React Native için örnek bileşen: `examples/react-native/EateryPlanView.tsx`.

## Belgeler

- [Spesifikasyon](docs/specification.md)
- [Çizim kuralları](docs/rendering.md)
- [Resimden plana dönüştürme](docs/image-import.md)

Belgeler İngilizcedir; format alan adları dilden bağımsızdır.

## Lisans

[MIT](LICENSE)
