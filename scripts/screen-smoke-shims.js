/**
 * scripts/screen-smoke-shims.js — بدائل صامتة للوحدات الأصلية (haptics/gradients/
 * clipboard/storage…) عند تصيير المكوّنات في Node. الغرض: اختبار **منطق الشاشة**،
 * لا سلوك الوحدة الأصلية (وهي مُختبَرة على الجهاز/الويب).
 */
'use strict';
const React = require('react');

const noop = () => {};
const asyncNoop = async () => null;

const View = ({ children, ...rest }) => React.createElement('div', rest, children);
const Text = ({ children, ...rest }) => React.createElement('span', rest, children);

module.exports = new Proxy({ __esModule: true }, {
  get: (target, prop) => {
    switch (prop) {
      case '__esModule': return true;
      case 'LinearGradient': return View;
      case 'BlurView': return View;
      case 'statusBarStyle':
      case 'setStatusBarStyle': return 'auto';
      case 'StatusBar': return View;
      case 'default': return View;
      case 'impactAsync':
      case 'notificationAsync':
      case 'selectionAsync': return asyncNoop;
      // شاشات كاملة تستخدم الشريط الآمن: هوامش صفرية كافية لتصيير صحيح.
      case 'useSafeAreaInsets': return () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      case 'useSafeAreaFrame': return () => ({ x: 0, y: 0, width: 390, height: 844 });
      case 'SafeAreaProvider':
      case 'SafeAreaView': return View;
      case 'getItem':
      case 'setItem':
      case 'removeItem': return asyncNoop;
      default: break;
    }
    if (/^(Impact|Notification)FeedbackStyle$/.test(String(prop))) return { Light: 'light', Medium: 'medium', Heavy: 'heavy', Success: 'success' };
    return noop;
  },
});
