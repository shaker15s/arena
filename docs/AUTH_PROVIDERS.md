# مزوّدو الدخول في مسار — الإعداد والتحقق (AUTH_PROVIDERS)

> هذا المستند هو المرجع التشغيلي لتفعيل «المتابعة بحساب Google» و«المتابعة باستخدام Apple».
> كل بند هنا إمّا **مقيس في الكود** (بمسار ملف/سطر) أو **مقتبس من مصدر رسمي** (رابط).
> لا يُنشر إصدار للإنتاج قبل إتمام قائمة التحقق في آخر المستند.

## 1) الحالة في الكود (مصدر الحقيقة)

| المسار | الملف/الدالة | ملاحظات |
| --- | --- | --- |
| الويب — Google | `src/data/supabase.ts › signInWithGoogle()` | `signInWithOAuth({provider:'google', redirectTo})` مع PKCE (S256) — إعادة توجيه كاملة |
| الجوال — Google | نفس الدالة | `skipBrowserRedirect: true` + `expo-web-browser` ثم `exchangeUrlForSession()` |
| iOS — Apple | `src/data/supabase.ts › signInWithAppleNative()` | `expo-apple-authentication` (واجهة النظام) ثم `signInWithIdToken({provider:'apple'})` |
| الويب/أندرويد — Apple | `src/data/supabase.ts › signInWithApple()` | تدفق OAuth نفسه (إعادة توجيه/متصفح آمن) |
| الزر | `src/features/auth/AuthScreens.tsx › AppleSignInButton` | iOS: زر النظام `ASAuthorizationAppleIDButton` · غيره: زر مخصّص بمواصفات HIG |
| المواصفات | `src/design/integrations/appleSignIn.ts` | ارتفاع 56pt · زوايا `radii.button` · خط العنوان 43% من الارتفاع |

## 2) لوحة Supabase — Authentication → Providers

### Google (يعمل حاليًا)
1. Providers → Google → Enabled، وإضافة **Client ID** و**Client Secret** من Google Cloud Console.
2. Authorized redirect URI في Google Cloud:
   `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
3. Authentication → URL Configuration → Redirect URLs: أضف نطاق الإنتاج والنطاقات المحلية،
   مع `masar://auth/callback` (المخطط المعلن في `app.json` → `scheme: "masar"`).

### Apple (يتطلب حساب Apple Developer)
1. Certificates, Identifiers & Profiles → **Identifiers**: فعّل «Sign In with Apple» على
   المعرّف الأساسي `org.masaregypt.app` واختر *Enable as a primary App ID*.
2. **Keys** → مفتاح جديد بصلاحية Sign In with Apple ⇒ نزّل ملف `.p8` (يُحمَّل مرة واحدة فقط).
3. Providers → Apple في Supabase: أضف **Services ID** و**Team ID** و**Key ID** ومحتوى `.p8`
   (أو اترك الحقول فارغة إن كان الدخول جوالًا أصليًا فقط:
   docs.supabase.com → Sign in with Apple → *native*).
4. **Authorized Client IDs** (مهم للتدفق الأصلي): أضف Bundle ID — أي
   `org.masaregypt.app` (وأضف `host.exp.Exponent` لبيئة Expo Go عند الاختبار المحلي).
5. `Authorization Code Grant` غير مطلوب للمسار الأصلي.

> المصدر: https://supabase.com/docs/guides/auth/social-login/auth-apple
> وhttps://docs.expo.dev/versions/latest/sdk/apple-authentication/

## 3) قرار الـ nonce على مسار Apple الأصلي (موثّق بالمصادر)

**القرار: لا نُرسل `nonce` على المسار الأصلي (iOS) — لا إلى Apple ولا إلى Supabase.**

السبب، بترتيب الأدلة:
1. `signInWithIdToken()` في supabase-js يوثّق: «If the ID token contains a `nonce` claim, then the
   **hash of this value** is compared to the value in the ID token» — أي أن الخادم يُجزّئ ما نُرسله
   ثم يقارنه بالـ claim.
