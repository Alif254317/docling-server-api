# Plano técnico — Spec 004

## Conformidade com a constituição
| Princípio | Como este plano cumpre |
| --- | --- |
| C8 | `evento.escritorio_id` obrigatório; webhooks filtrados pelo mesmo escritório. |
| C9 | Segredo nunca logado; ADR-001 registra a exceção temporária. |

## Módulos
- `src/eventos/outbox.ts` — `emitirEvento(client, {...})` com `ON CONFLICT (chave) DO NOTHING`; devolve se criou.
- `src/eventos/entregador.ts` — `entregarLote()` pega até N pendentes vencidos com `FOR UPDATE SKIP LOCKED`, entrega, atualiza.
- Job repetido `entregar-eventos` a cada 15 s na fila `eventos`, separada da fila `agenda` para um webhook lento não atrasar coletas.
- Até 10 entregas em paralelo por lote; reserva de 5 min com token (`evento.reserva`, migration 002).

## Decisões
- Bloqueio por linha (`SKIP LOCKED`) em vez de fila Redis para a entrega: o estado vive onde o evento nasce.
- Assinatura HMAC-SHA256 do corpo exato enviado.
