import pg from 'pg';
import { config } from '../config.js';
import { DatajudConector } from '../connectors/datajud/conector.js';
import { DjenConector } from '../connectors/djen/conector.js';
import { conectarRedis, criarFilas, iniciarWorkers } from '../jobs/filas.js';
import { log } from '../log.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const redis = conectarRedis(config.redisUrl);
const filas = criarFilas(redis);
const datajud = config.datajudApiKey
  ? new DatajudConector({ baseUrl: config.datajudBaseUrl, apiKey: config.datajudApiKey })
  : null;
if (!datajud) log.warn('DATAJUD_API_KEY ausente: enriquecimento pelo DataJud desligado');

const workers = await iniciarWorkers({
  pool,
  redis,
  filas,
  djen: new DjenConector({ baseUrl: config.djenBaseUrl }),
  datajud,
});
log.info('workers no ar: coleta-djen, coleta-datajud, manutencao');

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, async () => {
    await workers.fechar();
    await filas.fechar();
    redis.disconnect();
    await pool.end();
    process.exit(0);
  });
}
