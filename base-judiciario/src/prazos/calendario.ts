import { diaDaSemana, somarDias } from './datas.js';

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

const cache = new Map<number, Map<string, string>>();

/**
 * Feriados nacionais que fecham o expediente forense em todo o país.
 * Carnaval e Corpus Christi ficam de fora de propósito (regra de segurança da
 * spec 005): só contam quando cadastrados para o tribunal.
 */
export function feriadosNacionais(ano: number): Map<string, string> {
  const pronto = cache.get(ano);
  if (pronto) return pronto;
  const f = new Map<string, string>([
    [`${ano}-01-01`, 'Confraternização Universal'],
    [somarDias(pascoa(ano), -2), 'Sexta-feira Santa'],
    [`${ano}-04-21`, 'Tiradentes'],
    [`${ano}-05-01`, 'Dia do Trabalho'],
    [`${ano}-09-07`, 'Independência do Brasil'],
    [`${ano}-10-12`, 'Nossa Senhora Aparecida'],
    [`${ano}-11-02`, 'Finados'],
    [`${ano}-11-15`, 'Proclamação da República'],
    [`${ano}-12-25`, 'Natal'],
  ]);
  if (ano >= 2024) f.set(`${ano}-11-20`, 'Dia Nacional de Zumbi e da Consciência Negra (Lei 14.759/2023)');
  cache.set(ano, f);
  return f;
}

/** Recesso forense, CPC art. 220: 20/12 a 20/01, inclusive. */
export function emRecesso(d: string): boolean {
  const md = d.slice(5);
  return md >= '12-20' || md <= '01-20';
}

/** Motivo de o dia não ter expediente, ou `null` se tem. Não considera o recesso. */
export function semExpediente(d: string, extras?: ReadonlyMap<string, string>): string | null {
  const dow = diaDaSemana(d);
  if (dow === 0) return 'domingo';
  if (dow === 6) return 'sábado';
  return feriadosNacionais(Number(d.slice(0, 4))).get(d) ?? extras?.get(d) ?? null;
}

/** Motivo de o dia não contar para prazo, ou `null` se é dia útil. */
export function naoUtilParaPrazo(d: string, extras?: ReadonlyMap<string, string>): string | null {
  return semExpediente(d, extras) ?? (emRecesso(d) ? 'recesso forense (CPC art. 220)' : null);
}
