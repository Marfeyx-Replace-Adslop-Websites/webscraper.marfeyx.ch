import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyPages(directory = resolve('dist')) {
  const files = new Set();
  async function walk(folder, prefix = '') {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + item.name;
      if ((await lstat(resolve(folder, item.name))).isSymbolicLink()) throw new Error('Pages artifacts cannot contain symlinks: ' + name);
      if (item.isDirectory()) await walk(resolve(folder, item.name), name + '/');
      else files.add(name);
    }
  }
  await walk(directory);
  if (!files.has('index.html')) throw new Error('Missing dist/index.html. Deploy the built dist directory.');
  if (!files.has('.nojekyll')) throw new Error('Missing .nojekyll in the built artifact.');
  if (!files.has('CNAME')) throw new Error('Missing custom-domain CNAME in the built artifact.');
  const cname = (await readFile(resolve(directory, 'CNAME'), 'utf8')).trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cname)) throw new Error('CNAME must contain a hostname, without a URL scheme or path.');
  let references = 0;
  function check(file, reference) {
    let ref = reference.replace(/&amp;/g, '&');
    try { ref = decodeURIComponent(ref); } catch { throw new Error('Invalid asset URL in ' + file); }
    if (!ref || /^(?:[a-z]+:|\/\/|#)/i.test(ref)) return;
    if (ref.startsWith('/')) throw new Error('Domain-root asset URL breaks project Pages: ' + file + ' -> ' + ref);
    ref = ref.split(/[?#]/)[0];
    const target = posix.normalize(posix.join(posix.dirname(file), ref));
    if (target.startsWith('../') || !files.has(target)) throw new Error('Missing or wrongly cased asset: ' + file + ' -> ' + ref);
    references++;
  }
  const index = await readFile(resolve(directory, 'index.html'), 'utf8');
  if (/(?:\/src\/|\.tsx?(?:["'?#]|$))/.test(index)) throw new Error('Source TypeScript leaked into the published HTML. Run the Vite build.');
  if (index.includes('dist/index.html')) throw new Error('Published HTML still contains a source-preview redirect.');
  const react = /id=["']root["']/.test(index);
  if (react && !/<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'][^"']+\.js(?:\?[^"']*)?["'])[^>]*>/i.test(index)) throw new Error('Built React entry module is missing.');
  for (const file of files) {
    if (!/\.(?:html|css|m?js)$/.test(file)) continue;
    const text = await readFile(resolve(directory, file), 'utf8');
    if (file.endsWith('.html')) {
      for (const tag of text.matchAll(/<(script|link|img)\b[^>]*>/gi)) {
        const src = tag[0].match(/\b(?:src|href)=["']([^"']+)["']/i);
        if (src) check(file, src[1]);
      }
    } else if (file.endsWith('.css')) {
      for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) check(file, match[1]);
    } else {
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)) {
        if (/^\.{1,2}\//.test(match[1])) check(file, match[1]);
      }
    }
  }
  return { files: files.size, references, react, cname };
}

if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPages(resolve(process.argv[2] || 'dist'));
  console.log('Pages artifact verified:', result);
}
