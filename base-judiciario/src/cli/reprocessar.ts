import pg from 'pg';
import { config } from '../config.js';
import { reprocessar } from '../ingestao/reprocessar.js';

const fonte = process.argv[2];
if (fonte !== 'djen' && fonte !== 'datajud') {
  console.error('uso: npm run reprocessar -- djen|datajud');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: config.databaseUrl });
try {
  console.log(await reprocessar(pool, fonte));
} finally {
  await pool.end();
}
