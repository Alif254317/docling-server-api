import type { CnjPartes } from './cnj.js';

/** Código TT → UF para a Justiça Estadual (J=8) e Eleitoral (J=6). */
const UF_POR_TT: Record<number, string> = {
  1: 'AC', 2: 'AL', 3: 'AP', 4: 'AM', 5: 'BA', 6: 'CE', 7: 'DF', 8: 'ES', 9: 'GO', 10: 'MA',
  11: 'MT', 12: 'MS', 13: 'MG', 14: 'PA', 15: 'PB', 16: 'PR', 17: 'PE', 18: 'PI', 19: 'RJ', 20: 'RN',
  21: 'RS', 22: 'RO', 23: 'RR', 24: 'SC', 25: 'SE', 26: 'SP', 27: 'TO',
};

export const UFS = new Set(Object.values(UF_POR_TT));

const ESPECIAIS: Record<string, { sigla: string; alias: string | null }> = {
  '1.0': { sigla: 'STF', alias: null },
  '2.0': { sigla: 'CNJ', alias: null },
  '3.0': { sigla: 'STJ', alias: 'stj' },
  '5.0': { sigla: 'TST', alias: 'tst' },
  '6.0': { sigla: 'TSE', alias: 'tse' },
  '7.0': { sigla: 'STM', alias: 'stm' },
  '9.13': { sigla: 'TJMMG', alias: 'tjmmg' },
  '9.21': { sigla: 'TJMRS', alias: 'tjmrs' },
  '9.26': { sigla: 'TJMSP', alias: 'tjmsp' },
};

export interface TribunalDerivado {
  sigla: string;
  /** Alias do índice no DataJud (`api_publica_<alias>`), ou `null` se não há. */
  aliasDatajud: string | null;
}

/** Tribunal a partir do segmento J e do código TT do número CNJ. */
export function tribunalDoCnj(p: Pick<CnjPartes, 'segmento' | 'tribunal'>): TribunalDerivado | null {
  const esp = ESPECIAIS[`${p.segmento}.${p.tribunal}`];
  if (esp) return { sigla: esp.sigla, aliasDatajud: esp.alias };
  const uf = UF_POR_TT[p.tribunal];
  switch (p.segmento) {
    case 4:
      return p.tribunal >= 1 && p.tribunal <= 6 ? { sigla: `TRF${p.tribunal}`, aliasDatajud: `trf${p.tribunal}` } : null;
    case 5:
      return p.tribunal >= 1 && p.tribunal <= 24 ? { sigla: `TRT${p.tribunal}`, aliasDatajud: `trt${p.tribunal}` } : null;
    case 6:
      return uf ? { sigla: `TRE-${uf}`, aliasDatajud: `tre-${uf.toLowerCase()}` } : null;
    case 8:
      return uf ? { sigla: uf === 'DF' ? 'TJDFT' : `TJ${uf}`, aliasDatajud: uf === 'DF' ? 'tjdft' : `tj${uf.toLowerCase()}` } : null;
    default:
      return null;
  }
}
