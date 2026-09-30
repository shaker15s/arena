#!/usr/bin/env node
/**
 * scripts/check-layout.js — بوابة «سلامة التخطيط المتجاوب» (LAYOUT-01 → 05).
 *
 * سبب وجودها (أعطال وقعت فعلًا على الموبايل):
 *  L1) `paddingTop: insets.top + 12` يتبعها `padding: 20` ⇒ في React Native
 *      تُطبَّق الخصائص بالترتيب، فالاختصار **يمسح** الحشوة العلوية الآمنة
 *      وينزلق المحتوى تحت شريط الحالة. (9 مواضع كانت مكسورة.)
 *  L2) طبقة زخرفية `position:'absolute'` بلا `pointerEvents="none"` ⇒ تبتلع
 *      اللمس فوق المحتوى (العناصر تحتها لا تستجيب للضغط على الجوال).
 *  L3) صف (`flexDirection:'row'`) فيه ≥4 أبناء مباشرين بلا `flexWrap` ⇒ على
 *      عرض 320–390pt يضغط كل عمود إلى ~60px فتُكسر الأبعاد ويقصّ النص.
 *  L5) هدف لمس أصغر من 44pt (Apple HIG / WCAG 2.5.8).
 *
 * البوابة ساكنة (AST حقيقي عبر TypeScript) وتعمل بلا اعتماديات جديدة.
 * ملاحظة: في TypeScript 6 انتقل `tagName/attributes` من `JsxElement` إلى
 * `openingElement` — نتعامل مع الشكلين عبر `jsxInfo`.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** استثناءات مقصودة ومعلّلة (لا تُكسر البوابة). */
const ALLOW_L5 = new Set([
  // نجوم التقييم: هدف اللمس موسّع بـ hitSlop ولا يمكن تكبير الشكل نفسه.
  'src/design/components.tsx',
]);

const SHORTHAND = ['padding', 'margin'];

/** مكونات «بلوك» يُتوقّع بينها مسافة رأسية. */
const CARDISH = new Set(['Card', 'GlassCard', 'ListRow', 'Section', 'Empty', 'SkeletonCard']);
const SPECIFIC = {
  padding: ['paddingTop', 'paddingBottom', 'paddingHorizontal', 'paddingVertical', 'paddingStart', 'paddingEnd', 'paddingLeft', 'paddingRight'],
  margin: ['marginTop', 'marginBottom', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd', 'marginLeft', 'marginRight'],
};

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

const findings = [];
const add = (rule, file, line, msg) => findings.push({ rule, file: path.relative(ROOT, file), line, msg });
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function objProps(node) {
  const out = [];
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
    const name = p.name && (p.name.escapedText || (p.name.text !== undefined ? p.name.text : null));
    if (!name) continue;
    out.push({ name, node: p });
  }
  return out;
}

/** توحيد شكل عنصر JSX بين TypeScript 5 و6. */
function jsxInfo(node) {
  if (ts.isJsxSelfClosingElement(node)) {
    return { tagName: node.tagName.getText(), attributes: node.attributes, children: [], node };
  }
  if (ts.isJsxElement(node)) {
    return {
      tagName: node.openingElement.tagName.getText(),
      attributes: node.openingElement.attributes,
      children: node.children,
      node,
    };
  }
  return null;
}

/** L1: اختصار (padding/margin) يأتي بعد خاصية محددة في نفس الكائن ⇒ يمسحها. */
function checkPaddingClobber(sf, obj) {
  const props = objProps(obj);
  const idx = {};
  props.forEach((p, i) => { idx[p.name] = i; });
  for (const short of SHORTHAND) {
    if (idx[short] === undefined) continue;
    for (const spec of SPECIFIC[short]) {
      if (idx[spec] !== undefined && idx[spec] < idx[short]) {
        add('L1', sf.fileName, lineOf(sf, props[idx[spec]].node),
          `${spec} يُكتب قبل ${short} — الاختصار يمحو قيمته فتفسد الحشوة/الهامش`);
      }
    }
  }
}

