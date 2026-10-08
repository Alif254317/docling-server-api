import type pg from 'pg';
import { emTransacao } from '../db/transacao.js';
import { ingerirPaginaDjen } from './djen.js';
import { ingerirRespostaDatajud } from './datajud.js';

export interface ResultadoReprocessamento {
  paginas: number;
  itens: number;
  erros: number;
}

interface LinhaBruto {
  id: string;
  requisicao: {
    contexto?: { monitoramentoId?: string; escritorioId?: string; gerarPrazos?: boolean };
  } & Record<string, unknown>;
  resposta: unknown;
  coletado_em: Date;
}

const LOTE = 200;

/**
 * Dono gravado no contexto da requisição. O escritório basta para religar o
 * vínculo; o monitoramento só entra se ainda existir.
 */
async function donoDoContexto(db: pg.PoolClient, ctx: LinhaBruto['requisicao']['contexto']) {
  if (!ctx?.escritorioId) return undefined;
  const esc = await db.query('SELECT 1 FROM escritorio WHERE id = $1', [ctx.escritorioId]);
  if (!esc.rowCount) return undefined;
  const mon = ctx.monitoramentoId
    ? await db.query('SELECT 1 FROM monitoramento WHERE id = $1', [ctx.monitoramentoId])
    : { rowCount: 0 };
  return {
    escritorioId: ctx.escritorioId,
    monitoramentoId: mon.rowCount ? ctx.monitoramentoId! : null,
    gerarPrazos: ctx.gerarPrazos ?? true,
  };
}

/**
 * Constituição C3: refaz o normalizado de uma fonte a partir do bruto, na ordem
 * em que foi coletado. Não emite eventos (spec 002 · FR-8).
 */
export async function reprocessar(pool: pg.Pool, fonte: 'djen' | 'datajud'): Promise<ResultadoReprocessamento> {
  const out: ResultadoReprocessamento = { paginas: 0, itens: 0, erros: 0 };
  let ultimo = 0;
  for (;;) {
    const { rows } = await pool.query<LinhaBruto>(
      'SELECT id, requisicao, resposta, coletado_em FROM payload_bruto WHERE fonte = $1 AND id > $2 ORDER BY id LIMIT $3',
      [fonte, ultimo, LOTE],
    );
    if (rows.length === 0) return out;
    for (const b of rows) {
      ultimo = Number(b.id);
      await emTransacao(pool, async (db) => {
        if (fonte === 'djen') {
          const r = await ingerirPaginaDjen(db, {
            payloadBrutoId: ultimo,
            resposta: b.resposta,
            coletadoEm: b.coletado_em,
            dono: await donoDoContexto(db, b.requisicao.contexto),
            emitirEventos: false,
          });
          out.itens += r.itens;
          out.erros += r.erros.length;
        } else {
          const dono = await donoDoContexto(db, b.requisicao.contexto);
          const r = await ingerirRespostaDatajud(db, {
            payloadBrutoId: ultimo,
            requisicao: b.requisicao,
            resposta: b.resposta,
            coletadoEm: b.coletado_em,
            emitirEventos: false,
            dono: dono ? { escritorioId: dono.escritorioId } : undefined,
          });
          out.itens += r.movimentos;
        }
      });
      out.paginas++;
    }
  }
}
