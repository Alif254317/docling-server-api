import { describe, expect, it } from 'vitest';
import { calcularPrazo } from '../src/prazos/calculo.js';
import { feriadosNacionais, pascoa, emRecesso } from '../src/prazos/calendario.js';
import { extrairDias } from '../src/prazos/extrair.js';

describe('Spec 005 · calendário', () => {
  it('calcula a Páscoa', () => {
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
  });

  it('lista feriados nacionais com Sexta-feira Santa e 20/11 a partir de 2024', () => {
    const f2027 = feriadosNacionais(2027);
    expect(f2027.get('2027-03-26')).toMatch(/Sexta-feira Santa/);
    expect(f2027.get('2027-11-20')).toBeDefined();
    expect(feriadosNacionais(2023).get('2023-11-20')).toBeUndefined();
  });

  it('marca o recesso de 20/12 a 20/01 inclusive', () => {
    expect(emRecesso('2026-12-19')).toBe(false);
    expect(emRecesso('2026-12-20')).toBe(true);
    expect(emRecesso('2027-01-20')).toBe(true);
    expect(emRecesso('2027-01-21')).toBe(false);
  });
});

describe('Spec 005 · cálculo de prazos', () => {
  it('AC-1 · 05/10/2026, 15 dias → fim 28/10/2026, pulando 12/10', () => {
    const r = calcularPrazo({ disponibilizacao: '2026-10-05', dias: 15 });
    expect(r.publicacao).toBe('2026-10-06');
    expect(r.inicio).toBe('2026-10-07');
    expect(r.fim).toBe('2026-10-28');
    expect(r.diasPulados).toContainEqual({ data: '2026-10-12', motivo: expect.stringMatching(/Aparecida/) });
  });

  it('AC-2 · 18/12/2026, 5 dias → publicação 21/12, início 21/01/2027, fim 27/01/2027', () => {
    const r = calcularPrazo({ disponibilizacao: '2026-12-18', dias: 5 });
    expect(r.publicacao).toBe('2026-12-21');
    expect(r.inicio).toBe('2027-01-21');
    expect(r.fim).toBe('2027-01-27');
  });

  it('AC-3 · Carnaval só conta se cadastrado para o tribunal', () => {
    expect(calcularPrazo({ disponibilizacao: '2027-02-05', dias: 5 }).fim).toBe('2027-02-15');
    const comCarnaval = calcularPrazo({
      disponibilizacao: '2027-02-05',
      dias: 5,
      feriadosExtras: new Map([
        ['2027-02-08', 'Carnaval (TJES)'],
        ['2027-02-09', 'Carnaval (TJES)'],
      ]),
    });
    expect(comCarnaval.publicacao).toBe('2027-02-10');
    expect(comCarnaval.fim).toBe('2027-02-17');
  });

  it('AC-4 · 24/03/2027, 5 dias → início 29/03 (Sexta-feira Santa), fim 02/04/2027', () => {
    const r = calcularPrazo({ disponibilizacao: '2027-03-24', dias: 5 });
    expect(r.publicacao).toBe('2027-03-25');
    expect(r.inicio).toBe('2027-03-29');
    expect(r.fim).toBe('2027-04-02');
  });

  it('recusa quantidade de dias fora de 1..365 e data malformada', () => {
    expect(() => calcularPrazo({ disponibilizacao: '2026-10-05', dias: 0 })).toThrow();
    expect(() => calcularPrazo({ disponibilizacao: '05/10/2026', dias: 5 })).toThrow();
  });
});

describe('Spec 005 · AC-5 · extração de dias do texto', () => {
  it.each([
    ['Intime-se para manifestação no prazo de 5 (cinco) dias.', 5],
    ['no prazo de quinze dias, sob pena de preclusão', 15],
    ['PRAZO: 10 DIAS ÚTEIS', 10],
    ['para, no prazo legal de 30 (trinta) dias, contestar', 30],
    ['no prazo comum de dez dias', 10],
  ])('"%s" → %i dias (texto)', (texto, dias) => {
    expect(extrairDias(texto)).toEqual({ dias, origem: 'texto', confirmar: false });
  });

  it('texto sem prazo → 5 dias (CPC art. 218, §3º), a confirmar', () => {
    expect(extrairDias('Vistos. Cite-se.')).toEqual({ dias: 5, origem: 'padrao', confirmar: true });
  });

  it('prazos diferentes no mesmo texto → o menor, a confirmar', () => {
    expect(extrairDias('prazo de 5 dias para o autor e prazo de 10 dias para o réu')).toEqual({
      dias: 5,
      origem: 'texto',
      confirmar: true,
    });
  });

  it('ignora prazo em horas', () => {
    expect(extrairDias('no prazo de 48 horas')).toEqual({ dias: 5, origem: 'padrao', confirmar: true });
  });
});
