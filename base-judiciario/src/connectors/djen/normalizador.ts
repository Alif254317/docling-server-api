import { parseCnj } from '../../domain/cnj.js';

/** Spec 002: resposta da API Comunica → comunicações normalizadas (função pura, C3). */

export interface ComunicacaoNormalizada {
  idDjen: number;
  dataDisponibilizacao: string;
  siglaTribunal: string | null;
  tipoComunicacao: string | null;
  tipoDocumento: string | null;
  orgao: string | null;
  classe: string | null;
  texto: string;
  numeroProcessoOriginal: string;
  /** 20 dígitos, ou `null` quando o número não é um CNJ válido (vai para revisão). */
  numeroCnj: string | null;
  cnjErro: string | null;
  meio: string | null;
  link: string | null;
  hashDjen: string | null;
  destinatarios: { nome: string; polo: string | null }[];
  advogados: { nome: string; oabNumero: string | null; oabUf: string | null }[];
}

export interface ResultadoNormalizacao {
  itens: ComunicacaoNormalizada[];
  erros: { indice: number; motivo: string }[];
}

type Obj = Record<string, unknown>;

function campo(o: Obj, ...nomes: string[]): unknown {
  for (const n of nomes) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n];
  return undefined;
}

function texto(o: Obj, ...nomes: string[]): string | null {
  const v = campo(o, ...nomes);
  return v === undefined ? null : String(v).trim();
}

function dataIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  if (iso) return iso[1]!;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

function lista(v: unknown): Obj[] {
  return Array.isArray(v) ? v.filter((x): x is Obj => x !== null && typeof x === 'object') : [];
}

export function normalizarItemDjen(it: Obj): ComunicacaoNormalizada {
  const id = Number(campo(it, 'id', 'idComunicacao'));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('item sem id numérico');
  const data = dataIso(campo(it, 'data_disponibilizacao', 'dataDisponibilizacao', 'datadisponibilizacao'));
  if (!data) throw new Error(`item ${id} sem data de disponibilização`);
  const numeroOriginal =
    texto(it, 'numero_processo', 'numeroProcesso', 'numeroprocessocommascara', 'numeroProcessoComMascara') ?? '';

  let numeroCnj: string | null = null;
  let cnjErro: string | null = null;
  try {
    numeroCnj = parseCnj(numeroOriginal).numero;
  } catch (e) {
    cnjErro = (e as Error).message;
  }

  return {
    idDjen: id,
    dataDisponibilizacao: data,
    siglaTribunal: texto(it, 'siglaTribunal', 'sigla_tribunal'),
    tipoComunicacao: texto(it, 'tipoComunicacao', 'tipo_comunicacao'),
    tipoDocumento: texto(it, 'tipoDocumento', 'tipo_documento'),
    orgao: texto(it, 'nomeOrgao', 'nome_orgao', 'orgao'),
    classe: texto(it, 'nomeClasse', 'nome_classe'),
    texto: texto(it, 'texto') ?? '',
    numeroProcessoOriginal: numeroOriginal,
    numeroCnj,
    cnjErro,
    meio: texto(it, 'meiocompleto', 'meio'),
    link: texto(it, 'link'),
    hashDjen: texto(it, 'hash'),
    destinatarios: lista(campo(it, 'destinatarios')).map((d) => ({
      nome: texto(d, 'nome') ?? '',
      polo: texto(d, 'polo'),
    })),
    advogados: lista(campo(it, 'destinatarioadvogados', 'destinatarioAdvogados')).map((d) => {
      const a = (campo(d, 'advogado') as Obj | undefined) ?? d;
      return {
        nome: texto(a, 'nome') ?? '',
        oabNumero: texto(a, 'numero_oab', 'numeroOab'),
        oabUf: texto(a, 'uf_oab', 'ufOab'),
      };
    }),
  };
}

export function normalizarDjen(resposta: unknown): ResultadoNormalizacao {
  const itensBrutos = (resposta as Obj | null)?.items;
  if (!Array.isArray(itensBrutos)) throw new Error('resposta do DJEN sem lista "items"');
  const out: ResultadoNormalizacao = { itens: [], erros: [] };
  itensBrutos.forEach((it, indice) => {
    try {
      out.itens.push(normalizarItemDjen(it as Obj));
    } catch (e) {
      out.erros.push({ indice, motivo: (e as Error).message });
    }
  });
  return out;
}
