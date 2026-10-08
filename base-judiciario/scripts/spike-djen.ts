/**
 * Spike 000-djen: confere a premissa P1 da spec 002 contra a API Comunica real.
 * Uso: npm run spike:djen -- --oab 12345 --uf ES [--dias 30]
 * Sai com código 1 se algum item não normalizar.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { DjenConector } from '../src/connectors/djen/conector.js';
import { normalizarDjen } from '../src/connectors/djen/normalizador.js';
import { hojeSaoPaulo, somarDias } from '../src/prazos/datas.js';

const { values } = parseArgs({
  options: { oab: { type: 'string' }, uf: { type: 'string' }, dias: { type: 'string', default: '30' } },
});
if (!values.oab || !values.uf) {
  console.error('uso: npm run spike:djen -- --oab 12345 --uf ES [--dias 30]');
  process.exit(2);
}

const conector = new DjenConector({ baseUrl: config.djenBaseUrl });
const hoje = hojeSaoPaulo();
const camposVistos = new Map<string, number>();
const itens: unknown[] = [];
const erros: { data: string; indice: number; motivo: string }[] = [];
const porDia: Record<string, number> = {};
let paginas = 0;
const t0 = Date.now();

for (let i = Number(values.dias) - 1; i >= 0; i--) {
  const dia = somarDias(hoje, -i);
  for await (const p of conector.buscar({ tipo: 'oab', numero: values.oab, uf: values.uf.toUpperCase(), inicio: dia, fim: dia })) {
    paginas++;
    const brutos = (p.resposta as { items: Record<string, unknown>[] }).items;
    for (const it of brutos) for (const k of Object.keys(it)) camposVistos.set(k, (camposVistos.get(k) ?? 0) + 1);
    const n = normalizarDjen(p.resposta);
    itens.push(...brutos);
    porDia[dia] = (porDia[dia] ?? 0) + n.itens.length;
    erros.push(...n.erros.map((e) => ({ data: dia, ...e })));
  }
}

const relatorio = {
  geradoEm: new Date().toISOString(),
  oab: `${values.oab}/${values.uf}`,
  dias: Number(values.dias),
  paginas,
  itens: itens.length,
  segundos: (Date.now() - t0) / 1000,
  porDia,
  camposVistos: Object.fromEntries([...camposVistos].sort()),
  erros,
  amostra: itens.slice(0, 3),
  itensBrutos: itens,
};
await mkdir('relatorios', { recursive: true });
const arquivo = `relatorios/spike-djen-${hoje}.json`;
await writeFile(arquivo, JSON.stringify(relatorio, null, 2));
console.log(`${itens.length} itens em ${paginas} páginas, ${relatorio.segundos}s; ${erros.length} erros de normalização`);
console.log(`campos vistos: ${[...camposVistos.keys()].sort().join(', ')}`);
console.log(`relatório: ${arquivo}`);
process.exit(erros.length ? 1 : 0);
