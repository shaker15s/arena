# 🏛️ Design Architecture Directive — Masar 4.0
### من Shaker (2026-10-01) — مرجع ملزم لموجات التصميم (T3–T7)

> **الطابع:** توجيه معماري نهائي (Design Architecture Refactor — مش Design Rewrite).
> يبني على الأساس الموجود (tokens مركزية، ThemeProvider، Light/Dark/OLED، IBM Plex Sans Arabic، RTL/i18n، AutoGrid، layout gate، a11y utilities، reduced-motion، lazy screens، Suspense skeletons، responsive typography، Supabase حقيقي، E2E + كل البوابات).
> **الفلسفة المركزية:** الفخامة مش إن كل عنصر يلمع — الفخامة إنك تعرف بالظبط إيه اللي يستحق يلمع.

---

## 1) التعريف الجديد: فصل طبقتين

```
┌──────────────────────────────────────┐
│            CONTENT LAYER             │  ← backgrounds / cards / data /
│                                      │    courses / attendance / progress /
│                                      │    illustrations / Faten
├──────────────────────────────────────┤
│          LIQUID UI LAYER             │  ← floating tab bar / toolbar /
│                                      │    sheets / popovers / key controls
└──────────────────────────────────────┘
```

Apple Liquid Glass = **طبقة وظيفية منفصلة فوق المحتوى** (تنقل، tab bar، toolbar، popovers، some controls) — **ممنوع** استخدامه في طبقة المحتوى أو تكديس Glass فوق Glass. الهوية والـbranding تظهر في الـcontent layer، والـUI layer تبقى للتنقل والأفعال.

**الاستهداف الخاطئ (مرفوض):** «كل الشاشة Glass».

## 2) تشخيص: Glass عنده أكثر من تعريف واحد (لازم يتوقف)
- `LiquidGlassCard.tsx` يعمل BlurView فعلي لبطاقة **محتوى**.
- `GlassBtn` blur، `StatBubble` backdrop-filter على الويب.
- **الحل الرسمي — 4 أسطح فقط:**
```ts
type Surface = 'background' | 'content' | 'elevated' | 'glass';
```
| النوع | الاستخدام | Blur |
|---|---|---|
| `background` | الخلفية الأساسية | — |
| `content` | Card / section / list | **ممنوع** |
| `elevated` | سطح أعلى، shadow أقوى | ممنوع افتراضياً |
| `glass` | functional floating UI فقط (TabBar, Toolbar, Floating Actions, Bottom Sheet, Popover, Scanner Overlay, transient controls) | مسموح |

## 3) Glass System — استبدال «مجموعة components عشوائية»
- `LiquidGlassCard` → **DEPRECATED** → `Surface` / `ElevatedSurface`. Hero مميز = `<ElevatedSurface emphasis="hero" />` مش Glass.
- الـsystem المقترح:
```tsx
<Surface />            // content
<ElevatedSurface />
<FunctionalGlass>      // wrapper لـ functional UI
  <TabBar />
</FunctionalGlass>
<GlassControl />
<GlassSheet />
<GlassPopover />
```
- اسم الـcomponent يحدد وظيفته → يمنع الـdesign drift.

## 4) وصفة Liquid Glass الصح (6 layers)
1. **Environment** — خلفية فيها محتوى كفاية عشان الـglass يبان.
2. **Blur** — للخلفية.
3. **Adaptive Tint** — لون خفيف جداً يتأثر بالـcontext.
4. **Specular Highlight** — خط/انعكاس خفيف جداً فوق.
5. **Shadow** — محايد ومتكيف.
6. **Interaction** — press: glass بيصفى شوية + tiny scale + internal highlight + optional haptic.
   **ممنوع:** glow explosion / border beam / scale .92 / shimmer / bounce.
- **Glass-on-Glass ممنوع (قاعدة 1):** Glass Tab Bar ← Glass Card ← Glass Button = نفس الـvisual weight = فشل.

