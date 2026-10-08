// Constituição C10: nenhuma dependência AGPL. GPL gera aviso para revisão.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const raiz = new URL('../node_modules/', import.meta.url).pathname;
const proibidas = [];
const avisos = [];
let total = 0;

function visitar(dir) {
  if (!existsSync(dir)) return;
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.')) continue;
    const caminho = join(dir, nome);
    if (nome.startsWith('@')) {
      visitar(caminho);
      continue;
    }
    const pkg = join(caminho, 'package.json');
    if (!existsSync(pkg)) continue;
    const p = JSON.parse(readFileSync(pkg, 'utf8'));
    total++;
    const lic = typeof p.license === 'string' ? p.license : (p.license?.type ?? (p.licenses ?? []).map((l) => l.type).join(' OR '));
    if (/AGPL/i.test(lic ?? '')) proibidas.push(`${p.name}@${p.version}: ${lic}`);
    else if (/(^|[^L])GPL/i.test(lic ?? '')) avisos.push(`${p.name}@${p.version}: ${lic}`);
    visitar(join(caminho, 'node_modules'));
  }
}

visitar(raiz);
for (const a of avisos) console.warn(`aviso (GPL, revisar): ${a}`);
if (proibidas.length) {
  for (const p of proibidas) console.error(`PROIBIDA (AGPL): ${p}`);
  process.exit(1);
}
console.log(`licenças ok: ${total} pacotes, nenhuma AGPL`);