const styleHasAbsolute = (obj) => objProps(obj).some(
  (p) => p.name === 'position' && p.node.initializer && p.node.initializer.getText().includes('absolute'),
);

function styleNumeric(obj, key) {
  const p = objProps(obj).find((x) => x.name === key);
  if (!p || !p.node.initializer) return null;
  const m = /^(-?\d+(?:\.\d+)?)$/.exec(p.node.initializer.getText());
  return m ? Number(m[1]) : null;
}

const attrList = (jsx) => jsx.attributes.properties.filter(ts.isJsxAttribute);
const hasPointerEvents = (jsx) => attrList(jsx).some((a) => a.name.getText() === 'pointerEvents');
const hasPress = (jsx) => attrList(jsx).some((a) => /^on(Press|LongPress|PressIn|PressOut|Touch)/.test(a.name.getText()));

/** زخرفة خالصة: عنصر بلا أبناء نصيين/عناصر. */
function isDecorative(jsx) {
  if (!/^(View|Animated\.View|LinearGradient|BlurView|Svg)$/.test(jsx.tagName)) return false;
  return !jsx.children.some((c) => !ts.isJsxText(c) || c.getText().trim().length > 0);
}

function styleObjects(jsx) {
  const a = attrList(jsx).find((x) => x.name.getText() === 'style');
  if (!a || !a.initializer || !ts.isJsxExpression(a.initializer) || !a.initializer.expression) return [];
  const e = a.initializer.expression;
  if (ts.isObjectLiteralExpression(e)) return [e];
  if (ts.isArrayLiteralExpression(e)) return e.elements.filter(ts.isObjectLiteralExpression);
  return [];
}

/** L3: صف فيه أبناء كثيرون بلا التفاف. */
function checkCrowdedRow(sf, jsx) {
  const objs = styleObjects(jsx);
  const isRow = objs.some((o) => objProps(o).some(
    (p) => p.name === 'flexDirection' && p.node.initializer && p.node.initializer.getText().includes('row'),
  ));
  const wraps = objs.some((o) => objProps(o).some((p) => p.name === 'flexWrap'));
  if (!isRow || wraps) return;
  const kids = jsx.children.filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
  if (kids.length >= 4) {
    add('L3', sf.fileName, lineOf(sf, jsx.node),
      `صف فيه ${kids.length} أبناء بلا flexWrap — ينضغط حتى ينكسر على الشاشات الضيقة`);
  }
}

