import { parseCnj } from '../../domain/cnj.js';
import { HTTP_PADRAO, Limitador, requisitarJson, type OpcoesHttp } from '../http.js';
import type { Conector, RespostaBruta } from '../types.js';
import { indiceDatajud } from './indice.js';

export interface AlvoDatajud {
  numeroCnj: string;
  /** Gravado com a requisição para o reprocessamento religar o escritório. */
  contexto?: Record<string, unknown>;
}

export interface OpcoesDatajud {
  baseUrl: string;
  /** Chave pública do CNJ; vem de `DATAJUD_API_KEY` (C9), nunca é gravada no bruto. */
  apiKey: string;
  http?: Partial<Omit<OpcoesHttp, 'fonte'>>;
}

const limitadorDatajud = new Limitador(Number(process.env.DATAJUD_REQ_POR_SEGUNDO ?? 5));

/** Spec 003: `POST /api_publica_<alias>/_search` por número de processo (premissa P1). */
export class DatajudConector implements Conector<AlvoDatajud> {
  readonly fonte = 'datajud' as const;
  private readonly http: OpcoesHttp;

  constructor(private readonly opcoes: OpcoesDatajud) {
    if (!opcoes.apiKey) throw new Error('DATAJUD_API_KEY não configurada');
    this.http = { ...HTTP_PADRAO, limitador: limitadorDatajud, ...opcoes.http, fonte: 'datajud' };
  }

  async *buscar(alvo: AlvoDatajud): AsyncIterable<RespostaBruta> {
    const numeroCnj = parseCnj(alvo.numeroCnj).numero;
    const indice = indiceDatajud(numeroCnj);
    const consulta = { query: { match: { numeroProcesso: numeroCnj } } };
    const resposta = await requisitarJson(
      `${this.opcoes.baseUrl}/${indice}/_search`,
      {
        method: 'POST',
        headers: {
          authorization: `APIKey ${this.opcoes.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(consulta),
      },
      this.http,
    );
    yield {
      fonte: 'datajud',
      requisicao: { indice, numeroCnj, consulta, ...(alvo.contexto ? { contexto: alvo.contexto } : {}) },
      resposta,
    };
  }
}
