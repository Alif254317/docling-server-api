/**
 * Regressões dos achados da revisão independente (2026-10-08). Cada teste
 * reproduz o cenário relatado e falhava antes da correção.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DjenConector } from '../src/connectors/djen/conector.js';
import { parseDataHoraDatajud } from '../src/connectors/datajud/normalizador.js';
import { requisitarJson, HTTP_PADRAO } from '../src/connectors/http.js';
import { criarEscritorio } from '../src/domain/escritorios.js';
import { criarMonitoramento, MonitoramentoInvalido } from '../src/domain/monitoramentos.js';
import { criarWebhook, entregarLote } from '../src/eventos/entregador.js';
import { emitirEvento } from '../src/eventos/outbox.js';
import { executarColetaDjen, JANELA_MAX_DIAS } from '../src/ingestao/coleta.js';
import { reprocessar } from '../src/ingestao/reprocessar.js';
import { bancoLimpo, servidorFalso } from './helpers.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/djen/pagina-oab-12345-es.json', import.meta.url), 'utf8'),
) as { count: number; items: Record<string, unknown>[] };

let pool: pg.Pool;
let srv: Awaited<ReturnType<typeof servidorFalso>>;
let djen: DjenConector;
let esc: string;

const n = async (sql: string, p: unknown[] = []) =>
  (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) t`, p)).rows[0]!.n;

beforeAll(async () => {
  srv = await servidorFalso(() => ({ status: 200, body: fixture }));
  djen = new DjenConector({ baseUrl: srv.url, http: { esperaBaseMs: 1 } });
});
afterAll(async () => {
  await srv.fechar();
  await pool?.end();
});
beforeEach(async () => {
  if (pool) await pool.end();
  pool = await bancoLimpo();
  srv.trocar(() => ({ status: 200, body: fixture }));
  srv.recebidas.length = 0;
  esc = (await criarEscritorio(pool, 'E')).id;
});

describe('Revisão · janela de coleta (achado 3)', () => {
  it('depois de dias sem sucesso, a janela começa na véspera da última coleta boa', async () => {
    const m = await criarMonitoramento(pool, esc, { tipo: 'oab', numero: '12345', uf: 'ES' });
    await pool.query(
      `INSERT INTO execucao_coleta (monitoramento_id, fonte, iniciado_em, situacao) VALUES ($1, 'djen', '2026-10-01T12:00:00-03:00', 'ok'),
              ($1, 'djen', '2026-10-03T12:00:00-03:00', 'falha')`,
      [m.id],
    );
    await executarColetaDjen(pool, djen, m.id, { agora: new Date('2026-10-05T10:00:00-03:00') });
    expect(srv.recebidas[0]!.url.searchParams.get('dataDisponibilizacaoInicio')).toBe('2026-09-30');
    expect(srv.recebidas[0]!.url.searchParams.get('dataDisponibilizacaoFim')).toBe('2026-10-05');
  });

  it(`janela recua no máximo ${JANELA_MAX_DIAS} dias`, async () => {
    const m = await criarMonitoramento(pool, esc, { tipo: 'oab', numero: '12345', uf: 'ES' });
    await pool.query(
      `INSERT INTO execucao_coleta (monitoramento_id, fonte, iniciado_em, situacao) VALUES ($1, 'djen', '2026-07-01T12:00:00-03:00', 'ok')`,
      [m.id],
    );
    await executarColetaDjen(pool, djen, m.id, { agora: new Date('2026-10-05T10:00:00-03:00') });
    expect(srv.recebidas[0]!.url.searchParams.get('dataDisponibilizacaoInicio')).toBe('2026-09-05');
  });

  it('frequência acima de 1 dia é recusada', async () => {
    await expect(criarMonitoramento(pool, esc, { tipo: 'oab', numero: '1', uf: 'ES', frequenciaMin: 4320 })).rejects.toThrow(
      MonitoramentoInvalido,
    );
  });
});

describe('Revisão · data inexistente não derruba a página (achado 4)', () => {
  it('3 itens válidos e 1 com 30/02 → 3 comunicações e coleta ok', async () => {
    const ruim = { ...fixture.items[0], id: 999, data_disponibilizacao: '2026-02-30' };
    srv.trocar(() => ({ status: 200, body: { count: 4, items: [...fixture.items, ruim] } }));
    const m = await criarMonitoramento(pool, esc, { tipo: 'oab', numero: '12345', uf: 'ES' });
    const r = await executarColetaDjen(pool, djen, m.id, { agora: new Date('2026-10-05T15:00:00-03:00') });
    expect(r.situacao).toBe('ok');
    expect(await n('SELECT * FROM comunicacao')).toBe(3);
  });
});

describe('Revisão · reprocessamento sem o monitoramento (achado 5)', () => {
  it('vínculos e prazos voltam mesmo com o monitoramento apagado', async () => {
    const m = await criarMonitoramento(pool, esc, { tipo: 'oab', numero: '12345', uf: 'ES' });
    await executarColetaDjen(pool, djen, m.id, { agora: new Date('2026-10-05T15:00:00-03:00') });
    await pool.query('DELETE FROM monitoramento WHERE id = $1', [m.id]);
    await pool.query('DELETE FROM comunicacao; DELETE FROM processo;');
    await reprocessar(pool, 'djen');
    expect(await n('SELECT * FROM comunicacao_escritorio WHERE escritorio_id = $1', [esc])).toBe(3);
    expect(await n('SELECT * FROM prazo WHERE escritorio_id = $1', [esc])).toBe(3);
    expect(await n('SELECT * FROM processo_escritorio WHERE escritorio_id = $1', [esc])).toBe(3);
  });
});

describe('Revisão · monitoramento por processo não gera prazo (achado 6)', () => {
  it('intimações do processo chegam como comunicação e evento, sem prazo', async () => {
    srv.trocar(() => ({ status: 200, body: { count: 1, items: [fixture.items[0]] } }));
    const m = await criarMonitoramento(pool, esc, { tipo: 'processo', numeroCnj: '5000123-31.2026.8.08.0024' });
    await executarColetaDjen(pool, djen, m.id, { agora: new Date('2026-10-05T15:00:00-03:00') });
    expect(srv.recebidas[0]!.url.searchParams.get('numeroProcesso')).toBe('50001233120268080024');
    expect(await n('SELECT * FROM comunicacao_escritorio')).toBe(1);
    expect(await n("SELECT * FROM evento WHERE tipo = 'comunicacao.nova'")).toBe(1);
    expect(await n('SELECT * FROM prazo')).toBe(0);
  });
});

describe('Revisão · entregador não regride estado (achado 2)', () => {
  it('entrega concluída por outro entregador após a reserva expirar continua entregue', async () => {
    let liberar!: () => void;
    const segura = new Promise<void>((r) => (liberar = r));
    let chamadas = 0;
    const receptor = await servidorFalso(async () => {
      chamadas++;
      if (chamadas === 1) {
        await segura; // A fica preso e depois falha
        return { status: 500 };
      }
      return { status: 200 }; // B entrega
    });
    try {
      await criarWebhook(pool, esc, `${receptor.url}/h`);
      await emitirEvento(pool, { escritorioId: esc, tipo: 'comunicacao.nova', chave: 'x', dados: {} });
      const t = new Date();
      const a = entregarLote(pool, { agora: t });
      while (chamadas < 1) await new Promise((r) => setTimeout(r, 10));
      const b = await entregarLote(pool, { agora: new Date(t.getTime() + 6 * 60_000) });
      expect(b.entregues).toBe(1);
      liberar();
      await a;
      const ev = await pool.query('SELECT situacao FROM evento');
      expect(ev.rows[0].situacao).toBe('entregue');
    } finally {
      await receptor.fechar();
    }
  });
});

describe('Revisão · data-hora do DataJud independe do fuso do servidor (achado 9)', () => {
  it('ISO sem fuso é horário de Brasília', () => {
    expect(parseDataHoraDatajud('2026-01-15T10:30:00')).toBe('2026-01-15T13:30:00.000Z');
    expect(parseDataHoraDatajud('2026-01-15T10:30:00.000Z')).toBe('2026-01-15T10:30:00.000Z');
  });
});

describe('Revisão · feriado nacional cadastrado vale para o prazo (achado 10)', () => {
  it('feriado com tribunal nulo é pulado', async () => {
    await pool.query("INSERT INTO feriado (data, tribunal_sigla, descricao) VALUES ('2026-10-07', NULL, 'feriado de teste')");
    srv.trocar(() => ({ status: 200, body: { count: 1, items: [fixture.items[0]] } }));
    const m = await criarMonitoramento(pool, esc, { tipo: 'oab', numero: '12345', uf: 'ES' });
    await executarColetaDjen(pool, djen, m.id, { agora: new Date('2026-10-05T15:00:00-03:00') });
    // sem o feriado: início 07/10, fim 14/10; com ele: início 08/10, fim 15/10
    const p = await pool.query('SELECT inicio::text, fim::text FROM prazo');
    expect(p.rows[0]).toEqual({ inicio: '2026-10-08', fim: '2026-10-15' });
  });
});

describe('Revisão · Retry-After acima do teto padrão (achado 11)', () => {
  it('espera o Retry-After pedido mesmo com esperaMaxMs menor', async () => {
    let vez = 0;
    srv.trocar(() => (vez++ === 0 ? { status: 429, headers: { 'retry-after': '1' } } : { status: 200, body: { ok: 1 } }));
    const t0 = Date.now();
    await requisitarJson(`${srv.url}/x`, {}, { ...HTTP_PADRAO, fonte: 't', esperaBaseMs: 1, esperaMaxMs: 1 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });
});
