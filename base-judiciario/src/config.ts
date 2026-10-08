/** Configuração por variável de ambiente (C9: segredos nunca no código). */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/base_judiciario',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  djenBaseUrl: process.env.DJEN_BASE_URL ?? 'https://comunicaapi.pje.jus.br',
  datajudBaseUrl: process.env.DATAJUD_BASE_URL ?? 'https://api-publica.datajud.cnj.jus.br',
  datajudApiKey: process.env.DATAJUD_API_KEY ?? '',
  porta: Number(process.env.PORT ?? 3000),
};
