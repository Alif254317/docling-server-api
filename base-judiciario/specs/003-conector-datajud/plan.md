# Plano técnico — Spec 003

## Conformidade com a constituição
| Princípio | Como este plano cumpre |
| --- | --- |
| C1 | Índice derivado do CNJ validado. |
| C2/C3 | Bruto gravado antes; normalizador puro. |
| C7 | `DatajudConector implements Conector<AlvoProcesso>`. |
| C9 | `DATAJUD_API_KEY` só em variável de ambiente; nunca logada. |

## Módulos
- `src/connectors/datajud/indice.ts` — J.TT → alias (tabela de tribunais especiais + UF).
- `src/connectors/datajud/conector.ts` — POST `_search`.
- `src/connectors/datajud/normalizador.ts` — hits → capa + movimentos (puro).
- `src/ingestao/datajud.ts` — transação de gravação, dedupe e eventos.
- Job `enriquecer-datajud` na fila `coleta`, enfileirado pela ingestão do DJEN para cada processo novo ou com comunicação nova.

## Decisões
- Hash do movimento inclui o grau, porque o mesmo código e data pode existir em G1 e G2.
- Capa vem do hit com `dataHoraUltimaAtualizacao` mais recente.
