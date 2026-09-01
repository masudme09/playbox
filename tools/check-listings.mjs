/* Validates every listing against Play's character limits. */
import fs from 'node:fs'; import path from 'node:path';
const D = path.resolve(new URL('../store-listings', import.meta.url).pathname);
let fail = 0;
for (const f of fs.readdirSync(D).sort().filter(f => f.endsWith('.md'))) {
  const t = fs.readFileSync(path.join(D, f), 'utf8');
  const name  = (t.match(/\| App name \| `([^`]+)`/) || [])[1] || '';
  const blocks = [...t.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1].trim());
  const short = blocks[0] || '', full = blocks[1] || '';
  const row = (label, s, lim) => {
    const ok = s.length <= lim && s.length > 0;
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok ' : 'BAD'} ${label.padEnd(18)} ${String(s.length).padStart(4)} / ${lim}`);
  };
  console.log('\n' + f);
  row('title', name, 30);
  row('short description', short, 80);
  row('full description', full, 4000);
}
console.log(fail ? `\n${fail} FIELD(S) OVER LIMIT` : '\nall listings within Play limits');
process.exit(fail ? 1 : 0);
