import { parseCnj } from '../../domain/cnj.js';
import { tribunalDoCnj } from '../../domain/tribunais.js';

export class SemIndiceDatajud extends Error {
  constructor(numero: string) {
    super(`Tribunal sem índice no DataJud para o processo ${numero}`);
    this.name = 'SemIndiceDatajud';
  }
}

/** Spec 003 · FR-1/FR-8: índice `api_publica_<alias>` a partir do número CNJ. */
export function indiceDatajud(numero: string): string {
  const p = parseCnj(numero);
  const t = tribunalDoCnj(p);
  if (!t?.aliasDatajud) throw new SemIndiceDatajud(p.formatado);
  return `api_publica_${t.aliasDatajud}`;
}
