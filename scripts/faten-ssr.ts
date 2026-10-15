/**
 * scripts/faten-ssr.ts — تحقّق تشغيلي حقيقي لمكوّنات فطن عبر React (بلا محاكي DOM).
 *
 * لماذا هذا الملف موجود: كانت كل مراجعات شكل «فطن» تعتمد على PNG من سكربت SVG
 * منفصل — أي أننا نتحقق من **الهندسة** لا من **المكوّن**. هنا نرسم المكوّن الفعلي
 * `FatenArt` (نفس ما يعمل على الويب/الجوال) إلى HTML ثم نحوّله إلى SVG ونرسمه PNG.
 * النتيجة: أي خطأ في المكوّن (نوع عنصر خاطئ، خاصية غير مدعومة، تدرّج مفقود،
 * اصطدام معرّفات) يسقط هنا بصوت عالٍ قبل أن يصل للمستخدم.
 *
 * التشغيل: `npx tsc -p tsconfig.test.json && node .test-build/scripts/faten-ssr.js`
 */
import { FATEN_LIGHT } from '../src/design/mascot/faten.palette';
import { FATEN_BASE_POSE, FATEN_POSES } from '../src/design/mascot/faten.pose';
import { FATEN_VIEWBOX } from '../src/design/mascot/faten.paths';
import type { FatenBehaviorState } from '../src/design/mascot/mascot.types';

export interface SsrResult {
  html: string;
  usedForbidden: string[];
}

interface ReactModules {
  React: any;
  renderToStaticMarkup: (node: any) => string;
  FatenArt: any;
}

/**
 * يجمع React + react-dom/server + النسخة الويب من react-native-svg.
 * تُمرَّر كوسائط لتفادي أي حالة عامة في الاختبارات.
 */
export function renderFatenStates(modules: ReactModules): Record<string, string> {
  const { React, renderToStaticMarkup, FatenArt } = modules;
  const out: Record<string, string> = {};
  const states: FatenBehaviorState[] = Object.keys(FATEN_POSES) as FatenBehaviorState[];
  for (const state of states) {
    out[state] = renderToStaticMarkup(
      React.createElement(FatenArt, { size: 200, pose: FATEN_POSES[state], palette: FATEN_LIGHT }),
    );
  }
  out.__base = renderToStaticMarkup(
    React.createElement(FatenArt, { size: 200, pose: FATEN_BASE_POSE, palette: FATEN_LIGHT }),
  );
  return out;
}

/**
 * فحوص صحّة لا تعتمد على الرسم: يضمن التقرير أن مخرَج React فعليًا SVG مبني من
 * عناصر مسموحة، وأن التدرجات المُشار إليها موجودة، وأن معرّفات التدرجات فريدة.
 */
export function auditSsrHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.includes('<svg')) problems.push('لا يوجد عنصر <svg> في المخرَج');
  if (!html.includes('viewBox')) problems.push('لا يوجد viewBox — الرسم لن يتناسب مع الحاوية');

  const allowed = ['svg', 'defs', 'lineargradient', 'radialgradient', 'stop', 'path', 'circle', 'ellipse', 'polygon', 'g', 'rect'];
  const tags = html.match(/<([a-zA-Z][a-zA-Z0-9-]*)/g) ?? [];
  for (const raw of tags) {
    const tag = raw.slice(1).toLowerCase();
    if (!allowed.includes(tag)) problems.push(`عنصر غير مسموح في مخرَج SVG: <${tag}>`);
  }

  const definedIds = new Set((html.match(/id="([^"]+)"/g) ?? []).map((s) => s.slice(4, -1)));
  const referenced: string[] = [];
  for (const match of html.matchAll(/url\(#([^)]+)\)/g)) referenced.push(match[1]);
  for (const ref of referenced) {
    if (!definedIds.has(ref)) problems.push(`تدرّج مُشار إليه وغير معرّف: #${ref}`);
  }

  const ids = (html.match(/id="([^"]+)"/g) ?? []).map((s) => s.slice(4, -1));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) problems.push(`معرّفات مكرّرة داخل نفس الرسم: ${Array.from(new Set(dupes)).join(', ')}`);

  if (!html.includes(`viewBox="0 0 ${FATEN_VIEWBOX.w} ${FATEN_VIEWBOX.h}"`)) {
    problems.push('viewBox لا يطابق FATEN_VIEWBOX');
  }
  return problems;
}

/** يحوّل HTML من react-dom إلى مستند SVG مستقل (لرسمه كصورة). */
export function htmlToSvg(html: string, width: number, height: number): string {
  // تقسيم نصّي بلا تعبيرات نمطية هشّة: أبسط وأقل عرضة لأخطاء التهريب (escaping).
  const openEnd = html.indexOf('>');
  const innerStart = openEnd + 1;
  const closing = '</svg>';
  const inner = html.endsWith(closing) ? html.slice(innerStart, html.length - closing.length) : html.slice(innerStart);
  const openTag = html.slice(0, innerStart);
  // نُسقط width/height القديمة (تتعارض مع الأبعاد المطلوبة) ونُبقي viewBox والحشوة.
  const rest = openTag
    .replace(/^<svg/, '')
    .replace(/>$/, '')
    .split(' ')
    .filter((token) => token.length > 0 && !token.startsWith('width=') && !token.startsWith('height='))
    .join(' ');
  return '<?xml version="1.0" encoding="UTF-8"?>' + '\n' + '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" ' + rest + '>' + inner + '</svg>';
}
