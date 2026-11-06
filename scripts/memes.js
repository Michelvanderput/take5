'use strict';
// Maakt public/memes/index.json uit de plaatjes die in public/memes/ staan.
// Handmatig: npm run memes. Draait ook automatisch bij `npm run build` (Vercel).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'memes');
const OK = /^[\w.-]+\.(jpe?g|png|webp|gif)$/i;

function scan() {
  const all = fs.existsSync(DIR) ? fs.readdirSync(DIR) : [];
  const files = all.filter((f) => OK.test(f)).sort();
  const skipped = all.filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f) && !OK.test(f));
  return { files, skipped };
}

if (require.main === module) {
  const { files, skipped } = scan();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(files, null, 1) + '\n');
  console.log(`memes: ${files.length} plaatje(s) in index.json`);
  for (const f of files) {
    const kb = Math.round(fs.statSync(path.join(DIR, f)).size / 1024);
    if (kb > 300) console.log(`  let op: ${f} is ${kb} KB (liever < 100 KB, anders laadt het traag)`);
  }
  if (skipped.length) console.log(`  overgeslagen (alleen letters, cijfers, - _ . toegestaan, geen spaties): ${skipped.join(', ')}`);
}

module.exports = { scan };
