# WhatsApp Business — profile and catalog

Everything below is ready to paste into the **WhatsApp Business** app. Images are
in `public/img/catalog/` (also served at `https://www.environmsafe.com/img/catalog/`
once the site is deployed).

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
| Address | `VX8C+7C Al Mansourah, Aden, Yemen` — then drop the map pin on the office |
| Business hours | Monday–Friday, 8:00 AM – 5:00 PM (same as the website — check this matches your real working week) |
| Email | `support@environmsafe.com` |
| Website 1 | `https://www.environmsafe.com` |
| Website 2 | `https://www.environmsafe.com/ar/` |

### About (max 139 characters — pick one)

English (108):

```
HSE, fire protection, LPG, PSV testing & NEBOSH/IOSH training in Aden, Yemen. Message us to request a quote.
```

Arabic (107):

```
السلامة والحماية من الحرائق، الغاز LPG، اختبار صمامات PSV، ودورات NEBOSH وIOSH في عدن. راسلنا لطلب عرض سعر.
```

### Description (max 512 characters — bilingual, 467)

```
HSE and engineering services in Aden, serving Yemen and the region. Operator of the region's only certified PSV test bench (API 527 / API 576). Fire protection, LPG systems, safety evaluations and NEBOSH/IOSH training in Arabic and English. Message us for a quote.

خدمات السلامة والهندسة في عدن لليمن والمنطقة. المزود الوحيد في المنطقة بمقعد اختبار معتمد لصمامات الأمان PSV. حماية من الحرائق، أنظمة الغاز LPG، تقييم السلامة، ودورات NEBOSH وIOSH. راسلنا لطلب عرض سعر.
```

---

## 2. Messaging tools

In the app: **Business tools → Greeting message / Away message / Quick replies**.

### Greeting message (send to new customers)

```
Welcome to EnvironmSafe 👋
Tell us which service you need and a little about your site, and we'll send you a quote. Browse our services in the catalog above.

أهلاً بكم في انفيرومسيف 👋
أخبرونا بالخدمة المطلوبة ونبذة عن موقعكم، وسنرسل لكم عرض سعر. تصفحوا خدماتنا في الكتالوج أعلاه.
```

### Away message (outside business hours)

```
Thanks for contacting EnvironmSafe. We're out of the office right now (Mon–Fri, 8 AM – 5 PM) and will reply on the next working day.

شكراً لتواصلكم مع انفيرومسيف. نحن خارج ساعات العمل حالياً (الاثنين – الجمعة، 8 صباحاً – 5 مساءً) وسنرد عليكم في يوم العمل التالي.
```

### Quick reply `/quote`

```
To prepare your quote, please send:
1. Service needed
2. Site location
3. Equipment / system details (type, size, quantity)
4. Preferred date

لإعداد عرض السعر، يرجى إرسال:
1. الخدمة المطلوبة
2. موقع المنشأة
3. تفاصيل المعدات أو النظام (النوع، الحجم، العدد)
4. الموعد المفضل
```

### Quick reply `/contact`

```
📞 +967 78 340 2932 · +967 71 342 7082 · +967 77 303 3186
✉️ support@environmsafe.com
📍 VX8C+7C Al Mansourah, Aden
🌐 https://www.environmsafe.com
```

---

## 3. Catalog

In the app: **Business tools → Catalog → Add new item**. For each item: add the
image, the name, leave **Price** empty, paste the description, add the link, and
set the item code under **More fields**.

Then group them under **Catalog → ⋮ → Create collection**:

| Collection | Items |
|---|---|
| Testing & Inspection · الفحص والاختبار | PSV, Safety Evaluation, Inspection & Monitoring |
| Safety & Training · السلامة والتدريب | HSE & Fire Protection, NEBOSH & IOSH Training |
| Engineering & Systems · الهندسة والأنظمة | LPG Systems, Engineering & Construction, HVAC, Maintenance & Parts |

---

### ES-PSV — PSV Testing & Calibration | اختبار ومعايرة صمامات الأمان

- Image: `psv.png`
- Link: `https://www.environmsafe.com/services/psv.html`

```
The region's only certified PSV test bench. Inspection, testing, set-pressure verification, calibration, maintenance and repair of pressure safety valves to API 527 and API 576, with certification.

المزود الوحيد في المنطقة بمقعد اختبار معتمد لصمامات الأمان. فحص واختبار والتحقق من ضغط الفتح ومعايرة وصيانة وإصلاح وفق API 527 وAPI 576، مع إصدار الشهادات.

Request a quote · اطلب عرض سعر
```

### ES-HSE — HSE & Fire Protection | السلامة والحماية من الحرائق

- Image: `hse.png`
- Link: `https://www.environmsafe.com/services/hse.html`

