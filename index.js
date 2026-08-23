import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

// عربي أولاً: اتجاه RTL على الويب منذ الإقلاع (على نيتف يُدار عبر مكوّناتنا)
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
}

import App from './src/app/App';
registerRootComponent(App);
