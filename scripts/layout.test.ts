/**
 * scripts/layout.test.ts — اختبار الشبكة المتجاوبة (LAYOUT-01).
 *
 * يختبر `columnsFor` نفسها التي يناديها مكوّن `AutoGrid` في التصميم — أي أن
 * الأرقام المقاسة هنا هي ما يُنفَّذ فعلًا على الشاشة، لا نسخة موازية منها.
 *
 * الخصائص المطلوبة (لا نسخ للخوارزمية — خصائص يجب أن تصمد):
 *  P1) 1 ≤ الأعمدة ≤ عدد العناصر.
 *  P2) لا تجاوز: مجموع الأعمدة + الفواصل ≤ العرض المتاح (ما دامت > 1).
 *  P3) أقصية: لا يوجد عدد أعمدة أكبر يتّسع **و**لا يترك عنصرًا يتيمًا.
 *  P4) بلا يتيم: لا نختار عدد أعمدة يترك عنصرًا وحيدًا في آخر صف.
 */
import { columnsFor, layout, spacing } from '../src/design/tokens';

let passed = 0, failed = 0;
function ok(cond: boolean, name: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

console.log('\n═ الشبكة المتجاوبة (AutoGrid/columnsFor) — مسار ═');

// ── حالات حقيقية من شاشات التطبيق ──
// iPhone SE/Android ضيق (320) ومحتوى 280 بعد الحشوة الجانبية 20
ok(columnsFor(280, 4, layout.minColumn.action, 10) === 2, '320pt: الإجراءات السريعة تنزل إلى عمودين (2×2) بدل 4 أعمدة مكسورة');
// iPhone 14/15 (390) ومحتوى 350
ok(columnsFor(350, 4, layout.minColumn.action, 10) === 4, '390pt: الإجراءات السريعة 4 أعمدة');
ok(columnsFor(390, 4, layout.minColumn.stat, 12) === 4, '430pt: بطاقات الإحصاء 4 أعمدة');
// تابلت/ويب داخل إطار 780
ok(columnsFor(740, 4, layout.minColumn.action, 10) === 4, 'تابلت: لا تتجاوز عدد العناصر');
// 5 عناصر
ok(columnsFor(350, 5, layout.minColumn.action, 10) === 3, '5 عناصر على 390pt: 3 أعمدة (3+2) بلا يتيم');
ok(columnsFor(280, 5, layout.minColumn.action, 10) === 3, '5 عناصر على 320pt: 3 أعمدة (3+2 متوازنة)');
// حدود ومدخلات غير صالحة
ok(columnsFor(0, 4, 80, 10) === 1, 'عرض صفري ⇒ عمود واحد (لا NaN ولا 0)');
ok(columnsFor(NaN, 4, 80, 10) === 1, 'عرض NaN ⇒ عمود واحد');
ok(columnsFor(350, 0, 80, 10) === 1, 'صفر عناصر ⇒ عمود واحد');
ok(columnsFor(120, 4, 200, 10) === 1, 'عرض أضيق من العمود الأدنى ⇒ عمود واحد (لا قيمة سالبة)');

// ── فحص خصائص على نطاق كامل من المقاسات ──
const WIDTHS: number[] = [];
for (let w = 240; w <= 1440; w += 7) WIDTHS.push(w);
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];
const MINS = [layout.minColumn.stat, layout.minColumn.action, layout.minColumn.wide, 60, 200];
const GAPS = [spacing.s2, spacing.s3, spacing.s4];

let p1 = true, p2 = true, p3 = true, p4 = true, checked = 0;
const fits = (cols: number, min: number, gap: number, width: number) =>
  cols * min + (cols - 1) * gap <= width;

for (const width of WIDTHS) {
  for (const count of COUNTS) {
    for (const min of MINS) {
      for (const gap of GAPS) {
        checked++;
        const cols = columnsFor(width, count, min, gap);
        if (!(cols >= 1 && cols <= count)) p1 = false;
        // P2: ما دام اخترنا أكثر من عمود، يجب أن يتّسعوا فعلًا
        if (cols > 1 && !fits(cols, min, gap, width)) p2 = false;
        // P3: لا يوجد عدد أعمدة أكبر يتّسع ولا يترك يتيمًا
        for (let c = cols + 1; c <= count; c++) {
          if (fits(c, min, gap, width) && count % c !== 1) { p3 = false; break; }
        }
        // P4: لا نترك يتيمًا مع وجود بديل متّسع (7 عناصر مثلًا تترك يتيمًا في أي
        // عدد أعمدة ≤ 6 — فلا يُحسب خطأً ما دام لا بديل متّسع بلا يتيم).
        if (cols > 1 && count % cols === 1) {
          const alternative = (() => {
            for (let c = 2; c <= count; c++) {
              if (c === cols) continue;
              if (count % c !== 1 && fits(c, min, gap, width)) return true;
            }
            return false;
          })();
          if (alternative) p4 = false;
        }
      }
    }
  }
}

ok(p1, `P1: الأعمدة دائمًا بين 1 وعدد العناصر (${checked} توليفة)`);
ok(p2, 'P2: لا تجاوز أفقي — الأعمدة المختارة تتّسع فعلًا للعرض');
ok(p3, 'P3: أقصية — لا عدد أعمدة أكبر متّسع وبلا يتيم تُرك على الطاولة');
ok(p4, 'P4: بلا عنصر يتيم في آخر صف');

// ── اتساق المكوّن مع التوكنز ──
ok(layout.minColumn.action >= 70 && layout.minColumn.stat >= 70,
  'أدنى عرض عمود ≥ 70pt (أيقونة 46 + حشوة البطاقة) حتى لا يقصّ المحتوى');
ok(layout.gutters.narrow < layout.gutters.base && layout.gutters.base < layout.gutters.roomy,
  'سلّم الحشوات الجانبية متصاعد');
ok(layout.breakpoints.narrow < layout.breakpoints.compact
  && layout.breakpoints.compact < layout.breakpoints.tablet
  && layout.breakpoints.tablet < layout.breakpoints.desktop, 'نقاط التوقف متصاعدة');

console.log(`\n════ الشبكة المتجاوبة: ${passed} ناجح، ${failed} فاشل ════`);
if (failed > 0) process.exit(1);
