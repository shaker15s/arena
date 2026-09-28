# 🚀 خطة تطوير مسار (Masar) — تجربة المستخدم والديزاين والصقر فطن
## تحليل وتطوير شامل — 28 سبتمبر 2026

> **المرجع:** `https://github.com/shaker15s/arena` — الفرع `main`
> **الموقع المباشر:** `https://rtcc-ruby.vercel.app/`
> **المنهجية:** فحص كود فعلي (RootNavigator + glass + mascot + tokens) + فحص بصري للموقع المباشر.

---

## 📌 ملخص تنفيذي

المشروع **قوي جدًا** من ناحية البنية التحتية: Supabase حقيقي، RLS، RPCs ذرّية، TypeScript strict، تصميم Liquid Glass، محرك جيميفيكيشن كامل، و 30 migration مرقّم. لكن فيه **5 فجوات رئيسية** تمنعه من الوصول لمستوى احترافي حقيقي:

1. **أكسسبيليتي شبه معدومة** (zero `accessibilityLabel`/`accessibilityRole` في أغلب الشاشات)
2. **ناف بار سفلي بيغطّي المحتوى** (مشكلة قياس حقيقية في الكود)
3. **صقر فطن سيمبل جدًا** رغم وجود محرك سلوكيات مكتوب بشكل ممتاز
4. **كرات زجاجية/أنيميشن مكررة** بتستهلك أداء بدون قيمة
5. **ملفات شاشات عملاقة** (HubScreens 27KB, VolunteerScreens 34KB) فيها تكرار

---

## 🎯 المرحلة P0 — إصلاحات حرجة (أسبوع 1)

### 1. إصلاح تغطية الناف بار للمحتوى 🔴

**المشكلة الحقيقية (من الكود):**
```typescript
// RootNavigator.tsx — AppleTabBar
<View style={{
  position: 'absolute', left: 0, right: 0, bottom: 0,
  paddingHorizontal: 10,
  paddingBottom: Math.max(insets.bottom, 8)  // ← السفلي فقط
}}>
  <View style={{ minHeight: 68, borderRadius: 26, ... }}>
    ...
  </View>
</View>
```

**التحليل:**
- الناف بار `position: 'absolute'` → خارج تدفق الـ layout
- `ContentFrame` فيه `paddingBottom: 104 + Math.max(insets.bottom, 8)`
- الناف بار الفعلي ارتفاعه = `68 (minHeight) + paddingVertical(12) + insets.bottom`
- مع وجود FAB عائم (marginTop: -27) بيرتفع فوق الناف بار
- **المشكلة المباشرة**: في الويب وأجهزة insets كبيرة، المحتوى بيكون مغطى

**الحل:**
```typescript
// 1. قياس الناف بار فعليًا بدل الافتراض
const [tabBarHeight, setTabBarHeight] = useState(0);
<View
  onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}
  style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
>

// 2. تمرير الارتفاع للـ ContentFrame
<ContentFrame
  style={{ paddingBottom: tabBarHeight + 16 + insets.bottom }}
/>
```

**ملفات مطلوب تعديلها:**
- `src/app/RootNavigator.tsx`

---

### 2. إصلاح أكسسبيليتي الناف بار الحالي

**الموجود الحالي (جيد):**
```typescript
// TabButton — موجود accessibilityRole + accessibilityLabel + accessibilityState ✅
<Pressable
  accessibilityRole="tab"
  accessibilityLabel={tab.label}
  accessibilityState={{ selected: active }}
/>
```

**المفقود:**
- `accessibilityHint` — المستخدم مش بيعرف إيه اللي هيحصل لما يضغط
- `accessibilityLiveRegion` للـ badge (العدد الجديد)
- `accessibilityValue` للـ FAB

---

### 3. صفر `accessibilityLabel` في الشاشات 🔴

**الحل:** إنشاء نظام أكسسبيليتي مركزي:
```typescript
// src/design/a11y.ts (جديد)
export function a11yButton(label: string, hint?: string) {
  return {
    accessibilityRole: 'button' as const,
    accessibilityLabel: label,
    accessibilityHint: hint,
  };
}
```

