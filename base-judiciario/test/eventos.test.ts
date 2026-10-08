import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { criarEscritorio } from '../src/domain/escritorios.js';
import { entregarLote, criarWebhook, ESPERAS_MIN, MAX_TENTATIVAS } from '../src/eventos/entregador.js';
import { emitirEvento } from '../src/eventos/outbox.js';
import { bancoLimpo, servidorFalso } from './helpers.js';

let pool: pg.Pool;
let receptor: Awaited<ReturnType<typeof servidorFalso>>;
let esc: string;
let segredo: string;

async function evento(n: number, escritorioId = esc) {
  await emitirEvento(pool, {
    escritorioId,
    tipo: 'comunicacao.nova',
    chave: `teste:${escritorioId}:${n}`,
    dados: { n },
  });
}

beforeAll(async () => {
  receptor = await servidorFalso(() => ({ status: 200 }));
});
afterAll(async () => {
  await receptor.fechar();
  await pool?.end();
});
beforeEach(async () => {
  if (pool) await pool.end();
  pool = await bancoLimpo();
  receptor.recebidas.length = 0;
  receptor.trocar(() => ({ status: 200 }));
  esc = (await criarEscritorio(pool, 'E')).id;
  segredo = (await criarWebhook(pool, esc, `${receptor.url}/webhook`)).segredo;
});

describe('Spec 004 · motor de eventos', () => {
  it('FR-1 · a mesma chave não cria dois eventos', async () => {
    await evento(1);
    await evento(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM evento')).rows[0].n).toBe(1);
  });

  it('AC-1 · entrega com assinatura HMAC válida e marca entregue', async () => {
    await evento(1);
    const r = await entregarLote(pool);
    expect(r).toMatchObject({ entregues: 1, falhas: 0 });
    const req = receptor.recebidas[0]!;
    expect(req.method).toBe('POST');
    const esperado = 'sha256=' + createHmac('sha256', segredo).update(req.body).digest('hex');
    expect(req.headers['x-assinatura']).toBe(esperado);
    expect(req.headers['x-evento-tipo']).toBe('comunicacao.nova');
    const corpo = JSON.parse(req.body);
    expect(corpo).toMatchObject({ tipo: 'comunicacao.nova', dados: { n: 1 } });
    expect(String(corpo.id)).toBe(req.headers['x-evento-id']);
    const ev = await pool.query('SELECT situacao, tentativas, entregue_em FROM evento');
    expect(ev.rows[0]).toMatchObject({ situacao: 'entregue', tentativas: 1 });
    expect(ev.rows[0].entregue_em).not.toBeNull();
    // não reenvia
    await entregarLote(pool);
    expect(receptor.recebidas).toHaveLength(1);
  });

  it('AC-2 · 500 deixa pendente com nova tentativa no futuro', async () => {
    receptor.trocar(() => ({ status: 500 }));
    await evento(1);
    const agora = new Date();
    const r = await entregarLote(pool, { agora });
    expect(r).toMatchObject({ entregues: 0, falhas: 1 });
    const ev = await pool.query('SELECT situacao, tentativas, proxima_tentativa_em, ultimo_erro FROM evento');
    expect(ev.rows[0].situacao).toBe('pendente');
    expect(ev.rows[0].tentativas).toBe(1);
    expect(ev.rows[0].ultimo_erro).toMatch(/500/);
    expect(new Date(ev.rows[0].proxima_tentativa_em).getTime()).toBeGreaterThanOrEqual(
      agora.getTime() + ESPERAS_MIN[0]! * 60_000 - 1000,
    );
    // ainda não venceu: não tenta de novo
    await entregarLote(pool, { agora });
    expect(receptor.recebidas).toHaveLength(1);
  });

  it('AC-3 · a 10ª falha deixa o evento morto', async () => {
    receptor.trocar(() => ({ status: 503 }));
    await evento(1);
    await pool.query('UPDATE evento SET tentativas = $1', [MAX_TENTATIVAS - 1]);
    await entregarLote(pool);
    const ev = await pool.query('SELECT situacao, tentativas FROM evento');
    expect(ev.rows[0]).toEqual({ situacao: 'morto', tentativas: MAX_TENTATIVAS });
  });

  it('AC-4 · dois entregadores simultâneos enviam cada evento exatamente uma vez', async () => {
    receptor.trocar(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { status: 200 };
    });
    for (let i = 0; i < 20; i++) await evento(i);
    await Promise.all([entregarLote(pool, { limite: 20 }), entregarLote(pool, { limite: 20 })]);
    const ids = receptor.recebidas.map((r) => r.headers['x-evento-id']);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect((await pool.query("SELECT count(*)::int AS n FROM evento WHERE situacao = 'entregue'")).rows[0].n).toBe(20);
  });

  it('C8 · evento de um escritório não vai para o webhook de outro', async () => {
    const outro = (await criarEscritorio(pool, 'Outro')).id;
    await evento(1, outro);
    await entregarLote(pool);
    expect(receptor.recebidas).toHaveLength(0);
  });

  it('FR-6 · escritório sem webhook: evento fica pendente para consulta pela API', async () => {
    const semHook = (await criarEscritorio(pool, 'Sem')).id;
    await evento(1, semHook);
    const r = await entregarLote(pool);
    expect(r.entregues).toBe(0);
    const ev = await pool.query('SELECT situacao, tentativas FROM evento WHERE escritorio_id = $1', [semHook]);
    expect(ev.rows[0]).toEqual({ situacao: 'pendente', tentativas: 0 });
  });
});