## 5) Buttons — إعادة تعريف (4 أنواع فقط)
| النوع | الاستخدام |
|---|---|
| `Primary` | أهم action في الشاشة — **Solid/Tinted مش Glass** |
| `Secondary` | action ثانوي |
| `Tertiary` | نص/icon/low emphasis |
| `GlassControl` | فوق functional glass بس |

- **أحجام:** visual glyph 32–38، **hit area ≥ 44×44** (كل الـcritical actions). `GlassBtn sm=38` مرفوض.

## 6) Tokens: قتل الازدواجية
- `glassLevels.thin == subtle` / `thick == heavy` → حذف الـaliases.
- `elevation` الأسماء المتداخلة (0/none, 1/sm, 2/md, 3/lg, 4/modal) → مسمّى واحد لكل مستوى.
- `glassEffects` values مكتوبة مرتين → مصدر واحد.
- الهيكل المستهدف:
```
design/
├── tokens/   colors · spacing · radii · typography · elevation · motion · glass · index
├── primitives/  Surface · Glass · Text · Icon · Stack
└── components/  Button · IconButton · Card · Input · SegmentedControl · ListRow · Sheet · Toast · ...
```
- كل token = **مصدر واحد** (Single Source of Truth).

## 7) الألوان — نهاية «Rainbow UI»
| الطبقة | النصيب |
|---|---|
| Neutral | 70–80% |
| Brand | 10–15% |
| Semantic | 5–10% |
| Delight | لحظات محددة فقط |

- **Gold ثابت في:** certificate / achievement / streak / rank — **مش** لون عام لكل الـcomponents.
- الـcolor في الـcontrols/navigation بحذر؛ المساحة الأكبر = محتوى.

## 8) الخلفية — تقليل الـOrbs
- `AppBackground` دلوقتي = 3 ambient orbs متحركة **persistent** على كل الشاشات تقريباً → مخالف لحركة Apple «هادفة وقصيرة ومن غير تكرار».
- المقترح: `static gradient + 0–1 ambient shape + optional subtle drift`.
- ممنوع في شاشة واحدة: orb×3 + beam + shimmer + mascot animation + progress animation + card animation.

## 9) TodayScreen — تبسيط قوي (hierarchy صارم)
دلوقتي: Faten + gold badge + live gradient + BorderBeam + AnimatedShinyText + stats + progress ring + eligibility + badges + quick actions + empty mascot + shimmer = **كل حاجة بتحاول تكون Hero**.
المطلوب:
```
1. Greeting / context
2. Current task          (LIVE NOW → course + [Check in])
3. Key status            (Attendance 84% · Certificate 72%)
4. Progress
5. Upcoming
6. Secondary tools
```

## 10) BorderBeam: من «decoration افتراضي» إلى «event effect»
يستخدم **فقط** في: certificate unlocked / attendance verified / major achievement / important live event. **الندرة = القيمة.**

## 11) Motion System (M0–M4) — نقل تدريجي لـReanimated 4
| المستوى | الاستخدام | الأرقام الابتدائية |
|---|---|---|
| M0 | No Motion | — |
| M1 | Micro (button press) | 80–140ms |
| M2 | Interaction (sheet/tab/toggle) | 160–300ms |
| M3 | Transition (screen) | 250–380ms |
| M4 | Celebration (cert/badge/major success) | 400–700ms |

- الأرقام = starting tokens — **الـcalibration على الـdevice مش على الذوق**.
- **Interruptible:** gesture → direct response → content follows. المستخدم مايتجبرش يستنى animation تخلص.
- Reanimated 4 **انتقائي:** transform/opacity/gestures/shared-visual — **مش** كل Text/Icon/Card/Divider.
- أي animation جديد لازم الإجابة: «إيه القيمة UX اللي المستخدم بياخد من ده؟» لو «بتخليها شكلها جامد» → مش محتاج.
- `Animated` legacy → migration تدريجي مش دفعة.