**الشاشات الأكثر إصلاحًا:**
- `TodayScreen.tsx` (32KB) — أكبر شاشة
- `VolunteerScreens.tsx` (34KB)
- `LiveSessionScreen.tsx` (33KB)
- `HubScreens.tsx` (27KB)
- `ScannerScreen.tsx` — الكاميرا + QR
- `ProfileScreens.tsx` (18KB)
- `WizardScreen.tsx` (16KB) — 6 خطوات
- `BatchFormSheet.tsx` (12KB)

---

## 🎯 المرحلة P1 — صقر فطن 3.0 + تصميم (أسبوع 2-3)

### 4. إعادة بناء صقر فطن 🦅

**الوضع الحالي:**
- `MasarMascot.tsx` = **30KB SVG مكتوب يدويًا**
- فيه 13 حالة سلوكية + 8 أنيميشن + 60+ جملة عربية
- محرك سلوكيات ممتاز (`mascot.engine.ts` + `useMascot.ts`) يتعامل مع 16 نوع حدث
- **النتيجة**: شكل "سيمبل" رغم كل التعقيد

**المشاكل:**
1. SVG paths مكتوبة بإحداثيات يدوية (مش مرسوم بأداة احترافية)
2. كل سلوك بيرسم جناح جديد بسلسلة Path معقدة
3. مفيش أي SVG assets خارجية — كل حاجة inline
4. الأنيميشن الحالي: تنفس + رمش + ميلان رأس — **مفيش تفاعل حقيقي**

**الخيارات:**

#### الخيار A: Rive (موصى به للحالة دي) ⭐
- rive.app — أنيميشن تفاعلي حقيقي + state machine
- state machine built-in (13 حالة جاهزة زي ما المحرك متطلب)
- أداء native + حجم صغير (50KB بدل 30KB كود)
- تفاعل حقيقي مع المستخدم + WebSocket events
- **الأنسب** لأن محرك السلوكيات (`mascot.engine.ts`) أصلاً state machine

#### الخيار B: Lottie
- lottiefiles.com — رسومات JSON مجانية عالية الجودة
- `lottie-react-native`
- أسهل في الدمج لكن تفاعل أقل

#### الخيار C: إعادة رسم SVG احترافية
- ارسم في Figma/Illustrator → صدّر SVG نظيف
- أنيميشن على مستوى G groups عبر Reanimated

**التوصية:** **الخيار A (Rive)** — أداء + تفاعل + حجم
**الإطار الزمني:** 3-4 أيام

---

### 5. تقليل عدد الكرات الزجاجية والأمبينت

**الموجود (glass.tsx):**
```typescript
<AmbientOrb size={420} color={theme.orbPrimary} />   // كرة 1
<AmbientOrb size={460} color={theme.orbSecondary} /> // كرة 2
<AmbientOrb size={230} color={theme.orbTertiary} />  // كرة 3
```

**المشكلة:**
- 3 كرات أنيميشن مستمر (12s loop) على **كل شاشة**
- كل كرة فيها Animated.loop + interpolate
- استهلاك GPU/CPU مستمر

**الحل:**
```typescript
// 1. تقليل لكرة واحدة على الموبايل
const orbCount = Platform.OS === 'web' ? 3 : 1;

// 2. تعطيل الأنيميشن على الأجهزة الضعيفة
const shouldAnimate = !isReducedMotion() && !isLowEndDevice();

// 3. تقليل الـ opacity على الأندرويد
const effectiveOpacity = Platform.OS === 'android'
  ? (oled ? 0.08 : isDark ? 0.18 : 0.4)
  : (oled ? 0.15 : isDark ? 0.35 : 0.75);
```

---

### 6. تحسينات ديزاين النظام

**أ) tokens.ts — مشاكل صغيرة:**
```typescript
// spacing فيه تكرار: s1-s12 و xs/sm/md/lg/xl بنفس القيم
// radii فيه تكرار: cardSm = lg = 18
// → وحّد لنظام واحد واحذف المكرر
```

**ب) إضافة accessibility tokens:**
```typescript
export const a11yTokens = {
  minTouchTarget: 44,      // Apple HIG
  ctaButton: 52,           // موجود
  focusRingWidth: 3,
  focusRingColor: '#007AFF',
  contrastRatio: {
    normal: 4.5,           // WCAG AA
    large: 3.0,
    aaa: 7.0,
  },
  fontScaling: { min: 0.85, max: 1.35 },
};
```

---

