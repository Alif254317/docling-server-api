import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { DatajudConector } from '../src/connectors/datajud/conector.js';
import { DjenConector } from '../src/connectors/djen/conector.js';
import { criarEscritorio } from '../src/domain/escritorios.js';
import { criarMonitoramento } from '../src/domain/monitoramentos.js';
import { criarWebhook } from '../src/eventos/entregador.js';
import { agendarVencidos, conectarRedis, criarFilas, iniciarWorkers, type Filas } from '../src/jobs/filas.js';
import { bancoLimpo, servidorFalso } from './helpers.js';

const djenFixture = JSON.parse(readFileSync(new URL('./fixtures/djen/pagina-oab-12345-es.json', import.meta.url), 'utf8'));
const datajudFixture = JSON.parse(
  readFileSync(new URL('./fixtures/datajud/processo-tjes-3-movimentos.json', import.meta.url), 'utf8'),
);
const vazio = JSON.parse(readFileSync(new URL('./fixtures/datajud/vazio.json', import.meta.url), 'utf8'));

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

async function ate(cond: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condição não atingida a tempo');
}

let pool: pg.Pool;
let redis: Redis;
let filas: Filas;
let workers: { fechar(): Promise<void> };
let fontes: Awaited<ReturnType<typeof servidorFalso>>;
let receptor: Awaited<ReturnType<typeof servidorFalso>>;
const prefixo = `bjtest-${randomUUID()}`;

beforeAll(async () => {
  pool = await bancoLimpo();
  redis = conectarRedis(REDIS_URL);
  filas = criarFilas(redis, prefixo);
  fontes = await servidorFalso((req) => {
    if (req.url.pathname.startsWith('/api/v1/comunicacao')) return { status: 200, body: djenFixture };
    if (req.url.pathname === '/api_publica_tjes/_search') return { status: 200, body: datajudFixture };
    return { status: 200, body: vazio };
  });
  receptor = await servidorFalso(() => ({ status: 200 }));
  workers = await iniciarWorkers({
    pool,
    redis,
    filas,
    prefixo,
    djen: new DjenConector({ baseUrl: fontes.url, http: { esperaBaseMs: 1 } }),
    datajud: new DatajudConector({ baseUrl: fontes.url, apiKey: 'k', http: { esperaBaseMs: 1 } }),
  });
});

afterAll(async () => {
  await workers?.fechar();
  await filas?.manutencao.obliterate({ force: true }).catch(() => undefined);
  await filas?.djen.obliterate({ force: true }).catch(() => undefined);
  await filas?.datajud.obliterate({ force: true }).catch(() => undefined);
  await filas?.fechar();
  redis?.disconnect();
  await fontes?.fechar();
  await receptor?.fechar();
  await pool?.end();
});

describe('Fila de ponta a ponta (specs 002, 003, 004)', () => {
  it('agenda o monitoramento, coleta o DJEN, enriquece no DataJud e entrega os eventos', async () => {
    const esc = (await criarEscritorio(pool, 'Piloto')).id;
    await criarWebhook(pool, esc, `${receptor.url}/hook`);
    await criarMonitoramento(pool, esc, { tipo: 'oab', numero: '12345', uf: 'ES' });

    expect(await agendarVencidos(pool, filas)).toBe(1);
    // agendar de novo no mesmo minuto não duplica: a próxima coleta já foi adiada
    expect(await agendarVencidos(pool, filas)).toBe(0);

    await ate(async () => (await pool.query('SELECT count(*)::int AS n FROM comunicacao')).rows[0].n === 3);
    // processo do TJES enriquecido pelo DataJud
    await ate(async () => (await pool.query('SELECT count(*)::int AS n FROM movimento')).rows[0].n === 3);
    const exec = await pool.query("SELECT situacao FROM execucao_coleta WHERE fonte = 'djen'");
    expect(exec.rows.map((r) => r.situacao)).toEqual(['ok']);

    // entrega dos eventos pelo job de manutenção
    await filas.manutencao.add('entregar-eventos', {});
    await ate(async () => receptor.recebidas.length >= 6);
    const tipos = receptor.recebidas.map((r) => r.headers['x-evento-tipo']).sort();
    expect(tipos.filter((t) => t === 'comunicacao.nova')).toHaveLength(3);
    expect(tipos.filter((t) => t === 'prazo.calculado')).toHaveLength(3);
  });
});
