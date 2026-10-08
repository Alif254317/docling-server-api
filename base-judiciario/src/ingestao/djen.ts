import type pg from 'pg';
import { normalizarDjen, type ComunicacaoNormalizada } from '../connectors/djen/normalizador.js';
import { parseCnj } from '../domain/cnj.js';
import { tribunalDoCnj } from '../domain/tribunais.js';
import { emitirEvento } from '../eventos/outbox.js';
import { dataPublicacao } from '../prazos/calculo.js';
import { feriadosDoTribunal, gerarPrazo } from '../prazos/servico.js';

type Db = Pick<pg.PoolClient, 'query'>;

export interface PaginaDjen {
  payloadBrutoId: number;
  resposta: unknown;
  coletadoEm: Date;
  /** Escritório e monitoramento donos da coleta; ausente = sem vínculo. */
  dono?: { escritorioId: string; monitoramentoId: string | null };
  emitirEventos: boolean;
}

export interface ResultadoPaginaDjen {
  itens: number;
  /** Comunicações novas para o escritório dono (vínculo criado agora). */
  novos: number;
  erros: { indice: number; motivo: string }[];
  /** Processos com comunicação nova, para enriquecer no DataJud. */
  processos: string[];
}

async function garantirProcesso(db: Db, numeroCnj: string, sigla: string, c: { coletadoEm: Date; brutoId: number }) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO processo (numero_cnj, tribunal_sigla, fonte, coletado_em, payload_bruto_id)
     VALUES ($1, $2, 'djen', $3, $4)
     ON CONFLICT (numero_cnj) DO UPDATE SET numero_cnj = EXCLUDED.numero_cnj
     RETURNING id`,
    [numeroCnj, sigla, c.coletadoEm, c.brutoId],
  );
  return Number(r.rows[0]!.id);
}

function siglaDe(it: ComunicacaoNormalizada): string {
  if (it.numeroCnj) {
    const t = tribunalDoCnj(parseCnj(it.numeroCnj));
    if (t) return t.sigla;
  }
  return it.siglaTribunal ?? 'DESCONHECIDO';
}

/**
 * Spec 002: grava uma página já registrada em `payload_bruto` no modelo
 * normalizado. Deve rodar na mesma transação que gravou o bruto.
 */
export async function ingerirPaginaDjen(db: Db, p: PaginaDjen): Promise<ResultadoPaginaDjen> {
  const { itens, erros } = normalizarDjen(p.resposta);
  const out: ResultadoPaginaDjen = { itens: itens.length, novos: 0, erros, processos: [] };
  const feriadosCache = new Map<string, Map<string, string>>();

  for (const it of itens) {
    const sigla = siglaDe(it);
    let feriados = feriadosCache.get(sigla);
    if (!feriados) {
      feriados = await feriadosDoTribunal(db, sigla);
      feriadosCache.set(sigla, feriados);
    }
    const processoId = it.numeroCnj
      ? await garantirProcesso(db, it.numeroCnj, sigla, { coletadoEm: p.coletadoEm, brutoId: p.payloadBrutoId })
      : null;
    const situacao = it.numeroCnj ? 'ok' : 'revisao';

    const c = await db.query<{ id: string }>(
      `INSERT INTO comunicacao (id_djen, processo_id, numero_processo_original, sigla_tribunal, tipo_comunicacao,
         tipo_documento, orgao, classe, texto, data_disponibilizacao, data_publicacao, meio, link, hash_djen,
         destinatarios, advogados, situacao, motivo_revisao, fonte, coletado_em, payload_bruto_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'djen',$19,$20)
       ON CONFLICT (id_djen) DO UPDATE SET
         processo_id = EXCLUDED.processo_id, numero_processo_original = EXCLUDED.numero_processo_original,
         sigla_tribunal = EXCLUDED.sigla_tribunal, tipo_comunicacao = EXCLUDED.tipo_comunicacao,
         tipo_documento = EXCLUDED.tipo_documento, orgao = EXCLUDED.orgao, classe = EXCLUDED.classe,
         texto = EXCLUDED.texto, data_disponibilizacao = EXCLUDED.data_disponibilizacao,
         data_publicacao = EXCLUDED.data_publicacao, meio = EXCLUDED.meio, link = EXCLUDED.link,
         hash_djen = EXCLUDED.hash_djen, destinatarios = EXCLUDED.destinatarios, advogados = EXCLUDED.advogados,
         situacao = EXCLUDED.situacao, motivo_revisao = EXCLUDED.motivo_revisao,
         coletado_em = EXCLUDED.coletado_em, payload_bruto_id = EXCLUDED.payload_bruto_id
       RETURNING id`,
      [
        it.idDjen,
        processoId,
        it.numeroProcessoOriginal,
        it.siglaTribunal ?? sigla,
        it.tipoComunicacao,
        it.tipoDocumento,
        it.orgao,
        it.classe,
        it.texto,
        it.dataDisponibilizacao,
        dataPublicacao(it.dataDisponibilizacao, feriados),
        it.meio,
        it.link,
        it.hashDjen,
        JSON.stringify(it.destinatarios),
        JSON.stringify(it.advogados),
        situacao,
        it.cnjErro,
        p.coletadoEm,
        p.payloadBrutoId,
      ],
    );
    const comunicacaoId = Number(c.rows[0]!.id);
    if (!p.dono) continue;
    const { escritorioId, monitoramentoId } = p.dono;

    if (processoId !== null) {
      await db.query(
        `INSERT INTO processo_escritorio (processo_id, escritorio_id, origem) VALUES ($1, $2, 'djen')
         ON CONFLICT DO NOTHING`,
        [processoId, escritorioId],
      );
    }
    const vinculo = await db.query(
      `INSERT INTO comunicacao_escritorio (comunicacao_id, escritorio_id, monitoramento_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [comunicacaoId, escritorioId, monitoramentoId],
    );
    if (vinculo.rowCount !== 1) continue;

    out.novos++;
    if (it.numeroCnj) out.processos.push(it.numeroCnj);
    if (p.emitirEventos) {
      const tipo = situacao === 'ok' ? 'comunicacao.nova' : 'comunicacao.revisao';
      await emitirEvento(db, {
        escritorioId,
        tipo,
        chave: `${tipo}:${it.idDjen}:${escritorioId}`,
        dados: {
          idDjen: it.idDjen,
          numeroProcesso: it.numeroCnj ?? it.numeroProcessoOriginal,
          siglaTribunal: it.siglaTribunal ?? sigla,
          tipoComunicacao: it.tipoComunicacao,
          dataDisponibilizacao: it.dataDisponibilizacao,
          orgao: it.orgao,
          ...(situacao === 'revisao' ? { motivo: it.cnjErro } : {}),
        },
      });
    }
    await gerarPrazo(
      db,
      {
        id: comunicacaoId,
        idDjen: it.idDjen,
        dataDisponibilizacao: it.dataDisponibilizacao,
        texto: it.texto,
        situacao,
        numeroProcesso: it.numeroCnj ?? it.numeroProcessoOriginal,
      },
      escritorioId,
      feriados,
      p.emitirEventos,
    );
  }
  return out;
}
