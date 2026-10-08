/**
 * Spike 000-datajud: mede o atraso entre a disponibilização no DJEN e o
 * primeiro movimento do DataJud na mesma data ou depois.
 * Uso: DATAJUD_API_KEY=... npm run spike:datajud -- --de relatorios/spike-djen-AAAA-MM-DD.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { DatajudConector } from '../src/connectors/datajud/conector.js';
import { normalizarDatajud } from '../src/connectors/datajud/normalizador.js';
import { normalizarDjen } from '../src/connectors/djen/normalizador.js';
import { hojeSaoPaulo } from '../src/prazos/datas.js';

const { values } = parseArgs({ options: { de: { type: 'string' }, max: { type: 'string', default: '50' } } });
if (!values.de) {
  console.error('uso: npm run spike:datajud -- --de relatorios/spike-djen-AAAA-MM-DD.json');
  process.exit(2);
}
const djen = JSON.parse(await readFile(values.de, 'utf8')) as { itensBrutos: unknown[] };
const { itens } = normalizarDjen({ items: djen.itensBrutos });
const conector = new DatajudConector({ baseUrl: config.datajudBaseUrl, apiKey: config.datajudApiKey });

const medidas: { processo: string; disponibilizacao: string; primeiroMovimentoDepois: string | null; atrasoDias: number | null }[] = [];
const vistos = new Set<string>();
for (const it of itens) {
  if (!it.numeroCnj || vistos.has(it.numeroCnj) || vistos.size >= Number(values.max)) continue;
  vistos.add(it.numeroCnj);
  try {
    for await (const p of conector.buscar({ numeroCnj: it.numeroCnj })) {
      const n = normalizarDatajud(p.resposta);
      const depois = (n?.movimentos ?? [])
        .map((m) => m.dataHora.slice(0, 10))
        .filter((d) => d >= it.dataDisponibilizacao)
        .sort()[0] ?? null;
      const atraso = depois ? (Date.parse(depois) - Date.parse(it.dataDisponibilizacao)) / 86_400_000 : null;
      medidas.push({ processo: it.numeroCnj, disponibilizacao: it.dataDisponibilizacao, primeiroMovimentoDepois: depois, atrasoDias: atraso });
    }
  } catch (e) {
    medidas.push({ processo: it.numeroCnj, disponibilizacao: it.dataDisponibilizacao, primeiroMovimentoDepois: null, atrasoDias: null });
    console.error(`${it.numeroCnj}: ${(e as Error).message}`);
  }
}
const atrasos = medidas.map((m) => m.atrasoDias).filter((x): x is number => x !== null).sort((a, b) => a - b);
const mediana = atrasos.length ? atrasos[Math.floor(atrasos.length / 2)] : null;
const arquivo = `relatorios/spike-datajud-${hojeSaoPaulo()}.json`;
await writeFile(arquivo, JSON.stringify({ processos: medidas.length, comMedida: atrasos.length, medianaDias: mediana, medidas }, null, 2));
console.log(`${medidas.length} processos; ${atrasos.length} com movimento após a disponibilização; mediana ${mediana} dias`);
console.log(`relatório: ${arquivo}`);
