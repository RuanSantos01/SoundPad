/* Servidor estático simples para testar no iPhone pela rede local.
 *   node serve.mjs [porta]
 * Imprime o endereço a abrir no Safari do iPhone (mesmo Wi-Fi). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.argv[2]) || 8000;
const ROOT = import.meta.dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`\n  SoundPad no ar\n`);
  console.log(`  neste Mac:   http://localhost:${PORT}`);
  lan.forEach(ip => console.log(`  no iPhone:   http://${ip}:${PORT}`));
  console.log(`\n  (iPhone precisa estar no mesmo Wi-Fi)\n`);
});
