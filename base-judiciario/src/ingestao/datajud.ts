import type pg from 'pg';
import type { DatajudConector } from '../connectors/datajud/conector.js';
import { normalizarDatajud } from '../connectors/datajud/normalizador.js';
import { gravarBruto } from '../db/bruto.js';
import { emTransacao } from '../db/transacao.js';
import { parseCnj } from '../domain/cnj.js';
import { tribunalDoCnj } from '../domain/tribunais.js';
import { emitirEvento } from '../eventos/outbox.js';
import { contadorExecucoes, contadorItens } from '../metricas.js';

type Db = Pick<pg.PoolClient, 'query'>;

export interface RespostaDatajud {
  payloadBrutoId: number;
  requisicao: Record<string, unknown>;
  resposta: unknown;
  coletadoEm: Date;
  emitirEventos: boolean;
  /** Escritório que pediu a sincronização (monitoramento por processo). */
  dono?: { escritorioId: string };
}

export interface ResultadoDatajud {
  encontrado: boolean;
  movimentos: number;
  novos: number;
}

/** Spec 003: grava capa e movimentos; deve rodar na transação que gravou o bruto. */
export async function ingerirRespostaDatajud(db: Db, r: RespostaDatajud): Promise<ResultadoDatajud> {
  const n = normalizarDatajud(r.resposta);
  if (!n) return { encontrado: false, movimentos: 0, novos: 0 };
  const numeroCnj = parseCnj(n.capa.numeroCnj).numero;
  const sigla = tribunalDoCnj(parseCnj(numeroCnj))?.sigla ?? n.capa.tribunal ?? 'DESCONHECIDO';
  const c = n.capa;

  const p = await db.query<{ id: string }>(
    `INSERT INTO processo (numero_cnj, tribunal_sigla, classe_codigo, classe_nome, assuntos, orgao_julgador, graus,
        sistema, formato, nivel_sigilo, data_ajuizamento, ultima_atualizacao_fonte, capa_sincronizada_em,
        fonte, coletado_em, payload_bruto_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'datajud',$13,$14)
     ON CONFLICT (numero_cnj) DO UPDATE SET
       classe_codigo = EXCLUDED.classe_codigo, classe_nome = EXCLUDED.classe_nome, assuntos = EXCLUDED.assuntos,
       orgao_julgador = EXCLUDED.orgao_julgador, graus = EXCLUDED.graus, sistema = EXCLUDED.sistema,
       formato = EXCLUDED.formato, nivel_sigilo = EXCLUDED.nivel_sigilo, data_ajuizamento = EXCLUDED.data_ajuizamento,
       ultima_atualizacao_fonte = EXCLUDED.ultima_atualizacao_fonte, capa_sincronizada_em = EXCLUDED.capa_sincronizada_em,
       fonte = 'datajud', coletado_em = EXCLUDED.coletado_em, payload_bruto_id = EXCLUDED.payload_bruto_id
     RETURNING id`,
    [
      numeroCnj,
      sigla,
      c.classeCodigo,
      c.classeNome,
      JSON.stringify(c.assuntos),
      c.orgaoJulgador ? JSON.stringify(c.orgaoJulgador) : null,
      c.graus,
      c.sistema,
      c.formato,
      c.nivelSigilo,
      c.dataAjuizamento,
      c.ultimaAtualizacao,
      r.coletadoEm,
      r.payloadBrutoId,
    ],
  );
  const processoId = Number(p.rows[0]!.id);

  if (r.dono) {
    await db.query(
      `INSERT INTO processo_escritorio (processo_id, escritorio_id, origem) VALUES ($1, $2, 'monitoramento')
       ON CONFLICT DO NOTHING`,
      [processoId, r.dono.escritorioId],
    );
  }

  const antes = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM movimento WHERE processo_id = $1', [
    processoId,
  ]);
  const primeiraCarga = antes.rows[0]!.n === 0;

  const novos: typeof n.movimentos = [];
  for (const m of n.movimentos) {
    const ins = await db.query(
      `INSERT INTO movimento (processo_id, grau, codigo_tpu, nome, data_hora, complementos, hash, fonte, coletado_em, payload_bruto_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'datajud',$8,$9)
       ON CONFLICT (processo_id, hash) DO NOTHING`,
      [processoId, m.grau, m.codigo, m.nome, m.dataHora, JSON.stringify(m.complementos), m.hash, r.coletadoEm, r.payloadBrutoId],
    );
    if (ins.rowCount === 1) novos.push(m);
  }

  // Spec 003 · FR-6: só avisa movimento novo depois da primeira carga.
  if (r.emitirEventos && !primeiraCarga && novos.length) {
    const escritorios = await db.query<{ escritorio_id: string }>(
      'SELECT escritorio_id FROM processo_escritorio WHERE processo_id = $1',
      [processoId],
    );
    for (const { escritorio_id } of escritorios.rows) {
      for (const m of novos) {
        await emitirEvento(db, {
          escritorioId: escritorio_id,
          tipo: 'movimento.novo',
          chave: `movimento.novo:${numeroCnj}:${m.hash}:${escritorio_id}`,
          dados: { numeroProcesso: numeroCnj, grau: m.grau, codigo: m.codigo, nome: m.nome, dataHora: m.dataHora },
        });
      }
    }
  }
  return { encontrado: true, movimentos: n.movimentos.length, novos: novos.length };
}

/** Consulta o DataJud e grava, numa transação. */
export async function sincronizarDatajud(
  pool: pg.Pool,
  conector: DatajudConector,
  numeroCnj: string,
  opcoes: { dono?: { escritorioId: string }; agora?: Date },
): Promise<ResultadoDatajud> {
  const agora = opcoes.agora ?? new Date();
  const total: ResultadoDatajud = { encontrado: false, movimentos: 0, novos: 0 };
  try {
    const contexto = opcoes.dono ? { escritorioId: opcoes.dono.escritorioId } : undefined;
    for await (const pagina of conector.buscar({ numeroCnj, contexto })) {
      const r = await emTransacao(pool, async (db) => {
        const bruto = await gravarBruto(db, { ...pagina, coletadoEm: agora });
        return ingerirRespostaDatajud(db, {
          payloadBrutoId: bruto.id,
          requisicao: pagina.requisicao,
          resposta: pagina.resposta,
          coletadoEm: agora,
          emitirEventos: true,
          dono: opcoes.dono,
        });
      });
      total.encontrado ||= r.encontrado;
      total.movimentos += r.movimentos;
      total.novos += r.novos;
    }
  } catch (e) {
    contadorExecucoes.inc({ fonte: 'datajud', situacao: 'falha' });
    throw e;
  }
  contadorExecucoes.inc({ fonte: 'datajud', situacao: 'ok' });
  contadorItens.inc({ fonte: 'datajud', novo: 'sim' }, total.novos);
  return total;
}
