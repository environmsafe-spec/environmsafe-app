# WhatsApp Business — profile and catalog

Everything below is ready to paste into the **WhatsApp Business** app. Images are
in `public/img/catalog/` (also served at `https://www.environmsafe.com/img/catalog/`
once the site is deployed).

Fields with tight character limits (About, Description, item and collection
names) are in Arabic only. Messages and catalog item descriptions have room for
both languages, so they stay bilingual for international clients.

Prices are deliberately left blank: a catalog item with no price shows no price,
and customers tap **Message business** to ask for a quote.

---

## 1. Business profile

In the app: **Settings → Business tools → Business profile**.

| Field | Value |
|---|---|
| Profile photo | `public/img/catalog/profile-photo.png` (padded so the circle crop doesn't cut the logo) |
| Business name | `EnvironmSafe` |
| Category | `Professional Services` (add `Education` as a second category for the training courses, if offered) |
| Address | `المنصورة، عدن، اليمن (VX8C+7C)` — then drop the map pin on the office |
| Business hours | Saturday–Thursday, 8:00 AM – 5:00 PM; Friday closed |
| Email | `support@environmsafe.com` |
| Website 1 | `https://www.environmsafe.com/ar/` |
| Website 2 | `https://www.environmsafe.com` |

### About (max 139 characters — 107)

```
السلامة والحماية من الحرائق، الغاز LPG، اختبار صمامات PSV، ودورات NEBOSH وIOSH في عدن. راسلنا لطلب عرض سعر.
```

### Description (max 512 characters — 383)

```
انفيرومسيف للهندسة والتجارة والخدمات – عدن. خدمات الصحة والسلامة والبيئة والهندسة للمنشآت في اليمن والمنطقة:
• اختبار ومعايرة صمامات الأمان PSV على المقعد المعتمد الوحيد في المنطقة (API 527 / API 576)
• الحماية من الحرائق وأنظمة إدارة السلامة
• تصميم وتركيب وفحص أنظمة الغاز LPG
• تقييم سلامة المراجل والأنظمة الكهربائية
• دورات NEBOSH وIOSH بالعربية والإنجليزية
راسلنا لطلب عرض سعر.
```

---

## 2. Messaging tools

In the app: **Business tools → Greeting message / Away message / Quick replies**.

### Greeting message (send to new customers)

```
أهلاً بكم في انفيرومسيف 👋
أخبرونا بالخدمة المطلوبة ونبذة عن موقعكم، وسنرسل لكم عرض سعر. تصفحوا خدماتنا في الكتالوج: https://wa.me/c/967783402932

Welcome to EnvironmSafe 👋
Tell us which service you need and a little about your site, and we'll send you a quote. Browse our services: https://wa.me/c/967783402932
```

### Away message (outside business hours)

Set **Send** to *Outside of business hours*.

```
شكراً لتواصلكم مع انفيرومسيف. نحن خارج ساعات العمل حالياً (السبت – الخميس، 8 صباحاً – 5 مساءً) وسنرد عليكم في يوم العمل التالي.

Thanks for contacting EnvironmSafe. We're out of the office right now (Sat–Thu, 8 AM – 5 PM) and will reply on the next working day.
```

### Quick reply `/quote`

```
لإعداد عرض السعر، يرجى إرسال:
1. الخدمة المطلوبة
2. موقع المنشأة
3. تفاصيل المعدات أو النظام (النوع، الحجم، العدد)
4. الموعد المفضل

To prepare your quote, please send:
1. Service needed
2. Site location
3. Equipment / system details (type, size, quantity)
4. Preferred date
```

### Quick reply `/contact`

```
📞 +967 78 340 2932 · +967 71 342 7082 · +967 77 303 3186
✉️ support@environmsafe.com
📍 المنصورة، عدن (VX8C+7C)
🕗 السبت – الخميس، 8 صباحاً – 5 مساءً
🌐 https://www.environmsafe.com/ar/
```

---

## 3. Catalog

The catalog is generated, not typed in. **`items.json` is the source of truth**:
fifteen categories (nine services, six supply categories), each with its sub-items. To change the catalog, edit that file and
run:

```
python3 scripts/build_whatsapp_catalog.py   # writes catalog.csv (both copies)
node scripts/render_catalog_images.cjs       # renders images for any new items
```

Every item is listed at **1 YER** (Meta requires a price), its title ends with
"السعر حسب الطلب", and its description opens and closes with a note that the
price is a placeholder and to get in touch for a quote.

### Collections — one per service

In the WhatsApp app: **Catalog → Add new collection**, name it after the service
and tick the service plus its sub-items (item codes start with the service code).
In Commerce Manager the same grouping is available as **Sets** filtered on
*Custom label 0* (Arabic service name) or *Product type* (English service name).

| Collection | Code prefix | Items |
|---|---|---|
| اختبار ومعايرة صمامات الأمان PSV | `ES-PSV` | 7 |
| السلامة والحماية من الحرائق | `ES-HSE` | 10 |
| أنظمة الغاز LPG | `ES-LPG` | 6 |
| تقييم سلامة الأنظمة | `ES-EVAL` | 6 |
| دورات NEBOSH وIOSH | `ES-TRN` | 12 |
| الفحص والمراقبة البيئية | `ES-INSP` | 8 |
| الهندسة والإنشاء | `ES-ENG` | 7 |
| أنظمة التكييف والتهوية HVAC | `ES-HVAC` | 7 |
| الصيانة وقطع الغيار | `ES-MNT` | 6 |
| معدات الحماية الشخصية | `ES-PPE` | 11 |
| حلول السلامة | `ES-SAF` | 9 |
| معدات الحماية من السقوط | `ES-FALL` | 7 |
| أجهزة كشف الغاز | `ES-GAS` | 7 |
| معدات الحماية من الحرائق | `ES-FIRE` | 9 |
| أنظمة الري | `ES-IRR` | 7 |

The first nine collections are services; the last six are supply categories
(modelled on REDA Safe's store sections, with EnvironmSafe's own wording and
images). 119 items in total.

---

## 4. Uploading to Meta

### Recommended: scheduled feed (Meta fetches the file daily)

The feed is published at **https://www.environmsafe.com/whatsapp-catalog.csv**.
Once Commerce Manager fetches it on a schedule, any change merged into the
website reaches the catalog within a day with no manual upload.

1. Commerce Manager → **EnvironmSafe Services** → **Catalog → Data sources**.
2. Open the existing data feed → **Settings** → **Replace / Add upload schedule**
   (wording varies) → URL `https://www.environmsafe.com/whatsapp-catalog.csv`,
   frequency **Daily**, currency **YER**.
   - Using the *existing* feed keeps the nine items already uploaded and adds
     the sub-items; item IDs match, so nothing is duplicated.
   - If the feed's settings offer no schedule, use **Upload** on the same feed
     with `catalog.csv` instead (same result, but manual each time).
3. **Request update now** to fetch it immediately, then check **Items** and
   **Issues**.

### Manual: upload once

Data sources → the existing feed → **Upload file** → `docs/whatsapp/catalog.csv`.
Do not create a second feed: two feeds with the same item IDs conflict.

