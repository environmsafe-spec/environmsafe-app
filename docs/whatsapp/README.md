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
أخبرونا بالخدمة المطلوبة ونبذة عن موقعكم، وسنرسل لكم عرض سعر. تصفحوا خدماتنا في الكتالوج أعلاه.

Welcome to EnvironmSafe 👋
Tell us which service you need and a little about your site, and we'll send you a quote. Browse our services in the catalog above.
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

In the app: **Business tools → Catalog → Add new item**. For each item: add the
image, the name, leave **Price** empty, paste the description, add the link, and
set the item code under **More fields**.

Then group them under **Catalog → ⋮ → Create collection**:

| Collection | Items |
|---|---|
| الفحص والاختبار | ES-PSV, ES-EVAL, ES-INSP |
| السلامة والتدريب | ES-HSE, ES-TRN |
| الهندسة والأنظمة | ES-LPG, ES-ENG, ES-HVAC, ES-MNT |

| Code | Name | Image | Link |
|---|---|---|---|
| ES-PSV | اختبار ومعايرة صمامات الأمان PSV | `psv.png` | `https://www.environmsafe.com/ar/services/psv.html` |
| ES-HSE | السلامة والحماية من الحرائق | `hse.png` | `https://www.environmsafe.com/ar/services/hse.html` |
| ES-LPG | أنظمة الغاز LPG | `lpg.png` | `https://www.environmsafe.com/ar/services/lpg-systems.html` |
| ES-EVAL | تقييم سلامة الأنظمة | `evaluation.png` | `https://www.environmsafe.com/ar/services/evaluation.html` |
| ES-TRN | دورات NEBOSH وIOSH | `training.png` | `https://www.environmsafe.com/ar/services/training.html` |
| ES-INSP | الفحص والمراقبة البيئية | `inspection.png` | `https://www.environmsafe.com/ar/services/inspection-monitoring.html` |
| ES-ENG | الهندسة والإنشاء | `engineering.png` | `https://www.environmsafe.com/ar/services/engineering-construction.html` |
| ES-HVAC | أنظمة التكييف والتهوية HVAC | `hvac.png` | `https://www.environmsafe.com/ar/services/hvac.html` |
| ES-MNT | الصيانة وقطع الغيار | `maintenance.png` | `https://www.environmsafe.com/ar/services/maintenance.html` |

### Descriptions

**ES-PSV**

```
المزود الوحيد في المنطقة بمقعد اختبار معتمد لصمامات الأمان. فحص واختبار والتحقق من ضغط الفتح ومعايرة وصيانة وإصلاح وفق API 527 وAPI 576، مع إصدار الشهادات.

The region's only certified PSV test bench. Inspection, testing, set-pressure verification, calibration, maintenance and repair of pressure safety valves to API 527 and API 576, with certification.

اطلب عرض سعر · Request a quote
```

**ES-HSE**

```
أنظمة إدارة السلامة، تقييم المخاطر، الاستجابة للطوارئ، التحقيق في الحوادث، الامتثال التنظيمي، والحماية الكاملة من الحرائق على يد مختصين معتمدين من NFPA. الامتثال الموثق قد يخفض أقساط التأمين حتى 85%.

Safety management systems, risk assessment, emergency response, incident investigation, regulatory compliance and complete fire protection by NFPA-certified specialists. Documented fire-protection compliance can cut insurance premiums by up to 85%.

اطلب عرض سعر · Request a quote
```

**ES-LPG**

```
تصميم وتركيب وفحص واعتماد أنظمة الغاز LPG وفق المعايير الدولية (NFPA): مسافات الفصل والتنفيس والتهوية والإغلاق الطارئ، للمنشآت الصناعية والتجارية.

Design, installation, inspection and certification of LPG systems to international (NFPA) standards: separation distances, pressure relief, ventilation and emergency shutdown, for industrial and commercial sites.

اطلب عرض سعر · Request a quote
```

