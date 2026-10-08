import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { CnjInvalido, formatarCnj, parseCnj } from '../domain/cnj.js';
import { escritorioDaChave } from '../domain/escritorios.js';
import {
  criarMonitoramento,
  MonitoramentoDuplicado,
  MonitoramentoInvalido,
  type Monitoramento,
} from '../domain/monitoramentos.js';
import { criarWebhook } from '../eventos/entregador.js';
import { registro } from '../metricas.js';
import { calcularPrazo } from '../prazos/calculo.js';
import { validarIso } from '../prazos/datas.js';
import { extrairDias } from '../prazos/extrair.js';
import { feriadosDoTribunal } from '../prazos/servico.js';

declare module 'fastify' {
  interface FastifyRequest {
    escritorioId: string;
  }
}

class ErroEntrada extends Error {}

function validar<T>(schema: z.ZodType<T>, valor: unknown): T {
  const r = schema.safeParse(valor);
  if (!r.success) {
    throw new ErroEntrada(r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
  }
  return r.data;
}

const dataIso = z.string().refine((d) => {
  try {
    validarIso(d);
    return true;
  } catch {
    return false;
  }
}, 'data deve ser AAAA-MM-DD');

const NovoMonitoramento = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('oab'), numero: z.string(), uf: z.string(), frequenciaMin: z.number().int().optional() }),
  z.object({ tipo: z.literal('processo'), numeroCnj: z.string(), frequenciaMin: z.number().int().optional() }),
]);

const CalculoPrazo = z.object({
  dataDisponibilizacao: dataIso,
  dias: z.number().int().min(1).max(365).optional(),
  texto: z.string().optional(),
  tribunal: z.string().optional(),
});

const Lista = z.object({
  desde: dataIso.optional(),
  ate: dataIso.optional(),
  situacao: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});

function monitoramentoDto(m: Monitoramento) {
  return {
    id: m.id,
    tipo: m.tipo,
    oabNumero: m.oab_numero,
    oabUf: m.oab_uf,
    numeroCnj: m.numero_cnj ? formatarCnj(m.numero_cnj) : null,
    frequenciaMin: m.frequencia_min,
    ativo: m.ativo,
    proximaColetaEm: m.proxima_coleta_em,
  };
}

