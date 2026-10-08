import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizarDjen } from '../src/connectors/djen/normalizador.js';

const pagina = JSON.parse(
  readFileSync(new URL('./fixtures/djen/pagina-oab-12345-es.json', import.meta.url), 'utf8'),
) as { items: Record<string, unknown>[] };

describe('Spec 002 · normalizador DJEN', () => {
  it('normaliza os campos de cada item', () => {
    const { itens, erros } = normalizarDjen(pagina);
    expect(erros).toEqual([]);
    expect(itens).toHaveLength(3);
    expect(itens[0]).toMatchObject({
      idDjen: 480001,
      dataDisponibilizacao: '2026-10-05',
      siglaTribunal: 'TJES',
      tipoComunicacao: 'Intimação',
      tipoDocumento: 'Despacho',
      orgao: '1ª Vara Cível de Vitória',
      classe: 'PROCEDIMENTO COMUM CÍVEL',
      numeroCnj: '50001233120268080024',
      cnjErro: null,
      destinatarios: [{ nome: 'MARIA EXEMPLO', polo: 'A' }],
      advogados: [{ nome: 'ADVOGADA PILOTO', oabNumero: '12345', oabUf: 'ES' }],
    });
  });

  it('aceita variantes de nome de campo e data no formato brasileiro', () => {
    const { itens } = normalizarDjen({
      items: [
        {
          id: '9',
          dataDisponibilizacao: '05/10/2026',
          sigla_tribunal: 'TJES',
          numeroprocessocommascara: '5000123-31.2026.8.08.0024',
          texto: 'x',
        },
      ],
    });
    expect(itens[0]).toMatchObject({
      idDjen: 9,
      dataDisponibilizacao: '2026-10-05',
      siglaTribunal: 'TJES',
      numeroCnj: '50001233120268080024',
    });
  });

  it('marca CNJ inválido sem descartar o item (FR-7)', () => {
    const item = { ...pagina.items[0], numero_processo: '50001239920268080024' };
    const { itens } = normalizarDjen({ items: [item] });
    expect(itens[0]!.numeroCnj).toBeNull();
    expect(itens[0]!.cnjErro).toMatch(/dígito verificador/);
    expect(itens[0]!.numeroProcessoOriginal).toBe('50001239920268080024');
  });

  it('reporta como erro item sem id ou sem data', () => {
    const { itens, erros } = normalizarDjen({ items: [{ texto: 'sem id' }, { id: 1 }] });
    expect(itens).toEqual([]);
    expect(erros).toHaveLength(2);
  });

  it('recusa resposta sem lista de itens', () => {
    expect(() => normalizarDjen({ status: 'error' })).toThrow(/items/);
  });
});
