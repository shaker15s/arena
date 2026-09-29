# سجل الأصول والتراخيص — Masar Asset Ledger

> **قاعدة إلزامية:** لا يدخل أي أصل (أيقونة/رسمة/حركة/صوت/خط/صورة) إلى المستودع قبل تسجيله هنا
> مع **إثبات الترخيص** في `docs/assets/licenses/`. بوابة CI ترفض أي ملف في `assets/**` بلا سجل.

## حالة السجل

| # | الأصل | النوع | المصدر (URL) | المؤلف | الترخيص | رابط الترخيص | إسناد؟ | تجاري؟ | تاريخ التنزيل | إثبات | مستخدم في |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Masar SVG logo (`masar-icon.svg`) | logo | ملك المشروع | فريق مسار | ملكية كاملة | — | لا | نعم | 2026-08 | — | الأيقونة والسبلاش |
| 2 | IBM Plex Sans Arabic | font | https://fonts.google.com/specimen/IBM+Plex+Sans+Arabic | IBM | SIL OFL 1.1 | https://openfontlicense.org | لا | نعم | 2026 | `licenses/ibm-plex-ofl.png` | التايبوغرافي الأساسي |
| 3 | أيقونات الواجهة | icons | (يُحدَّد بـADR-ICONS: Ionicons / Phosphor / Lucide) | حسب المكتبة | MIT / ISC | … | لا | نعم | — | … | `Icon` |
| 4 | رسوم الحالات الفارغة | illustration | (unDraw/Open Peeps/Haikei) | حسب | حسب | … | تحقّق | نعم | — | … | empty states |
| 5 | فطن (تميمة) | mascot | عمل مخصص بعقد | (يُحدَّد) | نقل ملكية فكرية | `licenses/faten-contract.pdf` | لا | نعم | — | — | `MascotStage` |
| 6 | ميكرو-أنيميشنز | lottie | LottieFiles (Public) | حسب الملف | Lottie Simple License | https://lottiefiles.com/page/license | لا (مستحسن) | نعم | — | … | حالات التحميل/الاحتفال |

## قالب سجل أصل جديد (انسخه)

```json
{
  "id": "",
  "type": "icon-set | illustration | lottie | rive | audio | font | image | logo",
  "files": [],
  "source_url": "",
  "author": "",
  "license": "",
  "license_url": "",
  "attribution_required": false,
  "commercial_use": true,
  "downloaded_at": "YYYY-MM-DD",
  "modified": "",
  "evidence": "docs/assets/licenses/<file>",
  "used_in": []
}
```

## قائمة سوداء (لا يُسجَّل أصل منها)
- لقطات من Dribbble/Behance/Pinterest/Google Images.
- Flaticon / IconScout / Freepik / Icons8 بنسخها المجانية (إسناد إلزامي و/أو قيود إعادة توزيع).
- Font Awesome Free بلا إسناد (CC BY 4.0).
- خطوط من مواقع تحميل غير موثّقة.
- أي أصل مولَّد بالذكاء الاصطناعي بلا مراجعة حقوق (ولا يصلح كـrig متجهي أصلًا).
