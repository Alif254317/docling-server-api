import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { sha256 } from './hash.js';

export interface EscritorioCriado {
  id: string;
  /** Chave de API em claro; só existe neste retorno. */
  chave: string;
}

export async function criarEscritorio(pool: pg.Pool, nome: string): Promise<EscritorioCriado> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>('INSERT INTO escritorio (nome) VALUES ($1) RETURNING id', [nome]);
    const id = rows[0]!.id;
    const chave = await emitirChave(client, id);
    await client.query('COMMIT');
    return { id, chave };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function emitirChave(db: Pick<pg.PoolClient, 'query'>, escritorioId: string): Promise<string> {
  const chave = `bj_${randomBytes(24).toString('base64url')}`;
  await db.query('INSERT INTO escritorio_api_key (escritorio_id, hash) VALUES ($1, $2)', [escritorioId, sha256(chave)]);
  return chave;
}

/** Escritório dono da chave, ou `null` se a chave não existe ou foi revogada. */
export async function escritorioDaChave(pool: pg.Pool, chave: string): Promise<string | null> {
  const r = await pool.query<{ escritorio_id: string }>(
    'SELECT escritorio_id FROM escritorio_api_key WHERE hash = $1 AND revogado_em IS NULL',
    [sha256(chave)],
  );
  return r.rows[0]?.escritorio_id ?? null;
}
