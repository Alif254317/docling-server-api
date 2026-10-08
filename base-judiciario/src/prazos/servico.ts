import type pg from 'pg';
import { emitirEvento } from '../eventos/outbox.js';
import { calcularPrazo } from './calculo.js';
import { extrairDias } from './extrair.js';

type Db = Pick<pg.PoolClient, 'query'>;

/** Feriados cadastrados para o tribunal e os nacionais cadastrados (data → descrição), além dos calculados. */
export async function feriadosDoTribunal(db: Db, sigla: string | null): Promise<Map<string, string>> {
  const r = await db.query<{ data: string; descricao: string }>(
    'SELECT data::text AS data, descricao FROM feriado WHERE tribunal_sigla IS NULL OR tribunal_sigla = $1',
    [sigla],
  );
  return new Map(r.rows.map((x) => [x.data, x.descricao]));
}

export interface ComunicacaoParaPrazo {
  id: number;
  idDjen: number;
  dataDisponibilizacao: string;
  texto: string;
  situacao: 'ok' | 'revisao';
  numeroProcesso: string;
}

/**
 * Spec 005 · FR-4: um prazo por comunicação e escritório. Não recalcula prazo
 * existente. Devolve `true` se criou.
 */
export async function gerarPrazo(
  db: Db,
  c: ComunicacaoParaPrazo,
  escritorioId: string,
  feriados: ReadonlyMap<string, string>,
  emitirEventos: boolean,
): Promise<boolean> {
  const dias = extrairDias(c.texto);
  const r = calcularPrazo({ disponibilizacao: c.dataDisponibilizacao, dias: dias.dias, feriadosExtras: feriados });
  const situacao = dias.confirmar || c.situacao === 'revisao' ? 'confirmar' : 'aberto';
  const ins = await db.query(
    `INSERT INTO prazo (comunicacao_id, escritorio_id, publicacao, inicio, fim, dias_uteis, origem_dias, regra, situacao, detalhes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (comunicacao_id, escritorio_id) DO NOTHING`,
    [
      c.id,
      escritorioId,
      r.publicacao,
      r.inicio,
      r.fim,
      r.dias,
      dias.origem,
      r.regra,
      situacao,
      JSON.stringify({ diasPulados: r.diasPulados }),
    ],
  );
  if (ins.rowCount !== 1) return false;
  if (emitirEventos) {
    await emitirEvento(db, {
      escritorioId,
      tipo: 'prazo.calculado',
      chave: `prazo.calculado:${c.idDjen}:${escritorioId}`,
      dados: {
        idDjen: c.idDjen,
        numeroProcesso: c.numeroProcesso,
        publicacao: r.publicacao,
        inicio: r.inicio,
        fim: r.fim,
        diasUteis: r.dias,
        origemDias: dias.origem,
        situacao,
      },
    });
  }
  return true;
}
