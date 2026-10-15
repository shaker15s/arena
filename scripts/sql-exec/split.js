/**
 * scripts/sql-exec/split.js — تقسيم نص SQL إلى عبارات منفصلة.
 *
 * لماذا؟ لتشغيل عبارات ملف ما «جزئيًا» في الاختبار (محاكاة نصف تطبيق عند فشل
 * في المنتصف)، ولاستهداف عبارة واحدة عند البحث عن الخطأ. القسمة بتحترم:
 *   $tag$ … $tag$  (أجسام الدوال) · 'نص' · "معرّف" · -- تعليق · انظر /* تعليق *​/
 *
 * ملاحظة: pgsql-ast-parser (المستخدم في check-sql.js) لا يقدر على بعض الصيغ
 * الصحيحة (`WITH x(a,b) AS (VALUES …)`)، لذلك نستخدم قاسمًا نصيًا هنا.
 */
'use strict';

function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const nl = sql.indexOf('\n', i);
      buf += nl === -1 ? sql.slice(i) : sql.slice(i, nl);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      buf += end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) { j += 2; continue; }
        if (sql[j] === ch) break;
        j++;
      }
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';') {
      out.push(buf + ';');
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length && s !== ';');
}

module.exports = { splitStatements };
