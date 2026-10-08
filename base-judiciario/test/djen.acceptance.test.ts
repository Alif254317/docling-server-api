import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DjenConector } from '../src/connectors/djen/conector.js';
import { executarColetaDjen } from '../src/ingestao/coleta.js';
import { reprocessar } from '../src/ingestao/reprocessar.js';
import { criarEscritorio } from '../src/domain/escritorios.js';
import { criarMonitoramento } from '../src/domain/monitoramentos.js';
import { bancoLimpo, servidorFalso } from './helpers.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/djen/pagina-oab-12345-es.json', import.meta.url), 'utf8'),
) as { count: number; items: Record<string, unknown>[] };

let pool: pg.Pool;
let djen: Awaited<ReturnType<typeof servidorFalso>>;
let conector: DjenConector;
let escritorioId: string;
let monitoramentoId: string;

const AGORA = new Date('2026-10-05T15:00:00-03:00');

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  return (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, params)).rows[0]!.n;
}

beforeAll(async () => {
  djen = await servidorFalso(() => ({ status: 200, body: fixture }));
  conector = new DjenConector({ baseUrl: djen.url, http: { esperaBaseMs: 1 } });
});
afterAll(async () => {
  await djen.fechar();
});

beforeEach(async () => {
  if (pool) await pool.end();
  pool = await bancoLimpo();
  djen.trocar(() => ({ status: 200, body: fixture }));
  djen.recebidas.length = 0;
  escritorioId = (await criarEscritorio(pool, 'Escritório Piloto')).id;
  monitoramentoId = (await criarMonitoramento(pool, escritorioId, { tipo: 'oab', numero: '12345', uf: 'ES' })).id;
});

