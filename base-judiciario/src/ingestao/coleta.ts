import type pg from 'pg';
import type { AlvoDjen, DjenConector } from '../connectors/djen/conector.js';
import { gravarBruto } from '../db/bruto.js';
import { emTransacao } from '../db/transacao.js';
import { buscarMonitoramento } from '../domain/monitoramentos.js';
import { emitirEvento } from '../eventos/outbox.js';
import { log } from '../log.js';
import { contadorExecucoes, contadorItens } from '../metricas.js';
import { hojeSaoPaulo, somarDias } from '../prazos/datas.js';
import { ingerirPaginaDjen } from './djen.js';

export interface ResultadoColeta {
  execucaoId: number;
  situacao: 'ok' | 'falha';
  itens: number;
  novos: number;
  erro?: string;
  processosParaEnriquecer: string[];
}

/** Depois de uma falha, tenta de novo antes do intervalo normal. */
const REPETIR_FALHA_MIN = 10;

/**
 * Spec 002: coleta o DJEN de um monitoramento, página por página. Cada página
 * (bruto + normalizado + eventos) é uma transação; uma falha no meio mantém as
 * páginas já gravadas, e a próxima coleta é idempotente.
 */
export async function executarColetaDjen(
  pool: pg.Pool,
  conector: DjenConector,
  monitoramentoId: string,
  opcoes: { agora?: Date } = {},
): Promise<ResultadoColeta> {
  const agora = opcoes.agora ?? new Date();
  const m = await buscarMonitoramento(pool, monitoramentoId);
  if (!m) throw new Error(`monitoramento ${monitoramentoId} não existe`);

  const ex = await pool.query<{ id: string }>(
    `INSERT INTO execucao_coleta (monitoramento_id, fonte, iniciado_em, situacao) VALUES ($1, 'djen', $2, 'rodando') RETURNING id`,
    [m.id, agora],
  );
  const execucaoId = Number(ex.rows[0]!.id);
  const hoje = hojeSaoPaulo(agora);
  const base = { inicio: somarDias(hoje, -1), fim: hoje, contexto: { monitoramentoId: m.id } };
  const alvo: AlvoDjen =
    m.tipo === 'oab'
      ? { tipo: 'oab', numero: m.oab_numero!, uf: m.oab_uf!, ...base }
      : { tipo: 'processo', numeroCnj: m.numero_cnj!, ...base };

  const res: ResultadoColeta = { execucaoId, situacao: 'ok', itens: 0, novos: 0, processosParaEnriquecer: [] };
  try {
    for await (const pagina of conector.buscar(alvo)) {
      const r = await emTransacao(pool, async (db) => {
        const bruto = await gravarBruto(db, { ...pagina, coletadoEm: agora });
        return ingerirPaginaDjen(db, {
          payloadBrutoId: bruto.id,
          resposta: pagina.resposta,
          coletadoEm: agora,
          dono: { escritorioId: m.escritorio_id, monitoramentoId: m.id },
          emitirEventos: true,
        });
      });
      res.itens += r.itens;
      res.novos += r.novos;
      res.processosParaEnriquecer.push(...r.processos);
      if (r.erros.length) log.warn({ monitoramentoId: m.id, erros: r.erros }, 'itens do DJEN não normalizados');
    }
    await pool.query(
      `UPDATE execucao_coleta SET situacao = 'ok', terminado_em = now(), itens = $2, novos = $3 WHERE id = $1`,
      [execucaoId, res.itens, res.novos],
    );
    await pool.query(
      `UPDATE monitoramento SET proxima_coleta_em = $2::timestamptz + make_interval(mins => frequencia_min) WHERE id = $1`,
      [m.id, agora],
    );
    contadorItens.inc({ fonte: 'djen', novo: 'sim' }, res.novos);
    contadorItens.inc({ fonte: 'djen', novo: 'nao' }, res.itens - res.novos);
  } catch (e) {
    res.situacao = 'falha';
    res.erro = (e as Error).message;
    await emTransacao(pool, async (db) => {
      await db.query(
        `UPDATE execucao_coleta SET situacao = 'falha', terminado_em = now(), itens = $2, novos = $3, erro = $4 WHERE id = $1`,
        [execucaoId, res.itens, res.novos, res.erro],
      );
      await db.query(
        `UPDATE monitoramento SET proxima_coleta_em = $2::timestamptz + make_interval(mins => LEAST(frequencia_min, $3))
         WHERE id = $1`,
        [m.id, agora, REPETIR_FALHA_MIN],
      );
      await emitirEvento(db, {
        escritorioId: m.escritorio_id,
        tipo: 'coleta.falhou',
        chave: `coleta.falhou:${execucaoId}`,
        dados: { fonte: 'djen', monitoramentoId: m.id, execucaoId, erro: res.erro },
      });
    });
    log.error({ monitoramentoId: m.id, execucaoId, erro: res.erro }, 'coleta do DJEN falhou');
  }
  contadorExecucoes.inc({ fonte: 'djen', situacao: res.situacao });
  res.processosParaEnriquecer = [...new Set(res.processosParaEnriquecer)];
  return res;
}
