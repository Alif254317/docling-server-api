# Spec 004 — Motor de eventos e webhooks

Status: aprovada · Fase: 1 · Depende de: 002, 003

## Contexto
O nosso sistema jurídico (e depois os clientes da API) recebe tudo o que muda
por webhook. Um evento perdido pode ser um prazo perdido.

## Histórias de usuário
1. Como sistema jurídico, quero receber cada evento por HTTP, assinado, para reagir sem consultar a base.
2. Como operador, quero ver eventos que não foram entregues.

## Requisitos funcionais
| ID | Requisito |
| --- | --- |
| FR-1 | Todo evento nasce na mesma transação do fato que o gera (outbox), com chave única de idempotência. |
| FR-2 | Entregar por `POST` JSON a cada webhook ativo do escritório, com cabeçalhos `X-Evento-Id`, `X-Evento-Tipo` e `X-Assinatura: sha256=<hmac>` do corpo. |
| FR-3 | Resposta 2xx marca entregue; outra resposta ou erro de rede agenda nova tentativa com espera crescente (1, 5, 15, 60, 240 min…). |
| FR-4 | Depois de 10 tentativas o evento fica `morto` e aparece na consulta de eventos não entregues. |
| FR-5 | Vários entregadores em paralelo não entregam o mesmo evento ao mesmo tempo; cada reserva tem um token e só quem a detém grava o resultado, então um evento entregue nunca volta a pendente. |
| FR-6 | Escritório sem webhook: evento fica pendente, é lido por `GET /eventos?situacao=pendente` e marcado entregue por `POST /eventos/confirmacoes`. |

## Garantia de entrega
Criação exatamente uma vez (chave única). Entrega pelo menos uma vez: o receptor
deve deduplicar por `X-Evento-Id`.

## Critérios de aceite
- **AC-1** Dado um evento pendente e um webhook que responde 200, quando o entregador roda, então o evento fica entregue e o corpo chegou com assinatura HMAC válida.
- **AC-2** Dado um webhook que responde 500, quando o entregador roda, então o evento continua pendente com `tentativas = 1` e próxima tentativa no futuro.
- **AC-3** Dado um evento com 9 tentativas falhas, quando a 10ª falha, então ele fica `morto`.
- **AC-4** Dado dois entregadores simultâneos e 20 eventos, então cada evento é enviado exatamente uma vez.
- **AC-5** Dado que a reserva de A expirou e B entregou o evento, quando A termina com falha, então o evento continua `entregue`.

## Privacidade (C8)
Cada evento pertence a um escritório e só vai para os webhooks dele.

## Premissas
- ADR-001: o segredo de assinatura do webhook fica no banco até existir o cofre (spec 006).
