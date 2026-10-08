import pg from 'pg';
import { criarApp } from '../api/app.js';
import { config } from '../config.js';
import { log } from '../log.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const app = await criarApp({ pool });
await app.listen({ port: config.porta, host: '0.0.0.0' });
log.info({ porta: config.porta }, 'API no ar');

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
