import pino from 'pino';

/** C9: campos sensíveis nunca saem no log. */
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info'),
  redact: {
    paths: ['segredo', '*.segredo', 'chave', '*.chave', 'authorization', '*.authorization', 'headers.authorization', 'senha', '*.senha'],
    censor: '[oculto]',
  },
});