```
Safety management systems, risk assessment, emergency response, incident investigation, regulatory compliance and complete fire protection by NFPA-certified specialists. Documented fire-protection compliance can cut insurance premiums by up to 85%.

أنظمة إدارة السلامة، تقييم المخاطر، الاستجابة للطوارئ، التحقيق في الحوادث، الامتثال التنظيمي، والحماية الكاملة من الحرائق على يد مختصين معتمدين من NFPA. الامتثال الموثق قد يخفض أقساط التأمين حتى 85%.

Request a quote · اطلب عرض سعر
```

### ES-LPG — LPG Systems | أنظمة الغاز LPG

- Image: `lpg.png`
- Link: `https://www.environmsafe.com/services/lpg-systems.html`

```
Design, installation, inspection and certification of LPG systems to international (NFPA) standards: separation distances, pressure relief, ventilation and emergency shutdown, for industrial and commercial sites.

تصميم وتركيب وفحص واعتماد أنظمة الغاز LPG وفق المعايير الدولية (NFPA): مسافات الفصل والتنفيس والتهوية والإغلاق الطارئ، للمنشآت الصناعية والتجارية.

Request a quote · اطلب عرض سعر
```

### ES-EVAL — Safety Evaluation | تقييم سلامة الأنظمة

- Image: `evaluation.png`
- Link: `https://www.environmsafe.com/services/evaluation.html`

```
Certified evaluation of LPG systems, boilers, electrical systems and fire protection against international standards, with a severity-ranked gap report you can act on.

تقييم معتمد لأنظمة الغاز LPG والمراجل والأنظمة الكهربائية وأنظمة الحماية من الحرائق وفق المعايير الدولية، مع تقرير فجوات مرتب حسب الخطورة.

Request a quote · اطلب عرض سعر
```

### ES-TRN — NEBOSH & IOSH Training | دورات NEBOSH وIOSH

- Image: `training.png`
- Link: `https://www.environmsafe.com/services/training.html`

```
Accredited safety training in Arabic and English: NEBOSH International General Certificate, Process Safety Management, Level 6 Diploma, and IOSH Working Safely and Managing Safely. Courses for individuals and company groups.

تدريب سلامة معتمد بالعربية والإنجليزية: الشهادة الدولية العامة NEBOSH IGC، سلامة العمليات PSM، الدبلوم المستوى السادس، وبرامج IOSH للعمل والإدارة بأمان. دورات للأفراد ولمجموعات الشركات.

Request a quote · اطلب عرض سعر
```

### ES-INSP — Inspection & Monitoring | الفحص والمراقبة البيئية

- Image: `inspection.png`
- Link: `https://www.environmsafe.com/services/inspection-monitoring.html`

```
Structural inspection and continuous environmental monitoring that catch problems early, keep your facility compliant and protect your assets.

فحص هيكلي ومراقبة بيئية مستمرة تكشف المشكلات مبكراً، وتحافظ على الامتثال التنظيمي، وتحمي أصول منشأتكم.

Request a quote · اطلب عرض سعر
```

### ES-ENG — Engineering & Construction | الهندسة والإنشاء

- Image: `engineering.png`
- Link: `https://www.environmsafe.com/services/engineering-construction.html`

```
Civil engineering design, project management and site oversight from concept to closeout — on time, on budget and fully compliant.

تصميم مدني وإدارة مشاريع وإشراف على التنفيذ من المفهوم حتى إغلاق المشروع، في الموعد وضمن الميزانية وبامتثال كامل.

Request a quote · اطلب عرض سعر
```

### ES-HVAC — Industrial HVAC | أنظمة التكييف والتهوية HVAC

- Image: `hvac.png`
- Link: `https://www.environmsafe.com/services/hvac.html`

```
Design, installation and maintenance of commercial and industrial HVAC systems: energy efficiency, indoor air quality and reliable thermal comfort.

تصميم وتركيب وصيانة أنظمة التكييف والتهوية للمنشآت التجارية والصناعية: كفاءة في استهلاك الطاقة، وجودة هواء داخلي، وراحة حرارية موثوقة.

Request a quote · اطلب عرض سعر
```

### ES-MNT — Maintenance & Parts | الصيانة وقطع الغيار

- Image: `maintenance.png`
- Link: `https://www.environmsafe.com/services/maintenance.html`

```
Preventive maintenance programmes, equipment repair, industrial and safety parts supply, and CMMS implementation to keep your operations running and cut unplanned downtime.

برامج صيانة وقائية وإصلاح معدات وتوريد قطع الغيار الصناعية وتجهيزات السلامة، مع تطبيق أنظمة CMMS، للحفاظ على استمرارية عملياتكم وتقليل التوقف غير المخطط له.

Request a quote · اطلب عرض سعر
```
