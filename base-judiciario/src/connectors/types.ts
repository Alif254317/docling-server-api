/** Constituição C7: todo conector segue esta interface. */

export type Fonte = 'djen' | 'datajud' | 'mni' | 'portal' | 'agregador';

/** Uma resposta da fonte, exatamente como chegou, com o que foi pedido. */
export interface RespostaBruta {
  fonte: Fonte;
  requisicao: Record<string, unknown>;
  resposta: unknown;
}

export interface Conector<Alvo> {
  readonly fonte: Fonte;
  /** Uma resposta bruta por página/chamada, em ordem. Erros sobem depois das tentativas. */
  buscar(alvo: Alvo): AsyncIterable<RespostaBruta>;
}
