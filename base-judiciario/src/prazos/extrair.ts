/** Spec 005 · FR-3: quantidade de dias do prazo a partir do texto da intimação. */

const UNIDADES: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15,
  dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const DEZENAS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};

const alt = (o: Record<string, number>) => Object.keys(o).sort((a, b) => b.length - a.length).join('|');
const EXTENSO = String.raw`(?:(?:${alt(DEZENAS)})(?:\s+e\s+(?:${alt(UNIDADES)}))?|${alt(UNIDADES)})`;
const N = String.raw`(\d{1,3}|${EXTENSO})`;
const PAREN = String.raw`(?:\s*\([^)]{0,40}\))?`;
const UNIDADE = String.raw`(dias?|horas?|meses|m[eê]s|anos?)(?![\p{L}])`;
const QUALIFICADOR = String.raw`(?:\s+(úteis|uteis|corridos))?`;

// Qualquer "N [(por extenso)] dias" no texto.
const QUANTIDADE = new RegExp(String.raw`(?<![\p{L}\d])${N}${PAREN}\s*${UNIDADE}${QUALIFICADOR}`, 'giu');
// O caso claro: "prazo [legal|comum|…] [de] N … dias".
const PRAZO_EXPLICITO = new RegExp(
  String.raw`prazo[\s:]*(?:(?:legal|comum|improrrog[aá]vel|sucessivo|de)[\s:]+)*${N}${PAREN}\s*dias?(?![\p{L}])`,
  'giu',
);

/** Prazo legal supletivo: CPC art. 218, §3º. */
export const DIAS_PADRAO = 5;

export interface DiasExtraidos {
  dias: number;
  origem: 'texto' | 'padrao';
  /** Verdadeiro quando o advogado precisa conferir (presumido, ambíguo ou em dias corridos). */
  confirmar: boolean;
}

function valor(bruto: string): number | undefined {
  const b = bruto.toLowerCase().replace(/\s+/g, ' ');
  if (/^\d+$/.test(b)) return Number(b);
  const [dezena, unidade] = b.split(' e ');
  if (unidade !== undefined) {
    const d = DEZENAS[dezena!];
    const u = UNIDADES[unidade];
    return d !== undefined && u !== undefined ? d + u : undefined;
  }
  return DEZENAS[b] ?? UNIDADES[b];
}

/**
 * Regra de segurança: todo "N dias" do texto conta, e vale o menor. Só não pede
 * conferência quando há um único número, num "prazo de N dias" explícito, e não
 * em dias corridos.
 */
export function extrairDias(texto: string): DiasExtraidos {
  const achados = new Set<number>();
  let corridos = false;
  for (const m of texto.matchAll(QUANTIDADE)) {
    if (!m[2]!.toLowerCase().startsWith('dia')) continue;
    const n = valor(m[1]!);
    if (n === undefined || n < 1 || n > 365) continue;
    achados.add(n);
    if (m[3]?.toLowerCase() === 'corridos') corridos = true;
  }
  if (achados.size === 0) return { dias: DIAS_PADRAO, origem: 'padrao', confirmar: true };
  const explicito = [...texto.matchAll(PRAZO_EXPLICITO)].some((m) => valor(m[1]!) !== undefined);
  return { dias: Math.min(...achados), origem: 'texto', confirmar: achados.size > 1 || corridos || !explicito };
}
