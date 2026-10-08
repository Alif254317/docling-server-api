/** Datas de calendário como `YYYY-MM-DD`, com aritmética em UTC (sem fuso). */

const DIA_MS = 86_400_000;

export function validarIso(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    throw new Error(`Data inválida, use AAAA-MM-DD: ${d}`);
  }
  // Date.parse aceita 2026-02-30; a volta para ISO pega isso.
  if (new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new Error(`Data inexistente: ${d}`);
  return d;
}

export function somarDias(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

/** Data de hoje no fuso de Brasília. */
export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}
