import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { migrar } from '../src/db/migrate.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/base_judiciario_test';

/** Pool novo com o esquema recriado do zero. */
export async function bancoLimpo(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrar(pool, 'up');
  return pool;
}

export interface RequisicaoRecebida {
  method: string;
  url: URL;
  headers: IncomingMessage['headers'];
  body: string;
}

export type Responder = (req: RequisicaoRecebida) =>
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>;

/** Servidor HTTP local que imita uma fonte externa e guarda o que recebeu. */
export async function servidorFalso(responder: Responder): Promise<{
  url: string;
  recebidas: RequisicaoRecebida[];
  trocar(r: Responder): void;
  fechar(): Promise<void>;
}> {
  let atual = responder;
  const recebidas: RequisicaoRecebida[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', async () => {
      const r: RequisicaoRecebida = {
        method: req.method ?? 'GET',
        url: new URL(req.url ?? '/', 'http://localhost'),
        headers: req.headers,
        body: Buffer.concat(partes).toString('utf8'),
      };
      recebidas.push(r);
      const out = await atual(r);
      res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers });
      res.end(out.body === undefined ? '' : JSON.stringify(out.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    recebidas,
    trocar(r) {
      atual = r;
    },
    fechar: () => new Promise((ok) => server.close(() => ok())),
  };
}
