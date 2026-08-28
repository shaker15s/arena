# DESIGN_AUDIT_APPLE.md — تدقيق تصميم Apple Liquid Glass — مسار 3.2

> محدّث: 2026-08-28 بعد تنفيذ المراحل 1-3 من خطة الإصلاح.
> المرجع: Apple HIG + WWDC25 «Meet Liquid Glass» + NN/g + LogRocket best practices.

## 1) سياسة الزجاج (الأهم)

قاعدة Apple: **Liquid Glass للطبقة التنقلية العائمة فقط — لا زجاج على زجاج، ولا blur في طبقة المحتوى.**

| العنصر | المعالجة |
|---|---|
| Tab bar / Sheets / شاشة الدخول / Scanner overlay | `BlurView` فعلي (GlassSurface) |
| `Card` الافتراضية | سطح زجاجي `theme.glass` بلا blur + shadow — سريعة وواضحة |
| `Card heavy` | prop استثنائي للضبابية الحقيقية (hero فقط) |
| `GlassCard` (أونبوردنج) | سطح ساكن بلا blur |
| `AmbientOrb` | موجتان عند الدخول ثم سكون — لا حلقة GPU دائمة |

## 2) التايبوغرافيا العربية

- الخط: IBM Plex Sans Arabic (400/500/600/700) من `tokens.ts` فقط.
- `includeFontPadding: false` عالميًا + `lineHeight` واسعة كفاية (micro 17، caption 20، body 24) حتى لا تُقص الامتدادات النازلة والتشكيل على أندرويد.
- ممنوع `numberOfLines={1}` على نص عربي قابل للطول بدون `adjustsFontSizeToFit` أو بديل.
- أدنى حجم نص: 11px (`micro`) — الشارات الرقمية ≥10px.
- `maxFontSizeMultiplier={1.4}` مع `allowFontScaling` في `Txt`.

## 3) التوكنز — المصدر الوحيد

- كل الألوان (بما فيها `fill`/`fillStrong`/`fillBorder` للتحكم و`orb*` للخلفيات) في `src/design/tokens.ts`.
- ممنوع rgba أو fontFamily نصي برّه مجلد `design/`.
- الثيمات الثلاث: light / dark / OLED + «حسب النظام»، ومحفوظة في `theme.tsx`.

## 4) قواعد UX

- هدف لمس ≥44px (`sizes.touchTarget`)، haptics خفيف للثانوي ومتوسط للأولوي.
- لا `Pressable` متداخلة — هدف ضغط واحد لكل منطقة (StatBubble يدعم `onLongPress`).
- Sheets: ارتفاع المحتوى، إغلاق بالسحب، دعم RTL.
- حالات فارغة/تحميل/خطأ إلزامية لكل قائمة (Empty/SkeletonList).
- احترام `prefers-reduced-motion` في كل أنيميشن (`isReducedMotion()`).

## 5) الوصولية

- `accessibilityRole/Label/Hint/State` على كل تفاعل، بعربي من `t()`.
- تباين WCAG AA (نص 4.5:1) — حد الزجاج الفاتح أوضح في light mode.
- أزرار النجوم `accessibilityRole="radio"` مع حالة الاختيار.

## 6) حالة التنفيذ (2026-08-28)

**منفَّذ ومُتحقَّق منه (`test:all` 81 ✅ / `export:web` ✅):**
- توكنز الحشوات/الحدود/الكرات/الذهبي (`fill*`, `orb*`, `certSoft`, `certPaper`) — صفر rgba معتمد على الثيم خارج `design/` (الاستثناء الوحيد المقصود: زر Google الأبيض بهويته الثابتة).
- تايبوغرافيا عربية أوسع + `certPaper` موحد بين الشاشة وقالب PDF.
- زجاج بلا blur في طبقة المحتوى، `heavy` للاستثناءات، orbs بموجتين ثم سكون.
- فك تداخل Pressable (easter egg على long-press)، a11y على QuickAction وStatBubble.
- `GlassCard` ساكنة للأونبوردنج، حذف 6 مكونات ميتة من `glass.tsx` (-373 سطر).

**مؤجَّل عن قصد (معلّل):**
- تحويل القوائم إلى `FlatList`: لا يوجد FlatList في المشروع إطلاقًا والبيانات محصورة لكل منظمة — ننفّذه عند أول قياس jank فعلي على قائمة كبيرة.
- قياس FPS على League: يحتاج جهاز حقيقي.
- فحص بصري نهائي على Android/شاشات مختلفة: يحتاج محاكي/جهاز.