## 12) Reduce Motion = Design Contract
- كل component animation يدعم `motionLevel`: `motion="subtle|standard|celebratory"`.
- عند Reduce Motion: `subtle→none`, `standard→fade`, `celebratory→static state + haptic`.
- تقليل scaling والـperipheral motion؛ **عدم تحريك blur نفسه**.
- مفيش `if (reducedMotion) return null` بس كحل.

## 13) Blur Budget (أداء)
- **iOS:** real glass · **Android 12+:** controlled blur (RenderNode) · **Android قديم:** translucent fallback · **Web:** backdrop-filter لو مدعوم وإلا solid fallback.
- **ممنوع 20 BlurView في شاشة.**

## 14) Performance Budget رسمي
| | الشاشة العادية | الشاشة الثقيلة (Scanner/Live/Journey viz) |
|---|---|---|
| Continuous animations | 0–2 | budget منفصل |
| Heavy blur surfaces | 0–2 | budget منفصل |
| Infinite loops | **0 ideally** | بالحد الأدنى |
| Large shadows | limited | limited |
| Large SVGs | lazy | lazy |

## 15) Accessibility — من «عندي utilities» إلى «كل interaction ليه contract»
- لكل عنصر: **Role · Label · Hint · State · Value · Focus · Announcement**.
- **Live regions** إلزامية لـ: Attendance confirmed / QR expired / Certificate issued / Course joined / Network unavailable / Action failed (خصوصاً Scanner).
  - «Attendance confirmed for Python Basics» — **مش** تغيير لون الشاشة.
- **Focus على الويب (WCAG 2.2 Focus Not Obscured):** element المfocus ماينفعش يبقى مخفي تحت floating UI (tab bar/sheets/sticky headers/overlays).
  - الاختبار: Tab / Shift+Tab / Enter / Space / Arrows / Escape.
- **الـIcon system gateway مركزي:** `<Icon name="calendar" decorative />` — decorative → `accessible=false` + `aria-hidden`؛ semantic → `accessibilityLabel`. يمنع قارئ الشاشة يقرأ «calendar, sparkle, shield» منفصلين.
- **Text scaling:** 200% web (WCAG 2.2) — «مش أصغر الخط، خلي الـlayout مرن»: wrap / flexShrink / minWidth:0 / multi-line بدل `numberOfLines=1` التلقائي.
- **Contrast مركّب:** color + glass + background-ورا-glass — لازم **Composite Glass Contrast Test** (اللون اللي بيعدي 4.5:1 على أبيض ممكن يفشل على gradient).
- **الهدف الداخلي:** WCAG 2.2 AA كحد أدنى + Apple a11y conventions + screen reader testing على device حقيقي (VoiceOver/TalkBack).
  - Contrast ≥ AA · Touch ≥44pt (أدق: 24×24 CSS px حد WCAG 2.5.8) · Focus دايماً ظاهر · 200% web text · كل primary flows للقارئ · Reduce Motion 100% · RTL first-class · Keyboard كل primary flows على الويب.

## 16) Cards: «surfaces» مش «glass cards»
Card = clear hierarchy + soft surface + border + subtle shadow + **strong content**. **مش** blur/gradient/glow/beam/highlight/shadow. مفيش Card لازم تبان كريستال.

## 17) Navigation = Apple UI Layer
- **mobile:** floating tab bar · **tablet:** adaptive floating tabs / sidebar · **web/desktop:** sidebar أو top nav — **مش** نفس الـlayout متحشر على كل شاشة.
- Desktop layout: `Sidebar + Main content + Secondary panel`.
- **Scroll behavior (النضج):** scroll down → toolbar recedes + tab bar minimize خفيف + content ياخد مساحة · scroll up → controls ترجع. **من غير animation استعراضي.**
- **Scroll edge fade:** المحتوى اللي بيعدي تحت الـglass **مايبقاش مقروء بصعوبة**.
- **Action Sheets:** mobile → sheet · tablet/web → **anchored popover** (action صغير محلي = popover مش sheet ضخم).

