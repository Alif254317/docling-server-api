import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { criarApp } from '../src/api/app.js';
import { DjenConector } from '../src/connectors/djen/conector.js';
import { criarEscritorio } from '../src/domain/escritorios.js';
import { executarColetaDjen } from '../src/ingestao/coleta.js';
import { contadorExecucoes } from '../src/metricas.js';
import { bancoLimpo, servidorFalso } from './helpers.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/djen/pagina-oab-12345-es.json', import.meta.url), 'utf8'));

let pool: pg.Pool;
let app: FastifyInstance;
let djen: Awaited<ReturnType<typeof servidorFalso>>;
let A: { id: string; chave: string };
let B: { id: string; chave: string };

const auth = (c: string) => ({ authorization: `Bearer ${c}` });

beforeAll(async () => {
  pool = await bancoLimpo();
  app = await criarApp({ pool });
  djen = await servidorFalso(() => ({ status: 200, body: fixture }));
  A = await criarEscritorio(pool, 'A');
  B = await criarEscritorio(pool, 'B');
});
afterAll(async () => {
  await app.close();
  await djen.fechar();
  await pool.end();
});

describe('Spec 013 · API interna', () => {
  it('FR-7 · /saude responde sem autenticação', async () => {
    const r = await app.inject({ method: 'GET', url: '/saude' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, banco: 'ok' });
  });

  it('AC-1 · sem chave ou chave inválida → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/monitoramentos' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/monitoramentos', headers: auth('bj_inexistente') })).statusCode,
    ).toBe(401);
  });

  it('AC-3 · monitoramento inválido → 400; repetido → 409', async () => {
    const ruim = await app.inject({
      method: 'POST',
      url: '/monitoramentos',
      headers: auth(A.chave),
      payload: { tipo: 'oab', numero: '12345', uf: 'XX' },
    });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().erro).toMatch(/UF/);
    const cnjRuim = await app.inject({
      method: 'POST',
      url: '/monitoramentos',
      headers: auth(A.chave),
      payload: { tipo: 'processo', numeroCnj: '5000123-99.2026.8.08.0024' },
    });
    expect(cnjRuim.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: '/monitoramentos',
      headers: auth(A.chave),
      payload: { tipo: 'oab', numero: '12345', uf: 'es' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ tipo: 'oab', oabNumero: '12345', oabUf: 'ES' });
    const dup = await app.inject({
      method: 'POST',
      url: '/monitoramentos',
      headers: auth(A.chave),
      payload: { tipo: 'oab', numero: '012345', uf: 'ES' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('AC-2 · escritório B não vê nada de A', async () => {
    const mon = (await app.inject({ method: 'GET', url: '/monitoramentos', headers: auth(A.chave) })).json();
    expect(mon).toHaveLength(1);
    await executarColetaDjen(pool, new DjenConector({ baseUrl: djen.url }), mon[0].id, {
      agora: new Date('2026-10-05T15:00:00-03:00'),
    });

    const doA = (await app.inject({ method: 'GET', url: '/comunicacoes', headers: auth(A.chave) })).json();
    expect(doA).toHaveLength(3);
    const proc = await app.inject({
      method: 'GET',
      url: '/processos/5000123-31.2026.8.08.0024',
      headers: auth(A.chave),
    });
    expect(proc.statusCode).toBe(200);
    expect(proc.json()).toMatchObject({ numeroCnj: '5000123-31.2026.8.08.0024', tribunal: 'TJES' });
    expect(proc.json().comunicacoes).toHaveLength(1);
    const prazosA = (await app.inject({ method: 'GET', url: '/prazos', headers: auth(A.chave) })).json();
    expect(prazosA).toHaveLength(3);
    const evA = (await app.inject({ method: 'GET', url: '/eventos', headers: auth(A.chave) })).json();
    expect(evA.length).toBeGreaterThanOrEqual(6);

    for (const url of ['/comunicacoes', '/prazos', '/eventos', '/monitoramentos']) {
      const r = await app.inject({ method: 'GET', url, headers: auth(B.chave) });
      expect(r.statusCode, url).toBe(200);
      expect(r.json(), url).toEqual([]);
    }
    const procB = await app.inject({
      method: 'GET',
      url: '/processos/5000123-31.2026.8.08.0024',
      headers: auth(B.chave),
    });
    expect(procB.statusCode).toBe(404);
    const del = await app.inject({ method: 'DELETE', url: `/monitoramentos/${mon[0].id}`, headers: auth(B.chave) });
    expect(del.statusCode).toBe(404);
  });

  it('FR-5/FR-6 · eventos confirmados pela API saem da lista de pendentes', async () => {
    const pend = (
      await app.inject({ method: 'GET', url: '/eventos?situacao=pendente', headers: auth(A.chave) })
    ).json() as { id: string }[];
    const ids = pend.slice(0, 2).map((e) => e.id);
    const conf = await app.inject({
      method: 'POST',
      url: '/eventos/confirmacoes',
      headers: auth(A.chave),
      payload: { ids },
    });
    expect(conf.json()).toEqual({ confirmados: 2 });
    // B não confirma eventos de A
    const confB = await app.inject({
      method: 'POST',
      url: '/eventos/confirmacoes',
      headers: auth(B.chave),
      payload: { ids: pend.slice(2).map((e) => e.id) },
    });
    expect(confB.json()).toEqual({ confirmados: 0 });
    const depois = (
      await app.inject({ method: 'GET', url: '/eventos?situacao=pendente', headers: auth(A.chave) })
    ).json();
    expect(depois).toHaveLength(pend.length - 2);
  });

  it('FR-5 · webhook devolve o segredo uma vez e não o lista depois', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: auth(A.chave),
      payload: { url: 'https://sistema.exemplo/hook' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().segredo).toMatch(/^[0-9a-f]{64}$/);
    const lista = (await app.inject({ method: 'GET', url: '/webhooks', headers: auth(A.chave) })).json();
    expect(lista).toHaveLength(1);
    expect(lista[0].segredo).toBeUndefined();
    const ruim = await app.inject({
      method: 'POST',
      url: '/webhooks',
      headers: auth(A.chave),
      payload: { url: 'ftp://x' },
    });
    expect(ruim.statusCode).toBe(400);
  });

  it('AC-4 · cálculo avulso de prazo', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/prazos/calcular',
      headers: auth(A.chave),
      payload: { dataDisponibilizacao: '2026-10-05', dias: 15, tribunal: 'TJES' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ publicacao: '2026-10-06', inicio: '2026-10-07', fim: '2026-10-28' });
    const comTexto = await app.inject({
      method: 'POST',
      url: '/prazos/calcular',
      headers: auth(A.chave),
      payload: { dataDisponibilizacao: '2026-10-05', texto: 'no prazo de 5 (cinco) dias' },
    });
    expect(comTexto.json()).toMatchObject({ dias: 5, origemDias: 'texto', fim: '2026-10-14' });
    const ruim = await app.inject({
      method: 'POST',
      url: '/prazos/calcular',
      headers: auth(A.chave),
      payload: { dataDisponibilizacao: '05/10/2026', dias: 5 },
    });
    expect(ruim.statusCode).toBe(400);
  });

  it('AC-5 · /metricas expõe coleta_execucoes_total', async () => {
    contadorExecucoes.inc({ fonte: 'djen', situacao: 'ok' }, 0);
    const r = await app.inject({ method: 'GET', url: '/metricas' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/coleta_execucoes_total\{fonte="djen",situacao="ok"\}/);
  });
});
