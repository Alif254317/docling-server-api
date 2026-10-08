# Tarefas — Spec 002

- [x] T01 Contrato: fixture da resposta da API Comunica em `test/fixtures/djen/` (premissa P1)
- [x] T02 [P] Teste: normalizador (campos, variantes de nome, CNJ inválido) — unitário
- [x] T03 [P] Teste: AC-1 a AC-6 como testes de aceite, todos falhando antes do código
- [x] T04 Cliente HTTP com limitador, tentativas e `Retry-After` (FR-1, RNF)
- [x] T05 Gravação do bruto com hash (FR-2)
- [x] T06 Normalizador e upsert de Comunicação e Processo (FR-3, FR-4, FR-7)
- [x] T07 Outbox e eventos `comunicacao.nova` / `comunicacao.revisao` (FR-5, FR-7)
- [x] T08 Execução de coleta registrada e evento `coleta.falhou` (FR-6, AC-3)
- [x] T09 Fila BullMQ e agendador por monitoramento (FR-1)
- [x] T10 Comando de reprocessamento (FR-8, AC-5)
- [ ] T11 Rodar 7 dias em sombra com a OAB piloto e comparar com a conferência manual do escritório (depende de acesso de rede ao DJEN)
- [x] T12 Revisão independente: janela desde a última coleta boa (FR-9, AC-7), item com data inválida isolado (FR-10, AC-8), prazo só por OAB (FR-11, AC-9), contexto do dono no bruto (FR-8) — `test/revisao.test.ts`
