import type pg from 'pg';
import { hashCanonico } from '../domain/hash.js';

export interface BrutoEntrada {
  fonte: string;
  requisicao: unknown;
  resposta: unknown;
  coletadoEm?: Date;
}

export interface BrutoGravado {
  id: number;
  hash: string;
  novo: boolean;
}

type Executor = Pick<pg.Pool | pg.PoolClient, 'query'>;

/**
 * Grava a resposta bruta de uma fonte (C2). O hash cobre fonte + requisição +
 * resposta em JSON canônico; repetir o mesmo conteúdo devolve a linha existente.
 */
export async function gravarBruto(db: Executor, e: BrutoEntrada): Promise<BrutoGravado> {
  const hash = hashCanonico({ fonte: e.fonte, requisicao: e.requisicao, resposta: e.resposta });
  const ins = await db.query<{ id: string }>(
    `INSERT INTO payload_bruto (fonte, requisicao, resposta, hash, coletado_em)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (fonte, hash) DO NOTHING
     RETURNING id`,
    [e.fonte, JSON.stringify(e.requisicao), JSON.stringify(e.resposta), hash, e.coletadoEm ?? new Date()],
  );
  if (ins.rows[0]) return { id: Number(ins.rows[0].id), hash, novo: true };
  const sel = await db.query<{ id: string }>('SELECT id FROM payload_bruto WHERE fonte = $1 AND hash = $2', [
    e.fonte,
    hash,
  ]);
  return { id: Number(sel.rows[0]!.id), hash, novo: false };
}
