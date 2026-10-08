import { naoUtilParaPrazo, semExpediente } from './calendario.js';
import { somarDias, validarIso } from './datas.js';

export interface EntradaPrazo {
  /** Data de disponibilização no DJEN (AAAA-MM-DD). */
  disponibilizacao: string;
  /** Prazo em dias úteis. */
  dias: number;
  /** Feriados do tribunal além dos nacionais (data → descrição). */
  feriadosExtras?: ReadonlyMap<string, string>;
}

export interface DiaPulado {
  data: string;
  motivo: string;
}

export interface ResultadoPrazo {
  disponibilizacao: string;
  publicacao: string;
  inicio: string;
  fim: string;
  dias: number;
  diasPulados: DiaPulado[];
  regra: string;
}

export const REGRA_PRAZO =
  'Publicação no 1º dia útil após a disponibilização (Lei 11.419/2006, art. 4º, §3º); ' +
  'início no 1º dia útil após a publicação (art. 4º, §4º; CPC art. 224); dias úteis (CPC art. 219); ' +
  'suspensão de 20/12 a 20/01 (CPC art. 220).';

const LIMITE_BUSCA = 400;

function proximo(
  depoisDe: string,
  motivoNao: (d: string) => string | null,
  pulados: DiaPulado[],
): string {
  let d = depoisDe;
  for (let i = 0; i < LIMITE_BUSCA; i++) {
    d = somarDias(d, 1);
    const motivo = motivoNao(d);
    if (motivo === null) return d;
    pulados.push({ data: d, motivo });
  }
  throw new Error(`Nenhum dia útil em ${LIMITE_BUSCA} dias após ${depoisDe}`);
}

/** Spec 005: calcula publicação, início e fim de um prazo em dias úteis. */
export function calcularPrazo(e: EntradaPrazo): ResultadoPrazo {
  validarIso(e.disponibilizacao);
  if (!Number.isInteger(e.dias) || e.dias < 1 || e.dias > 365) {
    throw new Error(`Quantidade de dias inválida: ${e.dias}`);
  }
  const pulados: DiaPulado[] = [];
  // Regra de segurança: o recesso não adia a publicação, só a contagem.
  const publicacao = proximo(e.disponibilizacao, (d) => semExpediente(d, e.feriadosExtras), pulados);
  const util = (d: string) => naoUtilParaPrazo(d, e.feriadosExtras);
  const inicio = proximo(publicacao, util, pulados);
  let fim = inicio;
  for (let n = 1; n < e.dias; n++) fim = proximo(fim, util, pulados);
  return {
    disponibilizacao: e.disponibilizacao,
    publicacao,
    inicio,
    fim,
    dias: e.dias,
    diasPulados: pulados,
    regra: REGRA_PRAZO,
  };
}

/** Só a data de publicação (usada pela ingestão do DJEN). */
export function dataPublicacao(disponibilizacao: string, feriadosExtras?: ReadonlyMap<string, string>): string {
  return proximo(validarIso(disponibilizacao), (d) => semExpediente(d, feriadosExtras), []);
}
