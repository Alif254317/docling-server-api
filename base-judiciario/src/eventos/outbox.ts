import type pg from 'pg';

export type TipoEvento =
  | 'comunicacao.nova'
  | 'comunicacao.revisao'
  | 'prazo.calculado'
  | 'movimento.novo'
  | 'coleta.falhou';

export interface NovoEvento {
  escritorioId: string;
  tipo: TipoEvento;
  /** Chave de idempotência: o mesmo fato nunca vira dois eventos (spec 004 · FR-1). */
  chave: string;
  dados: Record<string, unknown>;
}

/** Grava o evento na transação do chamador. Devolve `true` se o evento é novo. */
export async function emitirEvento(db: Pick<pg.PoolClient, 'query'>, e: NovoEvento): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO evento (escritorio_id, tipo, chave, dados) VALUES ($1, $2, $3, $4)
     ON CONFLICT (chave) DO NOTHING`,
    [e.escritorioId, e.tipo, e.chave, JSON.stringify(e.dados)],
  );
  return r.rowCount === 1;
}