**ES-EVAL**

```
تقييم معتمد لأنظمة الغاز LPG والمراجل والأنظمة الكهربائية وأنظمة الحماية من الحرائق وفق المعايير الدولية، مع تقرير فجوات مرتب حسب الخطورة.

Certified evaluation of LPG systems, boilers, electrical systems and fire protection against international standards, with a severity-ranked gap report you can act on.

اطلب عرض سعر · Request a quote
```

**ES-TRN**

```
تدريب سلامة معتمد بالعربية والإنجليزية: الشهادة الدولية العامة NEBOSH IGC، سلامة العمليات PSM، الدبلوم المستوى السادس، وبرامج IOSH للعمل والإدارة بأمان. دورات للأفراد ولمجموعات الشركات.

Accredited safety training in Arabic and English: NEBOSH International General Certificate, Process Safety Management, Level 6 Diploma, and IOSH Working Safely and Managing Safely. Courses for individuals and company groups.

اطلب عرض سعر · Request a quote
```

**ES-INSP**

```
فحص هيكلي ومراقبة بيئية مستمرة تكشف المشكلات مبكراً، وتحافظ على الامتثال التنظيمي، وتحمي أصول منشأتكم.

Structural inspection and continuous environmental monitoring that catch problems early, keep your facility compliant and protect your assets.

اطلب عرض سعر · Request a quote
```

**ES-ENG**

```
تصميم مدني وإدارة مشاريع وإشراف على التنفيذ من المفهوم حتى إغلاق المشروع، في الموعد وضمن الميزانية وبامتثال كامل.

Civil engineering design, project management and site oversight from concept to closeout — on time, on budget and fully compliant.

اطلب عرض سعر · Request a quote
```

**ES-HVAC**

```
تصميم وتركيب وصيانة أنظمة التكييف والتهوية للمنشآت التجارية والصناعية: كفاءة في استهلاك الطاقة، وجودة هواء داخلي، وراحة حرارية موثوقة.

Design, installation and maintenance of commercial and industrial HVAC systems: energy efficiency, indoor air quality and reliable thermal comfort.

اطلب عرض سعر · Request a quote
```

**ES-MNT**

```
برامج صيانة وقائية وإصلاح معدات وتوريد قطع الغيار الصناعية وتجهيزات السلامة، مع تطبيق أنظمة CMMS، للحفاظ على استمرارية عملياتكم وتقليل التوقف غير المخطط له.

Preventive maintenance programmes, equipment repair, industrial and safety parts supply, and CMMS implementation to keep your operations running and cut unplanned downtime.

اطلب عرض سعر · Request a quote
```

---

## 4. Bulk upload (alternative to adding items by hand)

`catalog.csv` holds the same nine items in Meta's data-feed format. Meta requires
a price on every item, so each one is listed at **1 YER**; the title ends with
"السعر حسب الطلب" and the description opens and closes with a note that the price
is a placeholder and to get in touch for a quote.

Before uploading, the images must be live: `image_link` points at
`https://www.environmsafe.com/img/catalog/*.png`, which only exists once this
branch is deployed. Meta rejects items whose image it can't download.

1. Link WhatsApp to Meta: in the app, **Business tools → Facebook & Instagram**
   (or **Accounts Center**) and connect the Meta business account.
2. Open <https://business.facebook.com/commerce> → **Create a catalog** →
   type **Ecommerce** (online products) → owner: your business account.
3. In the catalog: **Catalog → Data sources → Add items → Data feed →
   Upload once** → choose `catalog.csv` → currency **YER**.
4. Wait for the upload report; fix and re-upload any rejected rows.
5. In WhatsApp Manager / the app's **Catalog** screen, choose this catalog as
   the one shown on WhatsApp.
6. Create the three collections (table in section 3) in Commerce Manager under
   **Catalog → Sets**, or in the app.

If any items were already added by hand in the app, delete them first, or the
catalog shows each service twice.