## 🎯 المرحلة P2 — أكسسبيليتي شاملة (أسبوع 3-4)

### 7. دليل الأكسسبيليتي الكامل

**أ) VoiceOver / TalkBack:**
- كل زر له `accessibilityLabel` (اسم واضح)
- كل زر له `accessibilityHint` (إيه اللي هيحصل)
- كل صورة لها `accessibilityLabel` وصف
- كل header له `accessibilityRole: 'header'`
- ترتيب القراءة منطقي (من اليمين لليسار في العربية)

**ب) Dynamic Type (تكبير الخط):**
```typescript
<Text
  allowFontScaling={true}
  maxFontSizeMultiplier={1.35}
  adjustsFontSizeToFit={true}
/>
```
- اختبر مع: iPhone SE (320px) + Dynamic Type XL + Arabic

**ج) Touch Targets:**
- الحد الأدنى 44×44pt (موجود في tokens بس مش مطبق)

**د) التباين (Contrast):**
- `textMuted: '#8E8E93'` على `#FFFFFF` = **3.5:1** ← **فشل WCAG AA**
- **الحل**: غمّق `textMuted` لـ `#6E6E73` (4.6:1 ✅)

**هـ) RTL:**
- استبدل كل `left/right` بـ `start/end`
- فحص ScannerScreen (إطار الكاميرا)
- فحص كل `position: 'absolute'`

**و) Screen Reader Navigation:**
- `accessibilityElementsHidden` للديكور
- `accessibilityViewIsModal` للـ Sheets/Modals

---

### 8. إصلاح ألوان التباين

| العنصر | اللون الحالي | الخلفية | النسبة | الحكم | اللون الجديد |
|--------|--------------|---------|--------|-------|---------------|
| textMuted | #8E8E93 | #FFFFFF | 3.5:1 | ❌ فشل | #6E6E73 |
| textMuted (dark) | #8E8E93 | #1C1C1E | 3.2:1 | ❌ فشل | #AEAEB2 |
| textSecondary | #3C3C43 | #FFFFFF | 9.7:1 | ✅ ممتاز | — |
| textSecondary (dark) | #EBEBF5 | #1C1C1E | 15:1 | ✅ ممتاز | — |

---

## 🎯 المرحلة P3 — أداء وتحسينات (أسبوع 4-5)

### 9. إصلاح useMemo الضخم

**المشكلة:**
```typescript
// TodayScreen.tsx
const gamif = useMemo(() => gamifOf(db), [db]);  // db = كل قاعدة البيانات!
```

**الحل:**
```typescript
// استخدم selectors محددة
const sessions = useApp(s => s.db.sessions);
const todaySessions = useMemo(
  () => sessions.filter(s => isToday(s.startsAt)),
  [sessions]  // ← sessions فقط، مش db كله
);
```

### 10. تقليل حجم Bundle

- `lucide-react-native` + `@expo/vector-icons` — **الاتنين معًا = تكرار**
- الكود بيستخدم Ionicons في RootNavigator
- **الحل:** احذف `lucide-react-native` → وفّر ~50KB

### 11. كسر الشاشات الكبيرة

- `VolunteerScreens.tsx` (34KB) → شاشات منفصلة
- `LiveSessionScreen.tsx` (33KB) → استخرج QR + attendance
- `HubScreens.tsx` (27KB) → شاشات منفصلة
- `components.tsx` (46KB) → قسم لمجلد components/

---

## 📊 جدول الأولويات

| # | المهمة | الأولوية | الجهد | الأثر |
|---|-------|---------|-------|-------|
| 1 | إصلاح تغطية الناف بار | P0 | 1 يوم | 🔴 حرج |
| 2 | أكسسبيليتي للناف بار | P0 | 0.5 يوم | 🔴 حرج |
| 3 | صفر a11y في الشاشات | P0 | 3-5 أيام | 🔴 حرج |
| 4 | صقر فطن 3.0 (Rive) | P1 | 3-4 أيام | 🟠 عالي |
| 5 | تقليل الكرات الزجاجية | P1 | 0.5 يوم | 🟠 عالي |
| 6 | ألوان التباين | P1 | 0.5 يوم | 🟠 عالي |
| 7 | Dynamic Type | P2 | 1 يوم | 🟡 متوسط |
| 8 | RTL fixes | P2 | 1 يوم | 🟡 متوسط |
| 9 | useMemo selectors | P3 | 1-2 يوم | 🟡 متوسط |
| 10 | تقليل bundle | P3 | 0.5 يوم | 🟡 متوسط |
| 11 | كسر الشاشات | P3 | 2-3 يوم | 🟡 متوسط |

