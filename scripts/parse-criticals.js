const fs = require('fs');
const path = require('path');

const clean = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const b928 = clean('C:/Users/HP/.gemini/antigravity/brain/2d312d71-f165-484a-9a39-ba965181e8c5/scratch/comments_b928.json');
const db81 = clean('C:/Users/HP/.gemini/antigravity/brain/2d312d71-f165-484a-9a39-ba965181e8c5/scratch/comments_db81.json');
const all = [...b928, ...db81];

// Deduplicate comments by path + start_line + content prefix
const seen = new Set();
const deduped = [];
for (const c of all) {
  const key = `${c.path}:${c.start_line}:${(c.content || '').slice(0, 40)}`;
  if (!seen.has(key)) {
    seen.add(key);
    deduped.push(c);
  }
}

console.log(`Total deduped comments: ${deduped.length} (from ${all.length})`);

const criticals = deduped.filter(c => c.severity === 'critical');
const highs = deduped.filter(c => c.severity === 'high');

console.log(`Criticals: ${criticals.length}, Highs: ${highs.length}`);

fs.writeFileSync(
  'C:/Users/HP/.gemini/antigravity/brain/2d312d71-f165-484a-9a39-ba965181e8c5/scratch/deduped_comments.json',
  JSON.stringify(deduped, null, 2),
  'utf8'
);

console.log('\n=== CRITICAL ISSUES ===\n');
criticals.forEach((c, i) => {
  console.log(`[C${i+1}] ${c.path}:${c.start_line} (${c.category})`);
  console.log(`    ISSUE: ${c.content}`);
  if (c.suggestion_code) {
    console.log(`    SUGGESTION: ${c.suggestion_code.slice(0, 150)}...`);
  }
  console.log('');
});
