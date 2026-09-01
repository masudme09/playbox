/* ============================================================
   One place that knows how to start a browser.
   ------------------------------------------------------------
   Resolution order:
     1. PLAYBOX_CHROMIUM — an explicit binary. Use this on a
        machine that already has a Chromium and cannot download
        one (a locked-down container, an air-gapped build box).
     2. Playwright's own download, which is what `npx playwright
        install chromium` puts in place. This is the CI path.

   Everything headless in this repo goes through here so there
   is exactly one thing to change if that ever moves.
   ============================================================ */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const EXPLICIT = process.env.PLAYBOX_CHROMIUM || '';

/* Some environments ship a Chromium that Playwright did not download and
   cannot download (no network, or a pinned image). If PLAYWRIGHT_BROWSERS_PATH
   holds one, use it rather than failing — the revision rarely has to match
   exactly for what these tests do. */
function discover() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return '';
  let best = '';
  for (const d of fs.readdirSync(root)) {
    if (!/^chromium(_headless_shell)?-\d+$/.test(d)) continue;
    for (const bin of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
                       'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
                       'chrome-win/chrome.exe']) {
      const f = path.join(root, d, bin);
      if (fs.existsSync(f) && (!best || d > path.basename(path.dirname(path.dirname(best))))) best = f;
    }
  }
  return best;
}

export async function launch(opts = {}) {
  const args = ['--mute-audio', ...(opts.args || [])];
  const base = { ...opts, args };
  if (EXPLICIT) base.executablePath = EXPLICIT;

  try {
    return await chromium.launch(base);
  } catch (first) {
    if (!EXPLICIT) {
      const found = discover();
      if (found) {
        try { return await chromium.launch({ ...base, executablePath: found }); } catch (e) { first = e; }
      }
    }
    const hint = EXPLICIT
      ? `PLAYBOX_CHROMIUM is set to ${EXPLICIT} — is that path right?`
      : 'run `npx playwright install --with-deps chromium`, or set PLAYBOX_CHROMIUM to a Chromium binary';
    first.message = `could not start Chromium: ${hint}\n${first.message}`;
    throw first;
  }
}

/* A tiny static server, so tests can use an http origin. Serving over http
   matters: on file:// an iframe gets an opaque origin and the games cannot
   reach the hub, which is nothing like how the app behaves on device. */
export async function serve(root, port) {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  const srv = http.createServer((q, r) => {
    let f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    if (!path.resolve(f).startsWith(path.resolve(root))) { r.statusCode = 403; r.end('no'); return; }
    fs.readFile(f, (e, d) => {
      if (e) { r.statusCode = 404; r.end('not found'); return; }
      r.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
      r.end(d);
    });
  });
  await new Promise(res => srv.listen(port, res));
  return { server: srv, origin: `http://localhost:${port}`, close: () => srv.close() };
}
