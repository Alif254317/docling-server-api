import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { emTransacao } from '../db/transacao.js';
import { log } from '../log.js';
import { contadorEntregas, medidorEventosPendentes } from '../metricas.js';

/** Espera antes de cada nova tentativa, em minutos (spec 004 · FR-3). A última se repete. */
export const ESPERAS_MIN = [1, 5, 15, 60, 240];
export const MAX_TENTATIVAS = 10;
/** Tempo em que um lote reservado fica invisível para outros entregadores. */
const RESERVA_MIN = 5;
const TIMEOUT_MS = 10_000;
/** Entregas simultâneas por lote: 50 eventos × 10 s de timeout cabem com folga na reserva. */
const PARALELO = 10;

export async function criarWebhook(
  pool: pg.Pool,
  escritorioId: string,
  url: string,
): Promise<{ id: string; segredo: string }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL do webhook precisa ser http(s)');
  const segredo = randomBytes(32).toString('hex');
  const r = await pool.query<{ id: string }>(
    'INSERT INTO webhook (escritorio_id, url, segredo) VALUES ($1, $2, $3) RETURNING id',
    [escritorioId, u.toString(), segredo],
  );
  return { id: r.rows[0]!.id, segredo };
}

export function assinar(segredo: string, corpo: string): string {
  return `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;
}

interface EventoReservado {
  id: string;
  escritorio_id: string;
  tipo: string;
  dados: unknown;
  criado_em: Date;
  tentativas: number;
}

export interface ResultadoLote {
  reservados: number;
  entregues: number;
  falhas: number;
  mortos: number;
}

async function enviar(url: string, segredo: string, ev: EventoReservado): Promise<string | null> {
  const corpo = JSON.stringify({ id: ev.id, tipo: ev.tipo, criadoEm: ev.criado_em, dados: ev.dados });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-evento-id': ev.id,
        'x-evento-tipo': ev.tipo,
        'x-assinatura': assinar(segredo, corpo),
      },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok ? null : `HTTP ${res.status} de ${new URL(url).host}`;
  } catch (e) {
    return `falha de rede em ${new URL(url).host}: ${(e as Error).message}`;
  }
}

/**
 * Spec 004: reserva um lote de eventos vencidos de escritórios com webhook
 * (`FOR UPDATE SKIP LOCKED` + reserva por tempo), entrega e grava o resultado.
 * Entrega pelo menos uma vez; o receptor deduplica por `X-Evento-Id`.
 */
export async function entregarLote(
  pool: pg.Pool,
  opcoes: { limite?: number; agora?: Date } = {},
): Promise<ResultadoLote> {
  const agora = opcoes.agora ?? new Date();
  const limite = opcoes.limite ?? 50;
  const reserva = randomUUID();
  const lote = await emTransacao(pool, async (db) => {
    const r = await db.query<EventoReservado>(
      `SELECT e.id, e.escritorio_id, e.tipo, e.dados, e.criado_em, e.tentativas
         FROM evento e
        WHERE e.situacao = 'pendente' AND e.proxima_tentativa_em <= $1
          AND EXISTS (SELECT 1 FROM webhook w WHERE w.escritorio_id = e.escritorio_id AND w.ativo)
        ORDER BY e.id
        LIMIT $2
        FOR UPDATE OF e SKIP LOCKED`,
      [agora, limite],
    );
    if (r.rows.length) {
      await db.query(
        `UPDATE evento SET reserva = $4, proxima_tentativa_em = $2::timestamptz + make_interval(mins => $3)
          WHERE id = ANY($1)`,
        [r.rows.map((x) => x.id), agora, RESERVA_MIN, reserva],
      );
    }
    return r.rows;
  });

  const out: ResultadoLote = { reservados: lote.length, entregues: 0, falhas: 0, mortos: 0 };
  const hooksPorEscritorio = new Map<string, Promise<{ url: string; segredo: string }[]>>();
  const hooksDe = (esc: string) => {
    let h = hooksPorEscritorio.get(esc);
    if (!h) {
      h = pool
        .query<{ url: string; segredo: string }>(
          'SELECT url, segredo FROM webhook WHERE escritorio_id = $1 AND ativo ORDER BY criado_em',
          [esc],
        )
        .then((r) => r.rows);
      hooksPorEscritorio.set(esc, h);
    }
    return h;
  };

  const processar = async (ev: EventoReservado) => {
    const hooks = await hooksDe(ev.escritorio_id);
    const erros = (await Promise.all(hooks.map((h) => enviar(h.url, h.segredo, ev)))).filter((x) => x !== null);
    const tentativas = ev.tentativas + 1;
    // Só grava quem ainda detém a reserva: um "entregue" nunca volta a "pendente".
    if (erros.length === 0) {
      await pool.query(
        `UPDATE evento SET situacao = 'entregue', tentativas = $2, entregue_em = $3, ultimo_erro = NULL, reserva = NULL
          WHERE id = $1 AND reserva = $4 AND situacao = 'pendente'`,
        [ev.id, tentativas, agora, reserva],
      );
      out.entregues++;
      contadorEntregas.inc({ resultado: 'entregue' });
      return;
    }
    const morto = tentativas >= MAX_TENTATIVAS;
    const espera = ESPERAS_MIN[Math.min(tentativas, ESPERAS_MIN.length) - 1]!;
    const upd = await pool.query(
      `UPDATE evento SET situacao = $2, tentativas = $3, ultimo_erro = $4, reserva = NULL,
              proxima_tentativa_em = $5::timestamptz + make_interval(mins => $6)
        WHERE id = $1 AND reserva = $7 AND situacao = 'pendente'`,
      [ev.id, morto ? 'morto' : 'pendente', tentativas, erros.join('; '), agora, espera, reserva],
    );
    out.falhas++;
    if (morto && upd.rowCount) {
      out.mortos++;
      log.error({ eventoId: ev.id, escritorioId: ev.escritorio_id, erros }, 'evento morto após o máximo de tentativas');
    }
    contadorEntregas.inc({ resultado: morto ? 'morto' : 'falha' });
  };

  const fila = [...lote];
  await Promise.all(
    Array.from({ length: Math.min(PARALELO, fila.length) }, async () => {
      for (let ev = fila.shift(); ev; ev = fila.shift()) await processar(ev);
    }),
  );
  const pend = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM evento WHERE situacao = 'pendente'");
  medidorEventosPendentes.set(pend.rows[0]!.n);
  return out;
}
