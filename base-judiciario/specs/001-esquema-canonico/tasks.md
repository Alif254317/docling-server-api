# Tarefas — Spec 001

- [x] T01 [P] Teste: validador CNJ, casos válidos, DV errado, formato errado (AC-2)
- [x] T02 [P] Teste: migrations sobem, descem e sobem de novo (AC-1)
- [x] T03 [P] Teste: payload bruto imutável e deduplicado (AC-3, AC-4)
- [x] T04 [P] Teste: `fonte`/`coletado_em` obrigatórios (AC-5)
- [x] T05 Validador CNJ (FR-1)
- [x] T06 Migration 001: tabelas, índices, gatilho de imutabilidade, seed de tribunais (FR-2..FR-5, FR-7)
- [x] T07 Runner de migrations com up/down e advisory lock (FR-6)
- [x] T08 `gravarBruto()` com hash canônico (FR-2)
- [x] T09 Teste de isolamento entre escritórios pela API (AC-6) — coberto em `test/api.test.ts`