## 18) Content Architecture لكل شاشة (نمط ثابت)
```
Context → Primary task → Primary state → Supporting info → Secondary actions → Deep details
```
**مش:** Header → Card → Card → Card → Stats → Card → Button → Card…

## 19) Empty / Loading / Error = جزء من الـproduct
لكل feature: `loading · empty · error · offline · success · partial`.
- Loading = **Skeleton مطابق للـlayout النهائي**.
- Empty = Faten + شرح + CTA.
- Error = رسالة إنسانية + retry.
- Offline = cached content + حالة offline صريحة.

## 20) Faten
- مش Lottie/Rive لمجرد asset جاهز — **الشخصية هي هوية Masar** أولاً.
- الحالات: Idle · Happy · Helpful · Celebration · Concerned · Thinking.
- Motion: idle = subtle · interaction = short · celebration = **one-shot**. **مش** شخصية بيتحرك طول الوقت.
- Rive يصبح منطقي **لما يتوفر تصميم احترافي فعلي** (الـasset الجيد أهم من المكتبة).

## 21) Toast: توحيد النظام
`ToastManager → ToastHost → ToastSurface` — 4 أنواع (success/warning/error/info)، **مش** styles hardcoded متفرقة. والمراجعة الفعلية لسلوك `Toast.tsx` مع `reduced` (الاختيار لازم يكون مؤثر فعلاً).

## 22) Design Linting (حركة Architect)
- `design:check` — hardcoded spacing/radii/colors، duplicate shadows، unknown typography.
- `glass:check` — BlurView برا المسموح، backdropFilter برا glass primitives، **nested glass**، hardcoded rgba، hardcoded border colors.
- `motion:check` — `Animated.loop`، `setInterval`، infinite animations، large delays، animations من غير reduce-motion handling.
- (أولاً `layout:check` موجود.)

## 23) Screenshot-driven QA + Matrices
- **Device:** 320 / 360 / 390 / 430 / 768 / 1024+ · **States:** light/dark/OLED/RTL/large text/reduce motion/slow network/offline/empty/error/success · **Input:** touch/mouse/keyboard/screen reader.
- كل شاشة: `normal · empty · loading · error · success · dark · light · RTL · large text · reduced motion` → screenshot comparison.
- **A11y matrix:** iOS VoiceOver/Dynamic Type/Reduce Motion/Increase Contrast/Reduce Transparency · Android TalkBack/Font scaling/Reduce animations · Web Keyboard/Chrome zoom/Safari/focus-visible/screen reader/200%.

## 24) Web = 3 تجارب مش «RN Web × عرض»
mobile (bottom nav + عمود واحد + sheets) · tablet · desktop (sidebar + main + secondary panel). adaptation عبر أحجام الـwindows والمنصات.

## 25) Performance Architecture (قاعدة ذهبية)
**Animate presentation، مش layout.**
- ✅ transform / opacity / scale (بحذر)
- ⚠️ أقل تفضيلاً: width / height / margin / padding / top / left
- Reanimated fast paths للـnon-layout updates: **مايتفعلش flags لمجرد إنها موجودة** — `measure → identify bottleneck → optimize → remeasure` (مش «فعّل كل حاجة وارجي»).
- **Assets pipeline واضح** (brand/illustrations/mascot/icons/animations/sound). الأيقونات: **ماستبدلش Ionicons عشوائياً** — لو متماسكة مع الهوية، نغلفها. الأهم = consistency.
- **Sound:** في لحظات محددة بس (attendance confirmed / certificate earned / major achievement / important error). الـmotion **مايبقاش** وسيلة الـfeedback الوحيدة — لازم دعم (haptics/audio).

