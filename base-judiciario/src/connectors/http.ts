import { setTimeout as esperar } from 'node:timers/promises';
import { contadorRequisicoesFonte } from '../metricas.js';

export class ErroFonte extends Error {
  constructor(
    readonly fonte: string,
    mensagem: string,
    readonly status?: number,
  ) {
    super(`[${fonte}] ${mensagem}`);
    this.name = 'ErroFonte';
  }
}

/** Limitador simples de vazão por processo: no máximo `porSegundo` chamadas por segundo. */
export class Limitador {
  private proxima = 0;
  constructor(private readonly porSegundo: number) {}
  async aguardar(): Promise<void> {
    const intervalo = 1000 / this.porSegundo;
    const agora = Date.now();
    const vez = Math.max(agora, this.proxima);
    this.proxima = vez + intervalo;
    if (vez > agora) await esperar(vez - agora);
  }
}

export interface OpcoesHttp {
  fonte: string;
  /** Total de tentativas, contando a primeira. */
  tentativas: number;
  esperaBaseMs: number;
  esperaMaxMs: number;
  timeoutMs: number;
  limitador?: Limitador;
}

export const HTTP_PADRAO: Omit<OpcoesHttp, 'fonte'> = {
  tentativas: 3,
  esperaBaseMs: 1000,
  esperaMaxMs: 60_000,
  timeoutMs: 30_000,
};

function repetivel(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMs(valor: string | null): number | undefined {
  if (!valor) return undefined;
  const s = Number(valor);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(valor);
  return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
}

/**
 * Chamada JSON com timeout, tentativas e espera exponencial; respeita
 * `Retry-After`. Erro 4xx (exceto 408/429) não é repetido.
 */
export async function requisitarJson(url: string, init: RequestInit, op: OpcoesHttp): Promise<unknown> {
  let ultimo: ErroFonte | undefined;
  for (let t = 1; t <= op.tentativas; t++) {
    await op.limitador?.aguardar();
    let espera = Math.min(op.esperaMaxMs, op.esperaBaseMs * 2 ** (t - 1));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(op.timeoutMs) });
      contadorRequisicoesFonte.inc({ fonte: op.fonte, status: String(res.status) });
      if (res.ok) {
        const texto = await res.text();
        try {
          return JSON.parse(texto) as unknown;
        } catch {
          throw new ErroFonte(op.fonte, `resposta não é JSON (HTTP ${res.status})`, res.status);
        }
      }
      const corpo = (await res.text()).slice(0, 300);
      ultimo = new ErroFonte(op.fonte, `HTTP ${res.status}: ${corpo}`, res.status);
      if (!repetivel(res.status)) throw ultimo;
      espera = Math.min(op.esperaMaxMs, retryAfterMs(res.headers.get('retry-after')) ?? espera);
    } catch (e) {
      if (e instanceof ErroFonte && e.status !== undefined && !repetivel(e.status)) throw e;
      if (!(e instanceof ErroFonte)) {
        contadorRequisicoesFonte.inc({ fonte: op.fonte, status: 'erro_rede' });
        ultimo = new ErroFonte(op.fonte, `falha de rede: ${(e as Error).message}`);
      } else {
        ultimo = e;
      }
    }
    if (t < op.tentativas) await esperar(espera);
  }
  throw ultimo ?? new ErroFonte(op.fonte, 'falha desconhecida');
}
