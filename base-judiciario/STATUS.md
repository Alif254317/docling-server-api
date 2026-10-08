# Status — 2026-10-08

Fase 1 (núcleo) construída e testada contra fontes simuladas: 83 testes, todos verdes. Falta o que
depende de rede até o CNJ e de pessoas: os spikes da fase 0 e a validação com o
escritório piloto.

## Pronto e verificado

| Spec | Entrega | Verificação |
| --- | --- | --- |
| 001 | Esquema canônico, validador CNJ, bruto imutável, migrations up/down | AC-1..AC-5 em `test/esquema.test.ts`, `test/cnj.test.ts`; AC-6 em `test/api.test.ts` |
| 002 | Conector DJEN, paginação, tentativas, outbox, revisão de CNJ inválido, reprocessamento | AC-1..AC-6 em `test/djen.acceptance.test.ts` |
| 003 | Conector DataJud, índice por J.TT, capa, movimentos sem duplicar, `movimento.novo` | AC-1..AC-4 em `test/datajud.test.ts` |
| 004 | Entrega de eventos por webhook com HMAC, espera crescente, `morto`, concorrência | AC-1..AC-4 em `test/eventos.test.ts` |
| 005 | Prazos em dias úteis com recesso, feriados nacionais e do tribunal, extração de dias | AC-1..AC-6 em `test/prazos.test.ts` e `test/djen.acceptance.test.ts` |
| 013 | API interna com isolamento por escritório | AC-1..AC-5 em `test/api.test.ts` |
| — | Fila de ponta a ponta: agenda → DJEN → DataJud → webhook | `test/jobs.test.ts` (Redis real) |

Também verificado à mão: API e worker sobem com `npm run api` e `npm run worker`;
sem acesso ao CNJ, a coleta falha de forma registrada (`execucao_coleta.situacao = falha`
e evento `coleta.falhou`), como manda a spec 002 · AC-3.

## Revisão independente

Um agente revisor, sem contexto da construção, procurou bugs e achou 11. Todos
foram corrigidos, com um teste em `test/revisao.test.ts` ou `test/prazos.test.ts`
que falha no código antigo e passa no novo (15 testes de regressão). Os mais graves:

1. A extração de dias olhava só "prazo de N dias": "prazo de 10 dias para o réu e 5 para o autor" virava 10, `aberto`. Agora todo "N dias" conta, vale o menor e pede conferência.
2. Um entregador lento podia reverter um evento já entregue para `pendente`. Agora a reserva tem token.
3. A janela de coleta era fixa em ontem–hoje: uma queda de dois dias perdia intimações para sempre. Agora começa na véspera da última coleta com sucesso (até 30 dias).
4. Um item com data inexistente derrubava a página inteira em toda coleta. Agora vai para a lista de erros.
5. Monitorar por número de processo gerava prazo para intimações da parte contrária. Agora só o monitoramento por OAB gera prazo.

## Pendente (não dá para fazer daqui)

| Item | Bloqueio | Como destravar |
| --- | --- | --- |
| Conferir o formato real do DJEN (premissa P1, spec 002) | Rede do ambiente bloqueia `*.jus.br` | `npm run spike:djen -- --oab <OAB> --uf ES` numa máquina no Brasil |
| Conferir o formato real do DataJud e medir atraso (spec 003) | Idem + chave pública | `DATAJUD_API_KEY=... npm run spike:datajud -- --de relatorios/...` |
| Termos de uso do DataJud e da API Comunica | Leitura jurídica | Registrar em `docs/adr/` |
| Validar regras de prazo com 50 intimações reais (spec 005 · T08) | Escritório piloto | Advogado confere a planilha gerada por `GET /prazos` |
| Rodar 7 dias em sombra (spec 002 · T11) | Rede + piloto | Subir com `docker compose up` em servidor no Brasil (C12) |
| PoC MNI do eproc da JFES (spike 000-mni-jfes) | Credencial do advogado piloto | Fase 2 |

## Decisões tomadas sem você (revise)

1. **Prazo sem quantidade no texto = 5 dias** (CPC art. 218, §3º), marcado `confirmar`.
   O plano falava em 15; mudei porque 5 é a regra legal e é a data mais cedo.
2. **Regra de segurança "na dúvida, a data mais cedo"**: Carnaval, Corpus Christi e
   pontos facultativos só contam como não úteis se cadastrados na tabela `feriado`
   para o tribunal; o recesso não adia a data de publicação, só a contagem.
3. **Comunicação com número CNJ inválido não é descartada**: fica `revisao`, gera
   evento `comunicacao.revisao` e prazo `confirmar`.
4. **A base ficou dentro deste repositório**, em `base-judiciario/`, numa branch
   separada; pode virar repositório próprio sem mudanças.
5. **Segredo do webhook no banco** até existir o cofre (ADR-001).
6. **Spec 013 (API interna)** foi criada; não estava no mapa do plano.
7. **Monitoramento por processo não gera prazo** (só comunicação e evento), porque o DJEN devolve também as intimações da outra parte.
