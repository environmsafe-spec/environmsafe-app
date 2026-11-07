import type { Messages } from './en'

const ar: Messages = {
  app: { name: 'ES المالية', company: 'انفيرومسيف' },
  nav: {
    home: 'الرئيسية', entries: 'القيود', procurement: 'المشتريات', sales: 'المبيعات',
    projects: 'المشاريع', reports: 'التقارير', settings: 'الإعدادات',
  },
  common: {
    save: 'حفظ', cancel: 'إلغاء', add: 'إضافة', edit: 'تعديل', search: 'بحث', loading: 'جارٍ التحميل…',
    yes: 'نعم', no: 'لا', active: 'نشط', inactive: 'غير نشط', code: 'الرمز', name: 'الاسم',
    nameEn: 'الاسم (إنجليزي)', nameAr: 'الاسم (عربي)', legacyId: 'الرقم القديم', notes: 'ملاحظات',
    noRows: 'لا توجد بيانات بعد.', saved: 'تم الحفظ', error: 'حدث خطأ', language: 'English',
    signOut: 'تسجيل الخروج', comingSoon: 'في مرحلة لاحقة', readOnly: 'للقراءة فقط حسب صلاحيتك',
    showInactive: 'إظهار غير النشط',
  },
  auth: {
    title: 'تسجيل الدخول', email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'دخول',
    mfaTitle: 'التحقق بخطوتين', mfaCode: 'الرمز المكوّن من 6 أرقام من تطبيق المصادقة', verify: 'تحقق',
    enrollTitle: 'تفعيل التحقق بخطوتين',
    enrollHelp: 'صلاحيتك تتطلب تطبيق مصادقة (Google Authenticator أو Microsoft Authenticator…). امسح الرمز ثم أدخل الرقم المكوّن من 6 أرقام.',
    noBackend: 'هذه النسخة غير متصلة بقاعدة بيانات بعد.',
    noCompany: 'حسابك ليس له صلاحية في أي شركة بعد. اطلب من المالك منحك الصلاحية.',
    forgot: 'نسيت كلمة المرور؟', resetSent: 'إذا كان البريد مسجلاً فقد أُرسل رابط إعادة التعيين.',
  },
  home: {
    pay: 'دفع', receive: 'قبض', transfer: 'تحويل', claim: 'مطالبة', billInvoice: 'فاتورة',
    upload: 'رفع سند', drafts: 'المسودات', cash: 'أرصدة النقد', attention: 'يحتاج متابعة',
  },
  md: {
    projects: 'المشاريع', customers: 'العملاء', suppliers: 'الموردون', employees: 'الموظفون',
    items: 'الأصناف', moneyAccounts: 'الحسابات البنكية والنقدية', coa: 'دليل الحسابات', rates: 'أسعار الصرف',
    customer: 'العميل', kind: 'النوع', status: 'الحالة', budget: 'الميزانية', budgetCurrency: 'عملة الميزانية',
    startDate: 'تاريخ البدء', endDate: 'تاريخ الانتهاء', description: 'الوصف', driveFolder: 'رابط مجلد Drive',
    phone: 'الهاتف', email: 'البريد', address: 'العنوان', city: 'المدينة', country: 'الدولة', taxNo: 'الرقم الضريبي',
    contact: 'جهة الاتصال', currency: 'العملة', defaultAccount: 'الحساب الافتراضي',
    defaultProject: 'المشروع الافتراضي', jobTitle: 'المسمى الوظيفي', drawings: 'سحوباته تعتبر مسحوبات مالك',
    alsoCustomer: 'عميل أيضاً', alsoSupplier: 'مورد أيضاً', unit: 'الوحدة', expenseAccount: 'حساب المصروف',
    revenueAccount: 'حساب الإيراد', lastCost: 'آخر تكلفة', lastPrice: 'آخر سعر بيع', isAsset: 'أصل ثابت',
    lifeYears: 'العمر الإنتاجي (سنوات)', bankName: 'البنك / الشركة', accountNo: 'رقم الحساب', iban: 'IBAN',
    holder: 'بعهدة', usualFee: 'الرسوم المعتادة', openingBalance: 'الرصيد الافتتاحي', openingDate: 'تاريخ الافتتاح',
    glAccount: 'حساب الأستاذ', type: 'النوع', parent: 'الحساب الأب', ifrsLine: 'بند القوائم', postable: 'قابل للترحيل',
    requiresProject: 'يتطلب مشروع', control: 'حساب رقابي', date: 'التاريخ', ratePerUsd: 'وحدات لكل 1 دولار', source: 'المصدر',
  },
  enum: {
    active: 'نشط', contract: 'عقد', internal: 'داخلي', on_hold: 'متوقف', closed: 'مغلق', open: 'مفتوح',
    goods: 'بضاعة', service: 'خدمة', bank: 'بنك', cash: 'نقدية', card: 'بطاقة', exchange: 'صرافة / حوالات',
    asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات',
  },
  settings: {
    users: 'المستخدمون والصلاحيات', periods: 'الفترات', audit: 'سجل التدقيق', company: 'الشركة',
    close: 'إقفال', reopen: 'إعادة فتح', reopenReason: 'سبب إعادة فتح الفترة؟', closedBy: 'أُقفلت',
    grant: 'منح صلاحية', revoke: 'إزالة', role: 'الصلاحية', user: 'المستخدم', mfa: 'يتطلب خطوتين',
    invite: 'تتم دعوة المستخدمين الجدد من لوحة Supabase حالياً؛ زر الدعوة يأتي عند الإطلاق.',
    when: 'الوقت', who: 'المستخدم', what: 'العملية', record: 'السجل', changes: 'التغييرات', year: 'السنة',
    deactivate: 'إيقاف', activate: 'تفعيل',
  },
}
export default ar
