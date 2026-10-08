import { ErroFonte, HTTP_PADRAO, Limitador, requisitarJson, type OpcoesHttp } from '../http.js';
import type { Conector, RespostaBruta } from '../types.js';

export type AlvoDjen = (
  | { tipo: 'oab'; numero: string; uf: string }
  | { tipo: 'processo'; numeroCnj: string }
) & {
  /** Janela de disponibilização, AAAA-MM-DD, inclusiva. */
  inicio: string;
  fim: string;
  /** Contexto gravado junto com a requisição para o reprocessamento religar o escritório. */
  contexto?: Record<string, unknown>;
};

export interface OpcoesDjen {
  baseUrl: string;
  itensPorPagina?: number;
  /** Proteção contra laço infinito; passar do limite é erro, não corte silencioso. */
  maxPaginas?: number;
  http?: Partial<Omit<OpcoesHttp, 'fonte'>>;
}

// Um limitador por processo para todas as instâncias: o limite é da API, não do conector.
const limitadorDjen = new Limitador(Number(process.env.DJEN_REQ_POR_SEGUNDO ?? 2));

/** Spec 002: API Comunica do CNJ (`GET /api/v1/comunicacao`), premissa P1. */
export class DjenConector implements Conector<AlvoDjen> {
  readonly fonte = 'djen' as const;
  private readonly itensPorPagina: number;
  private readonly maxPaginas: number;
  private readonly http: OpcoesHttp;

  constructor(private readonly opcoes: OpcoesDjen) {
    this.itensPorPagina = opcoes.itensPorPagina ?? 100;
    this.maxPaginas = opcoes.maxPaginas ?? 100;
    this.http = { ...HTTP_PADRAO, limitador: limitadorDjen, ...opcoes.http, fonte: 'djen' };
  }

  async *buscar(alvo: AlvoDjen): AsyncIterable<RespostaBruta> {
    for (let pagina = 1; ; pagina++) {
      if (pagina > this.maxPaginas) {
        throw new ErroFonte('djen', `mais de ${this.maxPaginas} páginas; aumente maxPaginas ou reduza a janela`);
      }
      const params: Record<string, string> = {
        dataDisponibilizacaoInicio: alvo.inicio,
        dataDisponibilizacaoFim: alvo.fim,
        pagina: String(pagina),
        itensPorPagina: String(this.itensPorPagina),
      };
      if (alvo.tipo === 'oab') {
        params.numeroOab = alvo.numero;
        params.ufOab = alvo.uf;
      } else {
        params.numeroProcesso = alvo.numeroCnj;
      }
      const url = `${this.opcoes.baseUrl}/api/v1/comunicacao?${new URLSearchParams(params)}`;
      const resposta = await requisitarJson(url, { headers: { accept: 'application/json' } }, this.http);
      const itens = (resposta as { items?: unknown[] } | null)?.items;
      if (!Array.isArray(itens)) {
        throw new ErroFonte('djen', 'resposta sem lista "items"');
      }
      yield {
        fonte: 'djen',
        requisicao: { caminho: '/api/v1/comunicacao', params, ...(alvo.contexto ? { contexto: alvo.contexto } : {}) },
        resposta,
      };
      const total = Number((resposta as { count?: unknown }).count);
      const lidos = (pagina - 1) * this.itensPorPagina + itens.length;
      if (itens.length < this.itensPorPagina || (Number.isFinite(total) && lidos >= total)) return;
    }
  }
}
