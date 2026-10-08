import pg from 'pg';
import { config } from '../config.js';
import { migrar } from '../db/migrate.js';

const direcao = process.argv[2] === 'down' ? 'down' : 'up';
const passos = process.argv[3] ? Number(process.argv[3]) : direcao === 'down' ? 1 : Infinity;
const pool = new pg.Pool({ connectionString: config.databaseUrl });
try {
  const feitas = await migrar(pool, direcao, passos);
  console.log(feitas.length ? `${direcao}: ${feitas.join(', ')}` : 'nada a fazer');
} finally {
  await pool.end();
}