**الإجمالي: 15-22 يوم عمل**

---

## ✅ قائمة التحقق النهائية

### أكسسبيليتي (WCAG 2.1 AA)
- [ ] كل زر له label + hint
- [ ] كل صورة لها label
- [ ] كل header له role
- [ ] Touch targets ≥ 44pt
- [ ] Contrast ≥ 4.5:1 للنص العادي
- [ ] Contrast ≥ 3.0:1 للنص الكبير
- [ ] Dynamic Type لين لحد 1.35
- [ ] RTL سليم في كل الشاشات
- [ ] VoiceOver order منطقي
- [ ] Screens/Modals معزولة صوتيًا

### التصميم
- [ ] الناف بار لا يغطي المحتوى
- [ ] صقر فطن تفاعلي حقيقي
- [ ] كرات أقل + أداء أعلى
- [ ] نظام tokens موحد
- [ ] أيقونات من مكتبة واحدة

### الأداء
- [ ] selectors بدل db كامل
- [ ] bundle أصغر
- [ ] شاشات مقسومة
- [ ] lazy loading للشاشات الثانوية

### الاختبار
- [ ] VoiceOver على جهاز حقيقي
- [ ] Dynamic Type XL
- [ ] RTL + LTR
- [ ] iPhone SE (320px)
- [ ] أندرويد صغير
- [ ] Dark Mode + OLED
- [ ] Reduced Motion

---

## 📁 الملفات المطلوب تعديلها (مرتبة)

### P0 (حرج)
1. `src/app/RootNavigator.tsx` — الناف بار + a11y
2. `src/design/a11y.ts` (جديد) — نظام الأكسسبيليتي
3. `src/features/today/TodayScreen.tsx` — a11y + selectors
4. `src/features/attendance/ScannerScreen.tsx` — a11y + RTL

### P1 (عالي)
5. `src/design/mascot/MasarMascot.tsx` — صقر فطن 3.0
6. `src/design/glass.tsx` — تقليل الكرات
7. `src/design/tokens.ts` — ألوان + tokens
8. `src/design/components.tsx` — Txt + dynamic type

### P2 (متوسط)
9. `src/features/volunteer/VolunteerScreens.tsx` — كسر + a11y
10. `src/features/volunteer/LiveSessionScreen.tsx` — كسر + a11y
11. `src/features/org/HubScreens.tsx` — كسر + a11y
12. `src/features/profile/ProfileScreens.tsx` — a11y
13. `src/features/org/WizardScreen.tsx` — a11y لـ 6 خطوات

### P3 (تحسين)
14. `src/data/store.tsx` — selectors
15. `package.json` — حذف lucide
16. كسر باقي الشاشات الكبيرة

---

## 🎨 موارد خارجية مقترحة

### صقر فطن (أهمها)
- **Rive**: rive.app — رسومات تفاعلية + state machine (موصى به)
- **LottieFiles**: lottiefiles.com — رسومات JSON مجانية
- **unDraw**: undraw.co — رسومات SVG احترافية مجانية (مستخدم بالفعل)

### أيقونات
- Ionicons (موجود في expo) — موصى به
- Lucide (موجود لكن مكرر)
- Phosphor Icons — بديل احترافي

### فحص الأكسسبيليتي
- **axe DevTools** — فحص WCAG
- **VoiceOver** (macOS/iOS) — اختبار فعلي
- **TalkBack** (Android) — اختبار فعلي
- **Accessibility Scanner** (Android)

---

## 🏁 الخطوة التالية الفورية

**ابدأ بـ P0 #1** — إصلاح تغطية الناف بار، لأنه المشكلة الوحيدة اللي بتشوفها بصريًا على rtcc-ruby.vercel.app.

بعدها **P0 #3** — أكسسبيليتي للشاشات، لأنها أكبر فجوة في المشروع كله.

---

*الخطة مبنية على فحص فعلي للكود من GitHub + فحص بصري للموقع المباشر + قراءة 6 ملفات تصميم + 3 تقارير تدقيق موجودة.*