/** Spec 013: API interna para o nosso sistema jurídico. */
export async function criarApp({ pool }: { pool: pg.Pool }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ErroEntrada || err instanceof MonitoramentoInvalido || err instanceof CnjInvalido) {
      return reply.code(400).send({ erro: err.message });
    }
    if (err instanceof MonitoramentoDuplicado) return reply.code(409).send({ erro: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ erro: err.message });
    app.log.error(err);
    return reply.code(500).send({ erro: 'erro interno' });
  });

  app.get('/saude', async () => {
    await pool.query('SELECT 1');
    return { ok: true, banco: 'ok' };
  });

  app.get('/metricas', async (_req, reply) => {
    reply.header('content-type', registro.contentType);
    return registro.metrics();
  });

  // Tudo abaixo exige chave (FR-1) e é filtrado pelo escritório (C8).
  app.register(async (priv) => {
    priv.decorateRequest('escritorioId', '');
    priv.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
      const esc = m ? await escritorioDaChave(pool, m[1]!) : null;
      if (!esc) return reply.code(401).send({ erro: 'chave de API ausente ou inválida' });
      req.escritorioId = esc;
    });

    priv.post('/monitoramentos', async (req, reply) => {
      const corpo = validar(NovoMonitoramento, req.body);
      const m =
        corpo.tipo === 'oab'
          ? await criarMonitoramento(pool, req.escritorioId, corpo)
          : await criarMonitoramento(pool, req.escritorioId, corpo);
      return reply.code(201).send(monitoramentoDto(m));
    });

    priv.get('/monitoramentos', async (req) => {
      const r = await pool.query<Monitoramento>(
        'SELECT * FROM monitoramento WHERE escritorio_id = $1 ORDER BY criado_em',
        [req.escritorioId],
      );
      return r.rows.map(monitoramentoDto);
    });

    priv.delete<{ Params: { id: string } }>('/monitoramentos/:id', async (req, reply) => {
      if (!z.uuid().safeParse(req.params.id).success) return reply.code(404).send({ erro: 'não encontrado' });
      const r = await pool.query('DELETE FROM monitoramento WHERE id = $1 AND escritorio_id = $2', [
        req.params.id,
        req.escritorioId,
      ]);
      return r.rowCount ? reply.code(204).send() : reply.code(404).send({ erro: 'não encontrado' });
    });

    priv.get<{ Params: { numero: string } }>('/processos/:numero', async (req, reply) => {
      const numero = parseCnj(req.params.numero).numero;
      const p = await pool.query(
        `SELECT p.* FROM processo p JOIN processo_escritorio pe ON pe.processo_id = p.id
          WHERE p.numero_cnj = $1 AND pe.escritorio_id = $2`,
        [numero, req.escritorioId],
      );
      const proc = p.rows[0];
      if (!proc) return reply.code(404).send({ erro: 'processo não encontrado para este escritório' });
      const [mov, com] = await Promise.all([
        pool.query(
          `SELECT grau, codigo_tpu AS codigo, nome, data_hora AS "dataHora", complementos, fonte
             FROM movimento WHERE processo_id = $1 ORDER BY data_hora DESC LIMIT 200`,
          [proc.id],
        ),
        pool.query(
          `SELECT c.id_djen AS "idDjen", c.tipo_comunicacao AS tipo, c.data_disponibilizacao::text AS "dataDisponibilizacao",
                  c.data_publicacao::text AS "dataPublicacao", c.orgao, c.texto, c.link
             FROM comunicacao c JOIN comunicacao_escritorio ce ON ce.comunicacao_id = c.id
            WHERE c.processo_id = $1 AND ce.escritorio_id = $2 ORDER BY c.data_disponibilizacao DESC`,
          [proc.id, req.escritorioId],
        ),
      ]);
      return {
        numeroCnj: formatarCnj(proc.numero_cnj),
        tribunal: proc.tribunal_sigla,
        classe: proc.classe_nome,
        assuntos: proc.assuntos,
        orgaoJulgador: proc.orgao_julgador,
        graus: proc.graus,
        nivelSigilo: proc.nivel_sigilo,
        dataAjuizamento: proc.data_ajuizamento,
        capaSincronizadaEm: proc.capa_sincronizada_em,
        movimentos: mov.rows,
        comunicacoes: com.rows,
      };
    });

    priv.get('/comunicacoes', async (req) => {
      const q = validar(Lista, req.query);
      const r = await pool.query(
        `SELECT c.id_djen AS "idDjen", c.numero_processo_original AS "numeroProcesso", c.sigla_tribunal AS tribunal,
                c.tipo_comunicacao AS tipo, c.tipo_documento AS "tipoDocumento", c.orgao,
                c.data_disponibilizacao::text AS "dataDisponibilizacao", c.data_publicacao::text AS "dataPublicacao",
                c.situacao, c.motivo_revisao AS "motivoRevisao", c.texto, c.link
           FROM comunicacao c JOIN comunicacao_escritorio ce ON ce.comunicacao_id = c.id
          WHERE ce.escritorio_id = $1 AND ($2::date IS NULL OR c.data_disponibilizacao >= $2)
          ORDER BY c.data_disponibilizacao DESC, c.id_djen DESC LIMIT $3`,
        [req.escritorioId, q.desde ?? null, q.limite],
      );
      return r.rows;
    });

    priv.get('/prazos', async (req) => {
      const q = validar(Lista, req.query);
      const r = await pool.query(
        `SELECT p.id, c.id_djen AS "idDjen", c.numero_processo_original AS "numeroProcesso",
                p.publicacao::text, p.inicio::text, p.fim::text, p.dias_uteis AS "diasUteis",
                p.origem_dias AS "origemDias", p.situacao, p.regra
           FROM prazo p JOIN comunicacao c ON c.id = p.comunicacao_id
          WHERE p.escritorio_id = $1 AND ($2::date IS NULL OR p.fim <= $2) AND ($3::text IS NULL OR p.situacao = $3)
          ORDER BY p.fim, p.id LIMIT $4`,
        [req.escritorioId, q.ate ?? null, q.situacao ?? null, q.limite],
      );
      return r.rows;
    });

    priv.post('/prazos/calcular', async (req) => {
      const c = validar(CalculoPrazo, req.body);
      const extraido = c.dias === undefined ? extrairDias(c.texto ?? '') : null;
      const dias = c.dias ?? extraido!.dias;
      const r = calcularPrazo({
        disponibilizacao: c.dataDisponibilizacao,
        dias,
        feriadosExtras: await feriadosDoTribunal(pool, c.tribunal?.toUpperCase() ?? null),
      });
      return {
        ...r,
        origemDias: extraido ? extraido.origem : 'manual',
        confirmar: extraido?.confirmar ?? false,
      };
    });

    priv.post('/webhooks', async (req, reply) => {
      const { url } = validar(z.object({ url: z.url({ protocol: /^https?$/ }) }), req.body);
      return reply.code(201).send(await criarWebhook(pool, req.escritorioId, url));
    });

    priv.get('/webhooks', async (req) => {
      const r = await pool.query(
        'SELECT id, url, ativo, criado_em AS "criadoEm" FROM webhook WHERE escritorio_id = $1 ORDER BY criado_em',
        [req.escritorioId],
      );
      return r.rows;
    });

    priv.get('/eventos', async (req) => {
      const q = validar(Lista, req.query);
      const r = await pool.query(
        `SELECT id::text, tipo, dados, criado_em AS "criadoEm", situacao, tentativas, ultimo_erro AS "ultimoErro"
           FROM evento WHERE escritorio_id = $1 AND ($2::text IS NULL OR situacao = $2)
          ORDER BY id LIMIT $3`,
        [req.escritorioId, q.situacao ?? null, q.limite],
      );
      return r.rows;
    });

    priv.post('/eventos/confirmacoes', async (req) => {
      const { ids } = validar(z.object({ ids: z.array(z.coerce.number().int().positive()).max(500) }), req.body);
      const r = await pool.query(
        `UPDATE evento SET situacao = 'entregue', entregue_em = now()
          WHERE escritorio_id = $1 AND id = ANY($2::bigint[]) AND situacao <> 'entregue'`,
        [req.escritorioId, ids],
      );
      return { confirmados: r.rowCount ?? 0 };
    });
  });

  await app.ready();
  return app;
}
