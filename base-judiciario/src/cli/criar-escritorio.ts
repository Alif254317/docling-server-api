import pg from 'pg';
import { config } from '../config.js';
import { criarEscritorio } from '../domain/escritorios.js';

const nome = process.argv.slice(2).join(' ').trim();
if (!nome) {
  console.error('uso: npm run escritorio:criar -- "Nome do escritório"');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: config.databaseUrl });
try {
  const e = await criarEscritorio(pool, nome);
  console.log(`escritório ${e.id}\nchave de API (guarde agora, não será mostrada de novo): ${e.chave}`);
} finally {
  await pool.end();
}
