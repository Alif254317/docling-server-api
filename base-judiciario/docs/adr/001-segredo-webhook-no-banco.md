# ADR-001 — Segredo de webhook no banco até existir o cofre

Data: 2026-10-08 · Situação: aceita, temporária · Princípio afetado: C9

## Contexto
A assinatura HMAC dos webhooks (spec 004) precisa do segredo em claro no momento
do envio. O cofre de segredos é a spec 006, da fase 2.

## Decisão
Guardar o segredo na tabela `webhook`, gerado por nós (32 bytes aleatórios),
mostrado ao escritório uma única vez e nunca logado.

## Consequências
Quem tiver leitura do banco pode forjar assinaturas. Revogar esta ADR na spec 006
movendo o segredo para o cofre.
