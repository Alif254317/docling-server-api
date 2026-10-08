/**
 * Número único de processo (Res. CNJ 65/2008): NNNNNNN-DD.AAAA.J.TT.OOOO.
 * DV calculado por módulo 97 (ISO 7064), em partes para caber em inteiros.
 */

export class CnjInvalido extends Error {
  constructor(entrada: string, motivo: string) {
    super(`Número CNJ inválido (${motivo}): ${entrada}`);
    this.name = 'CnjInvalido';
  }
}

export interface CnjPartes {
  /** 20 dígitos, sem máscara. */
  numero: string;
  formatado: string;
  sequencial: string;
  dv: string;
  ano: number;
  /** J: 1 STF, 2 CNJ, 3 STJ, 4 Federal, 5 Trabalho, 6 Eleitoral, 7 Militar União, 8 Estadual, 9 Militar estadual. */
  segmento: number;
  /** TT: código do tribunal dentro do segmento. */
  tribunal: number;
  origem: string;
}

function mod97(s: string): number {
  return Number(BigInt(s) % 97n);
}

export function calcularDv(sequencial: string, ano: string, j: string, tt: string, origem: string): string {
  const r1 = mod97(sequencial);
  const r2 = mod97(`${r1}${ano}${j}${tt}`);
  const r3 = mod97(`${r2}${origem}00`);
  return String(98 - r3).padStart(2, '0');
}

export function formatarCnj(numero: string): string {
  return `${numero.slice(0, 7)}-${numero.slice(7, 9)}.${numero.slice(9, 13)}.${numero[13]}.${numero.slice(14, 16)}.${numero.slice(16)}`;
}

export function parseCnj(entrada: string): CnjPartes {
  const numero = entrada.replace(/\D/g, '');
  if (!/^\d{20}$/.test(numero)) throw new CnjInvalido(entrada, 'precisa ter 20 dígitos');
  const sequencial = numero.slice(0, 7);
  const dv = numero.slice(7, 9);
  const ano = numero.slice(9, 13);
  const j = numero.slice(13, 14);
  const tt = numero.slice(14, 16);
  const origem = numero.slice(16);
  if (calcularDv(sequencial, ano, j, tt, origem) !== dv) throw new CnjInvalido(entrada, 'dígito verificador');
  return {
    numero,
    formatado: formatarCnj(numero),
    sequencial,
    dv,
    ano: Number(ano),
    segmento: Number(j),
    tribunal: Number(tt),
    origem,
  };
}

export function cnjValido(entrada: string): boolean {
  try {
    parseCnj(entrada);
    return true;
  } catch {
    return false;
  }
}
