import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPages } from './verify-pages.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

export async function servePages(directory) {
  const base = resolve(directory);
  let requiredPrefix = "";
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/pages-project') { response.writeHead(308, { Location: '/pages-project/' }); response.end(); return; }
      if (requiredPrefix && !url.pathname.startsWith(requiredPrefix)) { response.writeHead(404); response.end('Outside project mount'); return; }
      const pathname = decodeURIComponent(url.pathname.replace(/^\/pages-project(?=\/)/, ''));
      let file = resolve(base, '.' + pathname);
      if (file !== base && !file.startsWith(base + sep)) { response.writeHead(403); response.end(); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(bytes);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + server.address().port, setMount(prefix) { requiredPrefix = prefix === '/' ? '' : prefix; } };
}

export function brandImageLoaded(candidateDocument) {
  const doc = candidateDocument || document;
  const scope = doc.getElementById('root') || doc;
  return [...scope.querySelectorAll('img.mfx-emblem, img.brand-avatar')].some(image =>
    image.getClientRects().length > 0 && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
}

export async function smokePages(directory = resolve('dist')) {
  await verifyPages(directory);
  const { chromium } = await import('playwright');
  const { server, origin, setMount } = await servePages(directory);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const prefix of ['/', '/pages-project/']) {
      setMount(prefix);
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        const failures = [];
        page.on('pageerror', error => failures.push(error.message));
        page.on('requestfailed', request => { if (request.url().startsWith(origin)) failures.push('Request failed: ' + request.url()); });
        page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push('HTTP ' + response.status() + ': ' + response.url()); });
        const url = origin + prefix + '?pages-smoke=1';
        const response = await page.goto(url, { waitUntil: 'load' });
        if (!response || response.status() !== 200) throw new Error('Page did not return HTTP 200: ' + url);
        await page.waitForFunction(() => {
          const root = document.getElementById('root');
          if (root && (root.querySelector('[data-mfx-boot]') || !root.hasChildNodes())) return false;
          const scope = root || document.body;
          return scope.innerText.trim().length > 40 && [...scope.querySelectorAll('h1')].some(heading => heading.getClientRects().length > 0);
        }, null, { timeout: 20000 });
        if (new URL(page.url()).pathname !== prefix) throw new Error('Startup unexpectedly redirected: ' + page.url());
        await page.waitForFunction(brandImageLoaded, null, { timeout: 20000 }).catch(error => {
          throw new Error('Visible Marfeyx logo failed to load at ' + prefix, { cause: error });
        });
        if (await page.locator('[data-mfx-startup-error]').count()) throw new Error('Startup recovery UI is showing instead of the app.');
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => { const root = document.getElementById('root'); return !root || (!root.querySelector('[data-mfx-boot]') && root.innerText.trim().length > 40); }, null, { timeout: 20000 });
        await page.waitForFunction(brandImageLoaded, null, { timeout: 20000 }).catch(error => {
          throw new Error('Visible Marfeyx logo failed to load at ' + prefix, { cause: error });
        });
        if (failures.length) throw new Error('Browser startup errors at ' + prefix + ':\n' + failures.join('\n'));
        console.log('Pages startup passed:', prefix, viewport.width + 'x' + viewport.height);
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await smokePages(resolve(process.argv[2] || 'dist'));
}