describe('Spec 002 · conector DJEN', () => {
  it('AC-1 · 3 intimações viram 3 comunicações e 3 eventos comunicacao.nova', async () => {
    const r = await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    expect(r.situacao).toBe('ok');
    expect(r.itens).toBe(3);
    expect(r.novos).toBe(3);
    expect(await contar('SELECT * FROM comunicacao')).toBe(3);
    expect(await contar("SELECT * FROM evento WHERE tipo = 'comunicacao.nova' AND escritorio_id = $1", [escritorioId])).toBe(3);
    // consulta correta à API
    const q = djen.recebidas[0]!.url;
    expect(q.pathname).toBe('/api/v1/comunicacao');
    expect(q.searchParams.get('numeroOab')).toBe('12345');
    expect(q.searchParams.get('ufOab')).toBe('ES');
    expect(q.searchParams.get('dataDisponibilizacaoInicio')).toBe('2026-10-04');
    expect(q.searchParams.get('dataDisponibilizacaoFim')).toBe('2026-10-05');
    // processo criado e vinculado ao escritório (C8)
    expect(await contar('SELECT * FROM processo_escritorio WHERE escritorio_id = $1', [escritorioId])).toBe(3);
    // data de publicação = 1º dia útil seguinte
    const c = await pool.query("SELECT data_publicacao::text AS p FROM comunicacao WHERE id_djen = 480001");
    expect(c.rows[0].p).toBe('2026-10-06');
    // processos novos ficam para enriquecer no DataJud (spec 003 · FR-7)
    expect(r.processosParaEnriquecer.sort()).toEqual(
      ['00123452520258080001', '10004562320265170001', '50001233120268080024'].sort(),
    );
  });

  it('AC-2 · a mesma intimação na coleta seguinte não duplica nem gera evento', async () => {
    await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    const r2 = await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    expect(r2.situacao).toBe('ok');
    expect(r2.novos).toBe(0);
    expect(await contar('SELECT * FROM comunicacao')).toBe(3);
    expect(await contar("SELECT * FROM evento WHERE tipo = 'comunicacao.nova'")).toBe(3);
    expect(await contar('SELECT * FROM prazo')).toBe(3);
  });

  it('AC-3 · 3 erros seguidos registram falha e emitem coleta.falhou', async () => {
    djen.trocar(() => ({ status: 503, body: { message: 'indisponível' } }));
    const r = await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    expect(r.situacao).toBe('falha');
    expect(djen.recebidas).toHaveLength(3);
    const ex = await pool.query('SELECT situacao, erro FROM execucao_coleta WHERE monitoramento_id = $1', [
      monitoramentoId,
    ]);
    expect(ex.rows[0].situacao).toBe('falha');
    expect(ex.rows[0].erro).toMatch(/503/);
    expect(await contar("SELECT * FROM evento WHERE tipo = 'coleta.falhou' AND escritorio_id = $1", [escritorioId])).toBe(1);
  });

  it('AC-4 · CNJ inválido: bruto guardado, comunicação em revisão, evento comunicacao.revisao', async () => {
    const ruim = { ...fixture.items[0], id: 490001, numero_processo: '50001239920268080024', numeroprocessocommascara: undefined };
    djen.trocar(() => ({ status: 200, body: { count: 1, items: [ruim] } }));
    const r = await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    expect(r.situacao).toBe('ok');
    expect(await contar('SELECT * FROM payload_bruto')).toBe(1);
    const c = await pool.query('SELECT situacao, processo_id, motivo_revisao FROM comunicacao WHERE id_djen = 490001');
    expect(c.rows[0]).toMatchObject({ situacao: 'revisao', processo_id: null });
    expect(c.rows[0].motivo_revisao).toMatch(/dígito verificador/);
    expect(await contar("SELECT * FROM evento WHERE tipo = 'comunicacao.revisao'")).toBe(1);
    // o prazo é calculado mesmo assim, para conferência
    expect(await contar("SELECT * FROM prazo WHERE situacao = 'confirmar'")).toBe(1);
  });

  it('AC-5 · reprocessar o bruto reproduz o normalizado sem eventos novos', async () => {
    await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    const segunda = { ...fixture, items: [{ ...fixture.items[0], texto: 'Texto retificado. Prazo de 10 dias.' }] };
    djen.trocar(() => ({ status: 200, body: segunda }));
    await executarColetaDjen(pool, conector, monitoramentoId, { agora: new Date('2026-10-05T17:00:00-03:00') });

    const foto = async () => ({
      comunicacoes: (
        await pool.query(
          `SELECT id_djen, numero_processo_original, situacao, texto, data_disponibilizacao::text, data_publicacao::text,
                  destinatarios, advogados, coletado_em, payload_bruto_id
             FROM comunicacao ORDER BY id_djen`,
        )
      ).rows,
      processos: (await pool.query('SELECT numero_cnj, tribunal_sigla FROM processo ORDER BY numero_cnj')).rows,
      vinculos: (
        await pool.query(
          `SELECT c.id_djen, ce.escritorio_id FROM comunicacao_escritorio ce JOIN comunicacao c ON c.id = ce.comunicacao_id ORDER BY 1`,
        )
      ).rows,
      prazos: (
        await pool.query(
          `SELECT c.id_djen, p.publicacao::text, p.inicio::text, p.fim::text, p.dias_uteis, p.origem_dias, p.situacao
             FROM prazo p JOIN comunicacao c ON c.id = p.comunicacao_id ORDER BY 1`,
        )
      ).rows,
    });
    const antes = await foto();
    const eventosAntes = await contar('SELECT * FROM evento');
    expect(antes.comunicacoes.find((c) => c.id_djen === '480001')?.texto).toMatch(/retificado/);

    await pool.query('DELETE FROM comunicacao; DELETE FROM processo;');
    expect(await contar('SELECT * FROM comunicacao')).toBe(0);

    const r = await reprocessar(pool, 'djen');
    expect(r.paginas).toBe(2);
    expect(await foto()).toEqual(antes);
    expect(await contar('SELECT * FROM evento')).toBe(eventosAntes);
  });

  it('AC-6 · lê todas as páginas', async () => {
    const itens = Array.from({ length: 5 }, (_, i) => ({ ...fixture.items[0], id: 500000 + i }));
    const pequeno = new DjenConector({ baseUrl: djen.url, itensPorPagina: 2, http: { esperaBaseMs: 1 } });
    djen.trocar((req) => {
      const p = Number(req.url.searchParams.get('pagina'));
      return { status: 200, body: { count: 5, items: itens.slice((p - 1) * 2, p * 2) } };
    });
    const r = await executarColetaDjen(pool, pequeno, monitoramentoId, { agora: AGORA });
    expect(r.itens).toBe(5);
    expect(djen.recebidas.map((x) => x.url.searchParams.get('pagina'))).toEqual(['1', '2', '3']);
    expect(await contar('SELECT * FROM payload_bruto')).toBe(3);
    expect(await contar('SELECT * FROM comunicacao')).toBe(5);
  });

  it('Spec 005 · AC-6 · cada comunicação nova gera prazo e evento prazo.calculado', async () => {
    await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    const p = await pool.query(
      `SELECT c.id_djen, p.fim::text, p.dias_uteis, p.origem_dias, p.situacao
         FROM prazo p JOIN comunicacao c ON c.id = p.comunicacao_id ORDER BY 1`,
    );
    expect(p.rows).toEqual([
      { id_djen: '480001', fim: '2026-10-14', dias_uteis: 5, origem_dias: 'texto', situacao: 'aberto' },
      { id_djen: '480002', fim: '2026-10-28', dias_uteis: 15, origem_dias: 'texto', situacao: 'aberto' },
      { id_djen: '480003', fim: '2026-10-14', dias_uteis: 5, origem_dias: 'padrao', situacao: 'confirmar' },
    ]);
    expect(await contar("SELECT * FROM evento WHERE tipo = 'prazo.calculado'")).toBe(3);
  });

  it('C8 · comunicação de um escritório não vaza para outro que monitora outra OAB', async () => {
    const outro = (await criarEscritorio(pool, 'Outro')).id;
    await criarMonitoramento(pool, outro, { tipo: 'oab', numero: '99999', uf: 'ES' });
    await executarColetaDjen(pool, conector, monitoramentoId, { agora: AGORA });
    expect(await contar('SELECT * FROM comunicacao_escritorio WHERE escritorio_id = $1', [outro])).toBe(0);
    expect(await contar('SELECT * FROM evento WHERE escritorio_id = $1', [outro])).toBe(0);
  });
});
