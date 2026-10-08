# Plano técnico — Spec 002

## Conformidade com a constituição
| Princípio | Como este plano cumpre |
| --- | --- |
| C2 | Cada página vira uma linha em `payload_bruto` antes da normalização, na mesma transação. |
| C3 | `normalizarDjen(resposta)` é função pura; `reprocessar('djen')` relê o bruto. |
| C6 | `test/djen.acceptance.test.ts` tem um teste por AC, contra servidor HTTP falso local. |
| C7 | `DjenConector implements Conector<AlvoOab>`. |
| C9 | Nenhum segredo: a API Comunica é pública. |

## Módulos
- `src/connectors/types.ts` — interface `Conector` e tipo `RespostaBruta`.
- `src/connectors/http.ts` — `fetch` com timeout, tentativas, espera exponencial, `Retry-After` e limitador por fonte.
- `src/connectors/djen/conector.ts` — monta a consulta e pagina (`itensPorPagina=100`).
- `src/connectors/djen/normalizador.ts` — resposta → `ComunicacaoNormalizada[]` (pura).
- `src/ingestao/djen.ts` — transação: grava bruto, upsert de processo e comunicação, vínculos, eventos.
- `src/ingestao/coleta.ts` — executa a coleta de um monitoramento e grava `execucao_coleta`.
- `src/ingestao/reprocessar.ts` — reprocessamento por fonte.
- `src/jobs/` — fila BullMQ `coleta`, agendador que enfileira monitoramentos vencidos com `jobId` determinístico.

## Decisões
- Janela de consulta: de ontem até hoje (fuso São Paulo), para pegar disponibilizações tardias; o dedupe por `id_djen` absorve a sobreposição.
- Evento gravado na mesma transação da comunicação (outbox), com chave `comunicacao.nova:<id>:<escritorio>` única → FR-5.
- Reprocessamento usa a mesma função de upsert com `emitirEventos=false`.
- Data de publicação = primeiro dia útil seguinte à disponibilização (Lei 11.419/2006, art. 4º, §3º), calculada pelo módulo de prazos.

## Riscos
- Formato real da API divergir da premissa P1 → normalizador tolerante + teste de contrato diário (`npm run spike:djen`).
