import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DatajudConector } from '../src/connectors/datajud/conector.js';
import { indiceDatajud, SemIndiceDatajud } from '../src/connectors/datajud/indice.js';
import { normalizarDatajud, parseDataHoraDatajud } from '../src/connectors/datajud/normalizador.js';
import { sincronizarDatajud } from '../src/ingestao/datajud.js';
import { criarEscritorio } from '../src/domain/escritorios.js';
import { criarMonitoramento } from '../src/domain/monitoramentos.js';
import { reprocessar } from '../src/ingestao/reprocessar.js';
import { bancoLimpo, servidorFalso } from './helpers.js';

const ler = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/datajud/${n}`, import.meta.url), 'utf8'));
const TRES = ler('processo-tjes-3-movimentos.json');
const QUATRO = ler('processo-tjes-4-movimentos.json');
const CNJ = '50001233120268080024';

describe('Spec 003 · índice DataJud', () => {
  it('AC-1 · resolve o índice pelo J.TT', () => {
    expect(indiceDatajud('5000123-31.2026.8.08.0024')).toBe('api_publica_tjes');
    expect(indiceDatajud('1000456-23.2026.5.17.0001')).toBe('api_publica_trt17');
    expect(indiceDatajud('5001234-92.2025.4.02.5001')).toBe('api_publica_trf2');
  });

  it('AC-4 · STF não tem índice', () => {
    // 0000001-85.2026.1.00.0000
    expect(() => indiceDatajud('00000018520261000000')).toThrow(SemIndiceDatajud);
  });
});

describe('Spec 003 · normalizador', () => {
  it('aceita os dois formatos de data-hora', () => {
    expect(parseDataHoraDatajud('2026-01-15T10:30:00.000Z')).toBe('2026-01-15T10:30:00.000Z');
    expect(parseDataHoraDatajud('20261005120000')).toBe('2026-10-05T15:00:00.000Z');
  });

  it('extrai capa e movimentos', () => {
    const n = normalizarDatajud(TRES)!;
    expect(n.capa).toMatchObject({
      numeroCnj: CNJ,
      classeCodigo: 7,
      classeNome: 'Procedimento Comum Cível',
      graus: ['G1'],
      orgaoJulgador: { codigo: 1234, nome: '1ª Vara Cível de Vitória' },
      nivelSigilo: 0,
    });
    expect(n.movimentos).toHaveLength(3);
    expect(new Set(n.movimentos.map((m) => m.hash)).size).toBe(3);
  });

  it('resposta vazia → null', () => {
    expect(normalizarDatajud(ler('vazio.json'))).toBeNull();
  });
});

describe('Spec 003 · conector e ingestão', () => {
  let pool: pg.Pool;
  let srv: Awaited<ReturnType<typeof servidorFalso>>;
  let conector: DatajudConector;
  let esc: string;

  beforeAll(async () => {
    srv = await servidorFalso(() => ({ status: 200, body: TRES }));
    conector = new DatajudConector({ baseUrl: srv.url, apiKey: 'chave-teste', http: { esperaBaseMs: 1 } });
  });
  afterAll(async () => {
    await srv.fechar();
    await pool?.end();
  });
  beforeEach(async () => {
    if (pool) await pool.end();
    pool = await bancoLimpo();
    srv.trocar(() => ({ status: 200, body: TRES }));
    srv.recebidas.length = 0;
    esc = (await criarEscritorio(pool, 'E')).id;
    await criarMonitoramento(pool, esc, { tipo: 'processo', numeroCnj: CNJ });
  });

  it('AC-2 · duas consultas: 3 movimentos, sem duplicar, capa preenchida', async () => {
    await sincronizarDatajud(pool, conector, CNJ, { dono: { escritorioId: esc } });
    await sincronizarDatajud(pool, conector, CNJ, { dono: { escritorioId: esc } });
    const mov = await pool.query('SELECT count(*)::int AS n FROM movimento');
    expect(mov.rows[0].n).toBe(3);
    const p = await pool.query('SELECT classe_nome, tribunal_sigla, fonte, graus FROM processo WHERE numero_cnj = $1', [CNJ]);
    expect(p.rows[0]).toEqual({ classe_nome: 'Procedimento Comum Cível', tribunal_sigla: 'TJES', fonte: 'datajud', graus: ['G1'] });
    const req = srv.recebidas[0]!;
    expect(req.method).toBe('POST');
    expect(req.url.pathname).toBe('/api_publica_tjes/_search');
    expect(req.headers.authorization).toBe('APIKey chave-teste');
    expect(JSON.parse(req.body)).toEqual({ query: { match: { numeroProcesso: CNJ } } });
  });

  it('AC-3 · movimento novo gera 1 evento; a primeira carga não gera', async () => {
    await sincronizarDatajud(pool, conector, CNJ, { dono: { escritorioId: esc } });
    expect((await pool.query("SELECT count(*)::int AS n FROM evento WHERE tipo = 'movimento.novo'")).rows[0].n).toBe(0);
    srv.trocar(() => ({ status: 200, body: QUATRO }));
    const r = await sincronizarDatajud(pool, conector, CNJ, { dono: { escritorioId: esc } });
    expect(r.novos).toBe(1);
    const ev = await pool.query("SELECT escritorio_id, dados FROM evento WHERE tipo = 'movimento.novo'");
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].escritorio_id).toBe(esc);
    expect(ev.rows[0].dados).toMatchObject({ numeroProcesso: CNJ, codigo: 51, nome: 'Conclusão' });
  });

  it('AC-4 · processo do STF é recusado sem chamada HTTP', async () => {
    await expect(sincronizarDatajud(pool, conector, '00000018520261000000', {})).rejects.toThrow(SemIndiceDatajud);
    expect(srv.recebidas).toHaveLength(0);
  });

  it('processo não encontrado não cria nada', async () => {
    srv.trocar(() => ({ status: 200, body: ler('vazio.json') }));
    const r = await sincronizarDatajud(pool, conector, '00123452520258080001', {});
    expect(r.encontrado).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS n FROM processo')).rows[0].n).toBe(0);
  });

  it('C3 · reprocessamento do DataJud reproduz os movimentos', async () => {
    await sincronizarDatajud(pool, conector, CNJ, { dono: { escritorioId: esc } });
    srv.trocar(() => ({ status: 200, body: QUATRO }));
    await sincronizarDatajud(pool, conector, CNJ, { dono: { escritorioId: esc } });
    const foto = async () =>
      (await pool.query('SELECT grau, codigo_tpu, data_hora, hash FROM movimento ORDER BY data_hora, hash')).rows;
    const antes = await foto();
    await pool.query('DELETE FROM movimento');
    await reprocessar(pool, 'datajud');
    expect(await foto()).toEqual(antes);
  });

  it('C9 · a chave não aparece em erro', async () => {
    srv.trocar(() => ({ status: 401, body: { error: 'unauthorized' } }));
    const e = await sincronizarDatajud(pool, conector, CNJ, {}).catch((x: Error) => x);
    expect(String(e)).toMatch(/401/);
    expect(String(e)).not.toMatch(/chave-teste/);
  });
});