2. خادم GoTrue يُجري المقارنة بترميز **hex**: `fmt.Sprintf("%x", sha256.Sum256([]byte(nonce)))`
   بينما تدفّق Apple ينتج الترميز **base64url** بلا حشو ⇒ فشل ثابت باسم «Nonces mismatch»
   (الحالة الموثّقة: supabase/auth#2378، ومقترح الإصلاح: supabase/auth#2822).
3. الضمانة الفعلية: على المسار الأصلي يُستلم `identityToken` **داخل العملية** من النظام
   (`ASAuthorizationController`) ولا يمرّ عبر رابط إعادة توجيه قابل للاعتراض — وهو سطح الهجوم
   الوحيد الذي يمنعه الـ nonce. ويبقى التحقق الخادمي كاملًا: التوقيع و`iss` و`aud` و`exp`.
4. عند غياب الـ claim من الطرفين يتخطى GoTrue الفحص (شرطه: وجودهما معًا أو غيابهما معًا)،
   وهذا سلوك حتمي لا يعتمد على إصدار.

**إن أُلغي هذا السلوك مستقبلًا** في Supabase (دمج #2822) فالتحويل للـ nonce يكون بسطرين في
`signInWithAppleNative()`: توليد `rawNonce` عبر `expo-crypto`، تمرير مُجزّئه إلى Apple، والـ raw إلى
`signInWithIdToken`. الاختبارات اليدوية TT-AUTH-03 تقيس هذا السلوك على جهاز حقيقي.

## 4) قائمة تحقق قبل الإنتاج

| # | الفحص | كيف | الناتج المتوقع |
| --- | --- | --- | --- |
| TT-AUTH-01 | Google — ويب | `npm run web` ثم الدخول من نطاق الإنتاج | جلسة + عودة إلى المسار الصحيح بلا خطأ `oauth-callback-failed` |
| TT-AUTH-02 | Google — أندرويد | بناء `preview` على EAS | فتح متصفح آمن ثم عودة تلقائية إلى التطبيق |
| TT-AUTH-03 | Apple — iOS حقيقي | بناء `preview` (لا Expo Go — الموديول أصلي) | زر النظام بترجمة جهاز عربية + جلسة صحيحة + حفظ الاسم مرة واحدة |
| TT-AUTH-04 | Apple — رفض المستخدم | إلغاء النافذة | لا رسالة خطأ (الحالة `cancelled` تُبتلع بهدوء) |
| TT-AUTH-05 | زر Apple على خلفية داكنة | تشغيل الثيم الداكن | الزر أبيض/نص أسود (HIG) لا أسود على أسود |
| TT-AUTH-06 | VoiceOver على زر Apple | تدوير التركيز | يُقرأ «المتابعة باستخدام Apple» |

## 5) مواصفات زر Apple المعتمدة (مقتبسة من HIG)

| البند | القيمة | المصدر |
| --- | --- | --- |
| الحد الأدنى للحجم | 140×30 pt | HIG → Sign in with Apple → Button size |
| الهامش حول الزر | 1/10 من الارتفاع (= 6pt عند 56) | نفسه |
| حجم خط العنوان (زر مخصّص) | 43% من الارتفاع (= 24px) | HIG → Creating a custom button |
| الارتفاع عندنا | 56pt (لا أصغر من زر Google) | HIG → «no smaller than other sign-in buttons» |
| نصف قطر الزوايا | `radii.button` = 16 | HIG → «Adjust the corner radius to match» |
| النمط في الثيم الفاتح/الداكن | أسود / أبيض | HIG → White · White with outline · Black |

> وجود مزوّد دخول خارجي (Google) يُلزم بتوفير Sign in with Apple لمن يوزّع على App Store:
> «Beginning with iOS 13, any app that includes third-party authentication options **must**
> provide Apple authentication as an option in order to comply with App Store Review guidelines»
> — المصدر: README حزمة `expo-apple-authentication` (النسخة المثبّتة 57.0.2) وApp Store Review 4.8.
