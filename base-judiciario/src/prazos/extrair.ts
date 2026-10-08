/** Spec 005 · FR-3: quantidade de dias do prazo a partir do texto da intimação. */

const EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15,
  dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, noventa: 90,
};

const PALAVRAS = Object.keys(EXTENSO).sort((a, b) => b.length - a.length).join('|');

// "prazo [legal|comum|…] [de] N [(por extenso)] dias"
const PADRAO = new RegExp(
  String.raw`prazo[\s:]*(?:(?:legal|comum|improrrog[aá]vel|sucessivo|de)[\s:]+)*(\d{1,3}|${PALAVRAS})\s*(?:\([^)]{0,40}\)\s*)?(dias?|horas?|meses|m[eê]s|anos?)(?![\p{L}])`,
  'giu',
);

/** Prazo legal supletivo: CPC art. 218, §3º. */
export const DIAS_PADRAO = 5;

export interface DiasExtraidos {
  dias: number;
  origem: 'texto' | 'padrao';
  /** Verdadeiro quando o advogado precisa conferir (presumido ou ambíguo). */
  confirmar: boolean;
}

export function extrairDias(texto: string): DiasExtraidos {
  const achados = new Set<number>();
  for (const m of texto.matchAll(PADRAO)) {
    const unidade = m[2]!.toLowerCase();
    if (!unidade.startsWith('dia')) continue;
    const bruto = m[1]!.toLowerCase();
    const n = /^\d+$/.test(bruto) ? Number(bruto) : EXTENSO[bruto];
    if (n !== undefined && n >= 1 && n <= 365) achados.add(n);
  }
  if (achados.size === 0) return { dias: DIAS_PADRAO, origem: 'padrao', confirmar: true };
  // Regra de segurança: com prazos diferentes, o menor.
  return { dias: Math.min(...achados), origem: 'texto', confirmar: achados.size > 1 };
}
