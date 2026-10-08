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
  requisicao: { contexto?: { monitoramentoId?: string } } & Record<string, unknown>;
  resposta: unknown;
  coletado_em: Date;
}

const LOTE = 200;

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
          const monId = b.requisicao.contexto?.monitoramentoId;
          const m = monId
            ? (await db.query<{ escritorio_id: string }>('SELECT escritorio_id FROM monitoramento WHERE id = $1', [monId]))
                .rows[0]
            : undefined;
          const r = await ingerirPaginaDjen(db, {
            payloadBrutoId: ultimo,
            resposta: b.resposta,
            coletadoEm: b.coletado_em,
            dono: m && monId ? { escritorioId: m.escritorio_id, monitoramentoId: monId } : undefined,
            emitirEventos: false,
          });
          out.itens += r.itens;
          out.erros += r.erros.length;
        } else {
          const r = await ingerirRespostaDatajud(db, {
            payloadBrutoId: ultimo,
            requisicao: b.requisicao,
            resposta: b.resposta,
            coletadoEm: b.coletado_em,
            emitirEventos: false,
          });
          out.itens += r.movimentos;
        }
      });
      out.paginas++;
    }
  }
}