## 26) خطة التنفيذ بالترتيب (Waves)
```
Wave 0 — Freeze + Audit        inventory: BlurView · backdropFilter · rgba · LinearGradient ·
                               Animated.loop · BorderBeam · hardcoded colors/spacing · duplicate components
Wave 1 — Design Foundation     Tokens v2 · Surface system · Glass system · Typography v2 · Icon ·
                               Button · Spacing · Elevation · Motion — **ممنوع لمس شاشات لسه**
Wave 2 — App Shell             RootNavigator · TabBar · Toolbar · Safe Area · Scroll behavior ·
                               Floating layer · Sheets · Popover — **أولوية قصوى**
Wave 3 — Primitives            Txt · Icon · Surface · Card · Button · IconButton · Input · Tag · Chip ·
                               ListRow · Segmented · Sheet · Toast · Skeleton — بعدين ممنوع feature
                               يعمل primitive جديد من غير سبب قوي
Wave 4 — شاشات (بالترتيب):    Today → Explore → Course Details → Journey → Scanner →
                              Certificates → Profile → Volunteer Today → Live Session →
                              Admin Dashboard → remaining
                              (Today أولاً: تجمع branding+data+gamification+nav+cards+glass+
                               motion+mascot+actions = benchmark للنظام كله)
Wave 5 — Accessibility         بعد تثبيت primitives: roles/labels/states/hints/live regions/keyboard/
                               focus/RTL/text scaling/contrast/reduced motion/reduced transparency
                               (a11y بعد كل شاشة على حدى = تكرار شغل؛ primitive صح = مئات الحالات تتصلح)
Wave 6 — Performance          startup · bundle · screens · blur count · animated nodes · re-renders ·
                               list rendering · memory · image loading · font loading · network waterfalls
                               (lazyScreen لحده مايفرشش)
Wave 7 — Visual QA            screenshot comparison (23)
```
**Release Gate (الالتزام):**
`[ ] typecheck [ ] all tests [ ] layout gate [ ] contrast gate [ ] a11y gate [ ] i18n parity [ ] E2E [ ] real device [ ] VoiceOver [ ] TalkBack [ ] keyboard [ ] 200% web text [ ] reduced motion [ ] reduced transparency [ ] light/dark/OLED [ ] 320–1024+ responsive [ ] no unexpected glass nesting [ ] no uncontrolled infinite animation [ ] no critical UI under floating chrome`

## 27) القرارات الـ15 الملزمة (قبل أي كود جديد)
| القرار | Masar |
|---|---|
| Glass everywhere؟ | ❌ |
| Glass في navigation؟ | ✅ |
| Glass في content cards؟ | ❌ |
| Glass-on-glass؟ | ❌ |
| Blur دائم؟ | ❌ |
| BorderBeam دائم؟ | ❌ |
| Infinite ambient animations؟ | شبه صفر |
| Brand color everywhere؟ | ❌ |
| Primary CTA | solid/tinted |
| Touch target | ≥44pt |
| Screen reader | إلزامي |
| 200% web text | إلزامي |
| Reanimated | نعم — بشكل انتقائي |
| Legacy Animated | migration تدريجي |
| Figma-like consistency | إلزامي |

## الخلاصة التنفيذية (ترتيب شاك)
1. Freeze visual expansion → 2. Unify tokens → 3. قتل الـduplicate glass systems → 4. فصل content surfaces عن Liquid Glass → 5. Navigation كـfunctional glass layer → 6. Rebuild primitives → 7. تبسيط Today → 8. Motion language → 9. مigrate الحاسم لـReanimated 4 → 10. Finish a11y contract → 11. blur/animation budgets → 12. Responsive (desktop/tablet/mobile) → 13. Screenshot/device QA → 14. VoiceOver/TalkBack حقيقي → 15. Release certification.

> **الرسالة:** مش نسخة من iOS — **Masar بمبادئ تفاعل Apple-grade**: hierarchy · materials · motion · navigation · accessibility · platform adaptation + محتوى مسار (courses · attendance · volunteers · certificates · gamification · Faten · Arabic UX).

## المصادر اللي اتبنت عليها
Apple — Liquid Glass / Materials / Navigation / WWDC25 & WWDC26 · W3C WCAG 2.2 · React Native Reanimated 4 · Expo Blur (RenderNode Android 12+).
