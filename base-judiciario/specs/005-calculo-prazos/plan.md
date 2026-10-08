# Plano técnico — Spec 005

## Conformidade com a constituição
| Princípio | Como este plano cumpre |
| --- | --- |
| C3 | Prazo é derivado da comunicação e pode ser recalculado. |
| C6 | AC-1 a AC-5 são testes unitários puros; AC-6 é teste de integração. |

## Módulos
- `src/prazos/calendario.ts` — Páscoa (algoritmo de Meeus), feriados nacionais, recesso, `ehDiaUtil()` com feriados extras.
- `src/prazos/calculo.ts` — `calcularPrazo({disponibilizacao, dias, feriadosExtras})` puro, com datas ISO `YYYY-MM-DD` (sem fuso).
- `src/prazos/extrair.ts` — extração de dias do texto (numerais e por extenso até 60).
- `src/prazos/servico.ts` — carrega feriados do tribunal do banco e grava `prazo` + evento.

## Decisões
- Datas como string ISO e aritmética em UTC para evitar erro de fuso.
- A regra de segurança ("na dúvida, mais cedo") está na spec, não escondida no código.
