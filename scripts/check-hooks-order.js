#!/usr/bin/env node
/**
 * scripts/check-hooks-order.js — بوابة «قواعد الهوكات» (React Rules of Hooks).
 *
 * الخطر المقيس: خمسة مكوّنات كانت تنادي `useState/useMemo/useEffect` **بعد**
 * إرجاع مبكر (`if (!user) return null;`) ⇒ عند تغيّر الحالة (null ⇄ موجود)
 * ينادي React عددًا مختلفًا من الهوكات ويرمي
 * «Rendered more hooks than during the previous render» وينهار الشاشة.
 * هذه بوابة ساكنة تمنع عودة النمط: لكل مكوّن، أول `if (...) return` عند مستوى
 * الدالة يقسّمها، ولا يُسمح بأي نداء هوك بعد هذا الفاصل.
 *
 * (لا تحلّ محلّ eslint-plugin-react-hooks لكنها تعمل في هذا المستودع بلا
 * اعتماديات إضافية، وتلتقط بالضبط النمط الذي وقع فعلًا.)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const HOOK = /\buse(State|Effect|Memo|Callback|Ref|DeferredValue|Context|Reducer|LayoutEffect|SyncExternalStore|ImperativeHandle|Id|Transition)\(|useWakeLock\(|useTheme\(|useApp\(|useI18n\(|useTabs\(|useHaptics\(|useNavigation\(|useSafeAreaInsets\(|useFocusTrap\(|useRoute\(/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

const open = (s) => (s.match(/\{/g) ?? []).length;
const close = (s) => (s.match(/\}/g) ?? []).length;

const violations = [];
let components = 0;

for (const file of walk(SRC)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(?:export\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    components += 1;
    // ابحث عن نهاية توقيع الدالة (فتح الجسم)
    let depth = open(lines[i]) - close(lines[i]);
    let j = i;
    while (depth <= 0 && j < lines.length - 1) {
      j += 1;
      depth += open(lines[j]) - close(lines[j]);
    }
    let guard = null;
    const after = [];
    depth = 1;
    let k = j;
    while (k < lines.length && depth > 0) {
      k += 1;
      if (k >= lines.length) break;
      const line = lines[k];
      const indent = line.length - line.trimStart().length;
      const stripped = line.trim();
      if (indent === 2 && guard === null && /^if \(.*\) return/.test(stripped)) guard = k + 1;
      else if (guard && indent === 2 && HOOK.test(line) && !stripped.startsWith('//')) after.push(k + 1);
      depth += open(line) - close(line);
    }
    if (guard && after.length) {
      violations.push({ file: path.relative(ROOT, file), name: m[1], guard, hooks: after.slice(0, 5) });
    }
  }
}

console.log('═══════════════════════════════════════════════════════');
console.log('  مسار — بوابة قواعد الهوكات (Rules of Hooks)');
console.log('═══════════════════════════════════════════════════════');
console.log(`  • مكوّنات مفحوصة: ${components}`);

if (violations.length) {
  console.log(`\n✗ ${violations.length} مكوّنًا ينادي هوكًا بعد إرجاع مبكر:`);
  for (const v of violations) {
    console.log(`   ${v.file} · ${v.name}() — الحارس في السطر ${v.guard}، هوكات بعده: ${v.hooks.join(', ')}`);
  }
  console.error('\n✗ فشل: انقل الحارس بعد كل الهوكات (أو احمِ البيانات داخل الهوك).');
  process.exit(1);
}
console.log('\n✅ لا مكوّن ينادي هوكًا بعد إرجاع مبكر.');
