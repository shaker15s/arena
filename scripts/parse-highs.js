const fs = require('fs');

const deduped = JSON.parse(
  fs.readFileSync('C:/Users/HP/.gemini/antigravity/brain/2d312d71-f165-484a-9a39-ba965181e8c5/scratch/deduped_comments.json', 'utf8')
);

const highs = deduped.filter(c => c.severity === 'high');

console.log(`=== HIGH ISSUES (${highs.length}) ===\n`);

// Group highs by category and file
const fileGroups = {};
for (const h of highs) {
  fileGroups[h.path] = fileGroups[h.path] || [];
  fileGroups[h.path].push(h);
}

for (const [filePath, items] of Object.entries(fileGroups)) {
  console.log(`\n📄 ${filePath} (${items.length} issues):`);
  for (const item of items) {
    console.log(`  - [L${item.start_line}] (${item.category}): ${item.content.slice(0, 180)}...`);
  }
}
