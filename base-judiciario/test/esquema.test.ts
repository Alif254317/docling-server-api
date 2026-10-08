import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { migrar } from '../src/db/migrate.js';
import { gravarBruto } from '../src/db/bruto.js';
import { bancoLimpo } from './helpers.js';

let pool: pg.Pool;

beforeAll(async () => {
  pool = await bancoLimpo();
});
afterAll(async () => {
  await pool.end();
});

async function tabelas(): Promise<string[]> {
  const r = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
  );
  return r.rows.map((x) => x.tablename);
}

describe('Spec 001 · esquema canônico', () => {
  it('AC-1 · migrations sobem, descem e sobem de novo', async () => {
    expect(await tabelas()).toContain('comunicacao');
    await migrar(pool, 'up'); // idempotente
    await migrar(pool, 'down');
    expect(await tabelas()).toEqual(['schema_migrations']);
    await migrar(pool, 'up');
    expect(await tabelas()).toEqual(
      expect.arrayContaining([
        'payload_bruto',
        'processo',
        'movimento',
        'comunicacao',
        'prazo',
        'monitoramento',
        'evento',
        'webhook',
        'tribunal',
        'feriado',
      ]),
    );
  });

  it('AC-3 · payload bruto não pode ser alterado nem apagado', async () => {
    const { id } = await gravarBruto(pool, {
      fonte: 'djen',
      requisicao: { q: 1 },
      resposta: { items: [] },
    });
    await expect(pool.query("UPDATE payload_bruto SET fonte = 'x' WHERE id = $1", [id])).rejects.toThrow(
      /imutável/,
    );
    await expect(pool.query('DELETE FROM payload_bruto WHERE id = $1', [id])).rejects.toThrow(/imutável/);
  });

  it('AC-4 · mesmo payload gravado duas vezes vira uma linha', async () => {
    const a = await gravarBruto(pool, { fonte: 'djen', requisicao: { a: 1, b: 2 }, resposta: { x: [1, 2] } });
    // mesmas chaves em outra ordem → mesmo hash canônico
    const b = await gravarBruto(pool, { fonte: 'djen', requisicao: { b: 2, a: 1 }, resposta: { x: [1, 2] } });
    expect(b.id).toBe(a.id);
    expect(a.novo).toBe(true);
    expect(b.novo).toBe(false);
    const n = await pool.query('SELECT count(*)::int AS n FROM payload_bruto WHERE hash = $1', [a.hash]);
    expect(n.rows[0].n).toBe(1);
  });

  it('AC-5 · movimento sem fonte ou coletado_em é recusado', async () => {
    const p = await pool.query(
      `INSERT INTO processo (numero_cnj, tribunal_sigla, fonte, coletado_em)
       VALUES ('50001233120268080024', 'TJES', 'teste', now()) RETURNING id`,
    );
    const pid = p.rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO movimento (processo_id, codigo_tpu, nome, data_hora, hash, coletado_em)
         VALUES ($1, 1, 'x', now(), 'h1', now())`,
        [pid],
      ),
    ).rejects.toThrow(/fonte/);
    await expect(
      pool.query(
        `INSERT INTO movimento (processo_id, codigo_tpu, nome, data_hora, hash, fonte)
         VALUES ($1, 1, 'x', now(), 'h2', 'teste')`,
        [pid],
      ),
    ).rejects.toThrow(/coletado_em/);
  });

  it('recusa número CNJ que não tem 20 dígitos no banco (C1)', async () => {
    await expect(
      pool.query(
        `INSERT INTO processo (numero_cnj, tribunal_sigla, fonte, coletado_em) VALUES ('123', 'TJES', 't', now())`,
      ),
    ).rejects.toThrow();
  });
});
