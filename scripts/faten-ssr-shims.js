/**
 * scripts/faten-ssr-shims.js — بدائل صامتة لمكوّنات React Native الأصلية (Fabric)
 * عند تحقّق SSR على Node. مسار الويب في react-native-svg لا يستدعي هذه المكوّنات
 * إطلاقًا؛ وجودها مطلوب فقط لأن ملفات الجسر تُحمَّل مسبقًا.
 */
'use strict';
/** يُحاكي مُعرّف مكوّن أصلي: `codegenNativeComponent('RNSVGCircle')` يعيد نصًا. */
const nativeComponentName = (name) => String(name);
module.exports = new Proxy({ __esModule: true }, {
  get: (target, prop) => {
    if (prop === '__esModule') return true;
    if (prop === 'default') return nativeComponentName;
    return nativeComponentName;
  },
});
