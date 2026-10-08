import { describe, expect, it } from 'vitest';
import { calcularDv, CnjInvalido, formatarCnj, parseCnj } from '../src/domain/cnj.js';

describe('Spec 001 · AC-2 · número CNJ', () => {
  it('aceita número válido formatado e devolve as partes', () => {
    const p = parseCnj('0000832-35.2018.4.01.3202');
    expect(p.numero).toBe('00008323520184013202');
    expect(p.segmento).toBe(4);
    expect(p.tribunal).toBe(1);
    expect(p.ano).toBe(2018);
    expect(p.origem).toBe('3202');
  });

  it('aceita número válido só com dígitos', () => {
    expect(parseCnj('50001233120268080024').formatado).toBe('5000123-31.2026.8.08.0024');
  });

  it('recusa dígito verificador trocado', () => {
    expect(() => parseCnj('0000832-36.2018.4.01.3202')).toThrow(CnjInvalido);
  });

  it('recusa formato com dígitos a menos', () => {
    expect(() => parseCnj('832-35.2018.4.01.3202')).toThrow(CnjInvalido);
  });

  it('calcula o DV para montar números de teste', () => {
    expect(calcularDv('0000832', '2018', '4', '01', '3202')).toBe('35');
  });

  it('formata 20 dígitos', () => {
    expect(formatarCnj('10004562320265170001')).toBe('1000456-23.2026.5.17.0001');
  });
});
