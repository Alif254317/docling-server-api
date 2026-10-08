import { createHash } from 'node:crypto';

/** JSON com chaves ordenadas: o mesmo conteúdo gera sempre o mesmo texto. */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor));
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, ordenar((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

export function hashCanonico(valor: unknown): string {
  return sha256(jsonCanonico(valor));
}
