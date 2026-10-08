import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
// Chave arbitrária do advisory lock: impede duas instâncias migrando juntas.
const LOCK = 7_340_001;

interface Migration {
  versao: string;
  up: string;
  down: string;
}

async function carregar(): Promise<Migration[]> {
  const arquivos = (await readdir(DIR)).filter((f) => f.endsWith('.up.sql')).sort();
  return Promise.all(
    arquivos.map(async (f) => {
      const versao = f.replace('.up.sql', '');
      return {
        versao,
        up: await readFile(DIR + f, 'utf8'),
        down: await readFile(`${DIR}${versao}.down.sql`, 'utf8'),
      };
    }),
  );
}

/**
 * `up` aplica tudo o que falta, em ordem; `down` reverte tudo (ou só `passos`).
 * Cada migration roda na sua transação.
 */
export async function migrar(pool: pg.Pool, direcao: 'up' | 'down', passos = Infinity): Promise<string[]> {
  const client = await pool.connect();
  const feitas: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (versao text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())',
    );
    const aplicadas = new Set(
      (await client.query<{ versao: string }>('SELECT versao FROM schema_migrations')).rows.map((r) => r.versao),
    );
    const todas = await carregar();
    const fila =
      direcao === 'up'
        ? todas.filter((m) => !aplicadas.has(m.versao))
        : todas.filter((m) => aplicadas.has(m.versao)).reverse();
    for (const m of fila.slice(0, passos)) {
      await client.query('BEGIN');
      try {
        if (direcao === 'up') {
          await client.query(m.up);
          await client.query('INSERT INTO schema_migrations (versao) VALUES ($1)', [m.versao]);
        } else {
          await client.query(m.down);
          await client.query('DELETE FROM schema_migrations WHERE versao = $1', [m.versao]);
        }
        await client.query('COMMIT');
        feitas.push(m.versao);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.versao} (${direcao}) falhou: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => undefined);
    client.release();
  }
  return feitas;
}
