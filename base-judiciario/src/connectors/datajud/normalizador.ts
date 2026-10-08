import { hashCanonico } from '../../domain/hash.js';

/** Spec 003: resposta `_search` do DataJud → capa + movimentos (função pura, C3). */

export interface CapaDatajud {
  numeroCnj: string;
  tribunal: string | null;
  classeCodigo: number | null;
  classeNome: string | null;
  assuntos: { codigo: number | null; nome: string | null }[];
  orgaoJulgador: { codigo: number | null; nome: string | null; codigoMunicipioIBGE: number | null } | null;
  graus: string[];
  sistema: string | null;
  formato: string | null;
  nivelSigilo: number | null;
  dataAjuizamento: string | null;
  ultimaAtualizacao: string | null;
}

export interface MovimentoDatajud {
  grau: string | null;
  codigo: number;
  nome: string;
  dataHora: string;
  complementos: unknown[];
  hash: string;
}

type Obj = Record<string, unknown>;

/** `2026-01-15T10:30:00.000Z` ou `20260115103000` (horário de Brasília) → ISO UTC. */
export function parseDataHoraDatajud(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const c = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(v);
  const iso = c ? `${c[1]}-${c[2]}-${c[3]}T${c[4]}:${c[5]}:${c[6]}-03:00` : v;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v));
const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

function assuntos(v: unknown): CapaDatajud['assuntos'] {
  // Alguns tribunais mandam listas aninhadas.
  const plano = Array.isArray(v) ? (v.flat(2) as unknown[]) : [];
  return plano.map((a) => ({ codigo: num(obj(a).codigo), nome: str(obj(a).nome) }));
}

export function normalizarDatajud(resposta: unknown): { capa: CapaDatajud; movimentos: MovimentoDatajud[] } | null {
  const hits = obj(obj(resposta).hits).hits;
  if (!Array.isArray(hits)) throw new Error('resposta do DataJud sem hits.hits');
  const fontes = hits.map((h) => obj(obj(h)._source)).filter((s) => typeof s.numeroProcesso === 'string');
  if (fontes.length === 0) return null;

  // Capa: registro atualizado mais recentemente entre os graus.
  const ordenadas = [...fontes].sort((a, b) =>
    String(parseDataHoraDatajud(b.dataHoraUltimaAtualizacao) ?? '').localeCompare(
      String(parseDataHoraDatajud(a.dataHoraUltimaAtualizacao) ?? ''),
    ),
  );
  const s = ordenadas[0]!;
  const orgao = obj(s.orgaoJulgador);
  const capa: CapaDatajud = {
    numeroCnj: String(s.numeroProcesso),
    tribunal: str(s.tribunal),
    classeCodigo: num(obj(s.classe).codigo),
    classeNome: str(obj(s.classe).nome),
    assuntos: assuntos(s.assuntos),
    orgaoJulgador: Object.keys(orgao).length
      ? { codigo: num(orgao.codigo), nome: str(orgao.nome), codigoMunicipioIBGE: num(orgao.codigoMunicipioIBGE) }
      : null,
    graus: [...new Set(fontes.map((f) => str(f.grau)).filter((g): g is string => g !== null))].sort(),
    sistema: str(obj(s.sistema).nome),
    formato: str(obj(s.formato).nome),
    nivelSigilo: num(s.nivelSigilo),
    dataAjuizamento: parseDataHoraDatajud(s.dataAjuizamento),
    ultimaAtualizacao: parseDataHoraDatajud(s.dataHoraUltimaAtualizacao),
  };

  const movimentos: MovimentoDatajud[] = [];
  const vistos = new Set<string>();
  for (const f of fontes) {
    const grau = str(f.grau);
    for (const m of Array.isArray(f.movimentos) ? f.movimentos : []) {
      const mo = obj(m);
      const dataHora = parseDataHoraDatajud(mo.dataHora);
      const codigo = num(mo.codigo);
      if (dataHora === null || codigo === null) continue;
      const complementos = Array.isArray(mo.complementosTabelados) ? mo.complementosTabelados : [];
      const hash = hashCanonico({ grau, codigo, dataHora, complementos });
      if (vistos.has(hash)) continue;
      vistos.add(hash);
      movimentos.push({ grau, codigo, nome: str(mo.nome) ?? '', dataHora, complementos, hash });
    }
  }
  return { capa, movimentos };
}
