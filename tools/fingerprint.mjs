/* ============================================================
   A content hash of everything demo/playbox.html is built from.
   ------------------------------------------------------------
   The bundled preview is a build product, and a stale one means
   the published page is running old game code. File mtimes
   cannot detect that — a git clone stamps every file with the
   checkout time — so the hash is written into the generated file
   and compared on the way back out.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sourceFiles(root) {
  const out = [path.join(root, 'index.html'), path.join(root, 'hub/hub.js')];
  const reg = fs.readFileSync(path.join(root, 'shared/registry.js'), 'utf8');
  for (const m of reg.matchAll(/slug: '([a-z0-9]+)'/g)) {
    for (const f of ['index.html', 'game.js']) out.push(path.join(root, 'games', m[1], f));
  }
  for (const f of fs.readdirSync(path.join(root, 'shared')).sort()) {
    if (/\.(js|css)$/.test(f)) out.push(path.join(root, 'shared', f));
  }
  return out.sort();
}

export function fingerprint(root) {
  const h = crypto.createHash('sha256');
  for (const f of sourceFiles(root)) {
    h.update(path.relative(root, f));
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex').slice(0, 16);
}

export const MARKER = 'playbox-sources';
export const stampOf = html => {
  const m = html.match(/<!--\s*playbox-sources:\s*([0-9a-f]{16})\s*-->/);
  return m ? m[1] : '';
};