function visit(sf, node) {
  if (ts.isObjectLiteralExpression(node)) checkPaddingClobber(sf, node);

  const jsx = jsxInfo(node);
  if (jsx) {
    const objs = styleObjects(jsx);

    // L2
    if (objs.some(styleHasAbsolute) && !hasPointerEvents(jsx) && !hasPress(jsx) && isDecorative(jsx)) {
      add('L2', sf.fileName, lineOf(sf, jsx.node),
        `<${jsx.tagName}> مطلق (position:absolute) بلا pointerEvents="none" — يبتلع اللمس فوق المحتوى`);
    }
    // L3
    if (jsx.tagName === 'View' || jsx.tagName === 'Pressable') checkCrowdedRow(sf, jsx);
    if (jsx.tagName === 'Row') {
      const wraps = attrList(jsx).some((a) => a.name.getText() === 'wrap');
      const kids = jsx.children.filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
      // صف فيه ابن مرن (`flex: 1`) يتكيّف بنفسه — الخطر الحقيقي صفوف الأعمدة الثابتة.
      const hasFlexibleKid = kids.some((k) => {
        const info = jsxInfo(k);
        if (!info) return false;
        return styleObjects(info).some((o) => objProps(o).some((pp) => {
          if (pp.name !== 'flex' && pp.name !== 'flexGrow') return false;
          const t = pp.node.initializer ? pp.node.initializer.getText() : '';
          return t !== '0';
        }));
      });
      if (!wraps && !hasFlexibleKid && kids.length >= 4) {
        add('L3', sf.fileName, lineOf(sf, jsx.node),
          `<Row> فيه ${kids.length} أبناء بلا wrap — ينضغط حتى ينكسر على الشاشات الضيقة`);
      }
    }
    // L4: بطاقات متراصّة بلا مسافة بينها
    if (jsx.tagName === 'View' || jsx.tagName === 'ScrollView' || jsx.tagName === 'Section') {
      const ccsAttr = attrList(jsx).find((a) => a.name.getText() === 'contentContainerStyle');
      const objs = styleObjects(jsx).concat(
        ccsAttr && ccsAttr.initializer && ts.isJsxExpression(ccsAttr.initializer) && ts.isObjectLiteralExpression(ccsAttr.initializer.expression)
          ? [ccsAttr.initializer.expression] : [],
      );
      const hasGap = objs.some((o) => objProps(o).some((pp) => pp.name === 'gap' || pp.name === 'rowGap'));
      if (!hasGap) {
        const kids = jsx.children.filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
        const blocks = kids.filter((k) => {
          const info = jsxInfo(k);
          if (!info) return false;
          if (!CARDISH.has(info.tagName)) return false;
          const kstyle = styleObjects(info).map((o) => objProps(o).map((pp) => pp.name)).flat();
          return !kstyle.some((n) => /^(margin|marginTop|marginBottom|marginVertical)$/.test(n));
        });
        if (blocks.length >= 2) {
          add('L4', sf.fileName, lineOf(sf, jsx.node),
            `${blocks.length} بطاقات متراصّة بلا gap ولا margin — لا مسافة بين الأقسام`);
        }
      }
    }

    // L5
    if ((jsx.tagName === 'Pressable' || jsx.tagName === 'TouchableOpacity') && !ALLOW_L5.has(path.relative(ROOT, sf.fileName))) {
      for (const o of objs) {
        const w = styleNumeric(o, 'width');
        const h = styleNumeric(o, 'height');
        if (w != null && h != null && w > 0 && h > 0 && (w < 44 || h < 44)) {
          add('L5', sf.fileName, lineOf(sf, jsx.node), `هدف لمس ${w}×${h} أصغر من 44pt`);
        }
      }
    }
  }

  ts.forEachChild(node, (c) => visit(sf, c));
}

const files = walk(SRC);
for (const f of files) {
  const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  visit(sf, sf);
}

const byRule = {};
for (const x of findings) (byRule[x.rule] ||= []).push(x);

const ORDER = ['L1', 'L2', 'L3', 'L4', 'L5'];
const TITLES = {
  L1: 'اختصار حشوة/هامش يمحو قيمة محددة',
  L2: 'طبقة زخرفية تبتلع اللمس',
  L3: 'صف مزدحم بلا التفاف',
  L4: 'بطاقات متراصّة بلا مسافة',
  L5: 'هدف لمس أصغر من 44pt',
};

console.log('── بوابة سلامة التخطيط المتجاوب (check-layout) ──');
let total = 0;
for (const r of ORDER) {
  const list = byRule[r] || [];
  total += list.length;
  console.log(`  ${r} · ${TITLES[r]}: ${list.length}`);
  for (const x of list.slice(0, 80)) console.log(`      ${x.file}:${x.line} — ${x.msg}`);
  if (list.length > 80) console.log(`      … و${list.length - 80} أخرى`);
}
console.log(`  الإجمالي: ${total}`);

if (total > 0 && !process.argv.includes('--warn')) {
  console.error('\n✗ بوابة التخطيط فشلت — أصلح المواضع أعلاه.');
  process.exit(1);
}
console.log('\n✓ التخطيط سليم.');
