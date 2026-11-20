# تطبيق أندرويد — منصة مدارس القمة النموذجية

تطبيق أندرويد بسيط (Java + WebView) يفتح منصة التعلّم عن بُعد داخل التطبيق.
لا يحتوي على أي بيانات؛ كل المحتوى وتسجيل الدخول من الموقع نفسه.

## البناء

يتطلب JDK 17 أو أحدث و Android SDK (ضع مساره في `ANDROID_HOME` أو في `local.properties` كـ `sdk.dir=`).

```bash
./gradlew assembleRelease -PserverUrl=https://qimmah.environmsafe.com
```

الخادم الافتراضي هو `https://qimmah.environmsafe.com` إذا لم يُحدَّد `serverUrl`.

## التوقيع

ملف المفاتيح وكلمة المرور **لا يوضعان في المستودع أبداً** (المستودع عام). اختر طريقة واحدة:

```bash
# 1) ملف خصائص خارج المستودع
./gradlew assembleRelease -PkeystoreProps=/path/to/keystore.properties
#    يحتوي: storeFile=… storePassword=… keyAlias=qimmah keyPassword=…

# 2) متغيرات البيئة
export QIMMAH_KEYSTORE_FILE=/path/to/qimmah-release.jks
export QIMMAH_KEYSTORE_PASSWORD='…'
export QIMMAH_KEY_ALIAS=qimmah        # QIMMAH_KEY_PASSWORD اختياري (افتراضياً = كلمة مرور الملف)
./gradlew assembleRelease
```

بدون توقيع يُبنى ملف غير موقَّع: `app-release-unsigned.apk`.

الملف الموقّع: `app/build/outputs/apk/release/app-release.apk` — انسخه إلى
`../public/download/qimmah.apk` لينزّله المستخدمون من الموقع.

تحقق: `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`

## تغيير عنوان الخادم من داخل التطبيق

عند ظهور شاشة «لا يوجد اتصال بالإنترنت» اضغط الرابط الصغير **«إعدادات الخادم»**،
اكتب العنوان (يجب أن يبدأ بـ `https://`) ثم «حفظ». زر **«استعادة الافتراضي»** يعيد العنوان الأصلي.

---

# Android app — Al-Qimmah Model Schools learning platform

A minimal Java WebView wrapper (no Capacitor/Cordova, no AndroidX). Package
`ye.qimmah.lms`, minSdk 21, targetSdk 35, ~100 KB APK.

**Build:** `./gradlew assembleRelease -PserverUrl=https://...` (default
`https://qimmah.environmsafe.com`, baked into `BuildConfig.SERVER_URL`).
Needs JDK 17+ and an Android SDK (`ANDROID_HOME` or `local.properties`).

**Signing:** `-PkeystoreProps=/path/keystore.properties` (keys `storeFile`,
`storePassword`, `keyAlias`, `keyPassword`), or `keystore.properties` in this
folder (git-ignored), or env vars `QIMMAH_KEYSTORE_FILE`,
`QIMMAH_KEYSTORE_PASSWORD`, `QIMMAH_KEY_ALIAS` (optional `QIMMAH_KEY_PASSWORD`).
With none of these the build still succeeds and produces
`app-release-unsigned.apk`. Never commit the keystore — this repo is public.

**Output:** `app/build/outputs/apk/release/app-release.apk`; publish it as
`../public/download/qimmah.apk`.

**Server URL in-app:** on the offline/error screen tap “إعدادات الخادم”, enter an
`https://` URL and save; “استعادة الافتراضي” restores the default. `http://` is
accepted only for `10.0.2.2`, `localhost` and `127.0.0.1` (plus `192.168.x.x` in
debug builds, whose network security config allows LAN cleartext).

**Behaviour notes:** only the server's host loads in-app; other top-level links
(YouTube pages, WhatsApp, `tel:`, `mailto:`) open outside, while iframes (YouTube
embeds) keep working. File upload, HTML5 fullscreen video, DownloadManager
downloads (with the session cookie), double-back-to-exit, and a native Arabic
offline screen with auto-retry when the network returns.

**Icons:** vector adaptive icon in `app/src/main/res/drawable/ic_launcher_*.xml`;
legacy PNGs are rendered by `python3 tools/make_icons.py` (keep both in sync).
