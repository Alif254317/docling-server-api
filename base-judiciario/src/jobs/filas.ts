import { Queue, UnrecoverableError, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type pg from 'pg';
import type { DatajudConector } from '../connectors/datajud/conector.js';
import { SemIndiceDatajud } from '../connectors/datajud/indice.js';
import type { DjenConector } from '../connectors/djen/conector.js';
import { entregarLote } from '../eventos/entregador.js';
import { executarColetaDjen } from '../ingestao/coleta.js';
import { sincronizarDatajud } from '../ingestao/datajud.js';
import { log } from '../log.js';

export const NOMES = { djen: 'coleta-djen', datajud: 'coleta-datajud', manutencao: 'manutencao' } as const;

export interface DadosDjen {
  monitoramentoId: string;
}
export interface DadosDatajud {
  numeroCnj: string;
  escritorioId?: string;
}

export interface Filas {
  djen: Queue<DadosDjen>;
  datajud: Queue<DadosDatajud>;
  manutencao: Queue;
  fechar(): Promise<void>;
}

export function conectarRedis(url: string): Redis {
  // BullMQ exige maxRetriesPerRequest = null nas conexões dos workers.
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function criarFilas(redis: Redis, prefixo = 'bj'): Filas {
  const opts = { connection: redis as unknown as ConnectionOptions, prefix: prefixo };
  const padrao = { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 };
  const djen = new Queue<DadosDjen>(NOMES.djen, { ...opts, defaultJobOptions: padrao });
  const datajud = new Queue<DadosDatajud>(NOMES.datajud, { ...opts, defaultJobOptions: padrao });
  const manutencao = new Queue(NOMES.manutencao, { ...opts, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 1000 } });
  return {
    djen,
    datajud,
    manutencao,
    async fechar() {
      await Promise.all([djen.close(), datajud.close(), manutencao.close()]);
    },
  };
}

/** Janela de deduplicação de jobs: um por alvo a cada `minutos`. */
function janela(agora: Date, minutos: number): number {
  return Math.floor(agora.getTime() / (minutos * 60_000));
}

export async function enfileirarDatajud(filas: Filas, d: DadosDatajud, agora = new Date()): Promise<void> {
  await filas.datajud.add('sincronizar', d, { jobId: `datajud-${d.numeroCnj}-${d.escritorioId ?? 'x'}-${janela(agora, 60)}` });
}

/**
 * Spec 002 · FR-1: reserva os monitoramentos vencidos (avançando a próxima
 * coleta, com SKIP LOCKED para vários agendadores) e enfileira os jobs.
 */
export async function agendarVencidos(pool: pg.Pool, filas: Filas, agora = new Date()): Promise<number> {
  const { rows } = await pool.query<{ id: string; tipo: string; numero_cnj: string | null; escritorio_id: string }>(
    `UPDATE monitoramento m SET proxima_coleta_em = $1::timestamptz + make_interval(mins => m.frequencia_min)
      WHERE m.id IN (
        SELECT id FROM monitoramento WHERE ativo AND proxima_coleta_em <= $1
         ORDER BY proxima_coleta_em LIMIT 500 FOR UPDATE SKIP LOCKED)
      RETURNING m.id, m.tipo, m.numero_cnj, m.escritorio_id`,
    [agora],
  );
  const slot = janela(agora, 1);
  for (const m of rows) {
    await filas.djen.add('coletar', { monitoramentoId: m.id }, { jobId: `djen-${m.id}-${slot}` });
    if (m.tipo === 'processo' && m.numero_cnj) {
      await enfileirarDatajud(filas, { numeroCnj: m.numero_cnj, escritorioId: m.escritorio_id }, agora);
    }
  }
  return rows.length;
}

export interface Dependencias {
  pool: pg.Pool;
  redis: Redis;
  filas: Filas;
  djen: DjenConector;
  datajud: DatajudConector | null;
  prefixo?: string;
  concorrencia?: number;
}

/** Sobe os workers de coleta, DataJud e manutenção (agenda + entrega de eventos). */
export async function iniciarWorkers(d: Dependencias): Promise<{ fechar(): Promise<void> }> {
  const base = { connection: d.redis as unknown as ConnectionOptions, prefix: d.prefixo ?? 'bj' };
  const workers: Worker[] = [];

  workers.push(
    new Worker<DadosDjen>(
      NOMES.djen,
      async (job) => {
        const r = await executarColetaDjen(d.pool, d.djen, job.data.monitoramentoId);
        // Spec 003 · FR-7: enriquecer os processos com comunicação nova.
        if (d.datajud) for (const numeroCnj of r.processosParaEnriquecer) await enfileirarDatajud(d.filas, { numeroCnj });
        return { situacao: r.situacao, itens: r.itens, novos: r.novos };
      },
      { ...base, concurrency: d.concorrencia ?? 2 },
    ),
  );

  if (d.datajud) {
    const datajud = d.datajud;
    workers.push(
      new Worker<DadosDatajud>(
        NOMES.datajud,
        async (job) => {
          try {
            const dono = job.data.escritorioId ? { escritorioId: job.data.escritorioId } : undefined;
            return await sincronizarDatajud(d.pool, datajud, job.data.numeroCnj, { dono });
          } catch (e) {
            if (e instanceof SemIndiceDatajud) throw new UnrecoverableError(e.message);
            throw e;
          }
        },
        { ...base, concurrency: d.concorrencia ?? 2, limiter: { max: 5, duration: 1000 } },
      ),
    );
  }

  workers.push(
    new Worker(
      NOMES.manutencao,
      async (job) => {
        if (job.name === 'agendar') return { agendados: await agendarVencidos(d.pool, d.filas) };
        if (job.name === 'entregar-eventos') {
          let total = 0;
          for (;;) {
            const r = await entregarLote(d.pool, { limite: 50 });
            total += r.entregues;
            if (r.reservados < 50) return { entregues: total };
          }
        }
        throw new UnrecoverableError(`job desconhecido: ${job.name}`);
      },
      { ...base, concurrency: 1 },
    ),
  );

  await d.filas.manutencao.upsertJobScheduler('agendar', { every: 60_000 }, { name: 'agendar' });
  await d.filas.manutencao.upsertJobScheduler('entregar-eventos', { every: 15_000 }, { name: 'entregar-eventos' });

  for (const w of workers) {
    w.on('failed', (job, err) => log.error({ fila: w.name, jobId: job?.id, erro: err.message }, 'job falhou'));
  }
  return {
    async fechar() {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
