# Spec 013 — API interna

Status: aprovada · Fase: 1 · Depende de: 001, 002, 004, 005

## Contexto
O nosso sistema jurídico precisa cadastrar o que monitorar e consultar o que
chegou. Esta API é interna; a API para clientes externos é a spec 012.

## Requisitos funcionais
| ID | Requisito |
| --- | --- |
| FR-1 | Autenticar por `Authorization: Bearer <chave>`; a chave identifica um escritório; só o hash fica no banco. |
| FR-2 | `POST /monitoramentos` (OAB ou processo), `GET /monitoramentos`, `DELETE /monitoramentos/:id`. |
| FR-3 | `GET /processos/:numeroCnj` com capa e movimentos, só se vinculado ao escritório. |
| FR-4 | `GET /comunicacoes?desde=AAAA-MM-DD` e `GET /prazos?ate=AAAA-MM-DD` do escritório. |
| FR-5 | `POST /webhooks` devolve o segredo uma única vez; `GET /eventos?situacao=` lista eventos. |
| FR-6 | `POST /prazos/calcular` (spec 005). |
| FR-7 | `GET /saude` sem autenticação; `GET /metricas` no formato Prometheus. |
| FR-8 | Entrada validada; erro 400 com mensagem; número CNJ inválido é recusado. |

## Critérios de aceite
- **AC-1** Sem chave ou com chave inválida → 401.
- **AC-2** Escritório A não vê processo, comunicação, prazo, evento ou monitoramento do B (404 ou lista vazia).
- **AC-3** `POST /monitoramentos` com OAB inválida (UF inexistente) → 400; repetido → 409.
- **AC-4** `POST /prazos/calcular` com o exemplo AC-1 da spec 005 → fim `2026-10-28`.
- **AC-5** `GET /metricas` expõe `coleta_execucoes_total` por fonte e situação.
