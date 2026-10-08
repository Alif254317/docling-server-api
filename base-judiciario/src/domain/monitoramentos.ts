import type pg from 'pg';
import { parseCnj } from './cnj.js';
import { UFS } from './tribunais.js';

export type NovoMonitoramento =
  | { tipo: 'oab'; numero: string; uf: string; frequenciaMin?: number }
  | { tipo: 'processo'; numeroCnj: string; frequenciaMin?: number };

export interface Monitoramento {
  id: string;
  escritorio_id: string;
  tipo: 'oab' | 'processo';
  oab_numero: string | null;
  oab_uf: string | null;
  numero_cnj: string | null;
  frequencia_min: number;
  ativo: boolean;
  proxima_coleta_em: Date;
  criado_em: Date;
}

/** Uma coleta por dia no mínimo: a janela de coleta cobre o intervalo desde a última com sucesso. */
export const FREQUENCIA_MAX_MIN = 1440;

export class MonitoramentoInvalido extends Error {}
export class MonitoramentoDuplicado extends Error {}

export function validarMonitoramento(m: NovoMonitoramento): NovoMonitoramento {
  if (
    m.frequenciaMin !== undefined &&
    (!Number.isInteger(m.frequenciaMin) || m.frequenciaMin < 5 || m.frequenciaMin > FREQUENCIA_MAX_MIN)
  ) {
    throw new MonitoramentoInvalido(`frequência deve ficar entre 5 e ${FREQUENCIA_MAX_MIN} minutos`);
  }
  if (m.tipo === 'oab') {
    const numero = m.numero.replace(/\D/g, '');
    const uf = m.uf.toUpperCase();
    if (!/^\d{1,7}$/.test(numero)) throw new MonitoramentoInvalido('número da OAB inválido');
    if (!UFS.has(uf)) throw new MonitoramentoInvalido(`UF da OAB inválida: ${m.uf}`);
    return { ...m, numero: numero.replace(/^0+/, '') || '0', uf };
  }
  try {
    return { ...m, numeroCnj: parseCnj(m.numeroCnj).numero };
  } catch (e) {
    throw new MonitoramentoInvalido((e as Error).message);
  }
}

export async function criarMonitoramento(
  pool: pg.Pool,
  escritorioId: string,
  entrada: NovoMonitoramento,
): Promise<Monitoramento> {
  const m = validarMonitoramento(entrada);
  try {
    const r = await pool.query<Monitoramento>(
      `INSERT INTO monitoramento (escritorio_id, tipo, oab_numero, oab_uf, numero_cnj, frequencia_min)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        escritorioId,
        m.tipo,
        m.tipo === 'oab' ? m.numero : null,
        m.tipo === 'oab' ? m.uf : null,
        m.tipo === 'processo' ? m.numeroCnj : null,
        m.frequenciaMin ?? 60,
      ],
    );
    return r.rows[0]!;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new MonitoramentoDuplicado('monitoramento já existe');
    throw e;
  }
}

export async function buscarMonitoramento(
  db: Pick<pg.Pool, 'query'>,
  id: string,
): Promise<Monitoramento | null> {
  const r = await db.query<Monitoramento>('SELECT * FROM monitoramento WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}
