# Status — 2026-10-08

Fase 1 (núcleo) construída e testada contra fontes simuladas. Falta o que
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
