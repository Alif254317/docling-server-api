# Spec 005 — Cálculo de prazos

Status: aprovada com premissas · Fase: 1 · Depende de: 002

## Contexto
A intimação no DJEN só vale se virar um prazo com data certa. Esta spec calcula
o prazo processual em dias úteis a partir da disponibilização.

## Regras jurídicas aplicadas
1. Publicação = primeiro dia útil seguinte à disponibilização no DJEN (Lei 11.419/2006, art. 4º, §3º).
2. O prazo começa no primeiro dia útil seguinte à publicação (Lei 11.419/2006, art. 4º, §4º; CPC art. 224).
3. Contam-se só dias úteis (CPC art. 219).
4. Prazos ficam suspensos de 20 de dezembro a 20 de janeiro, inclusive (CPC art. 220).
5. Não são úteis: sábado, domingo, feriados nacionais (1/1, Sexta-feira Santa, 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11 a partir de 2024, 25/12) e os feriados do tribunal cadastrados na tabela `feriado`.
6. **Regra de segurança:** na dúvida, a data mais cedo. Por isso Carnaval, Corpus Christi e pontos facultativos só contam como não úteis se cadastrados para o tribunal, e o recesso não adia a data de publicação (só a contagem).

## Histórias de usuário
1. Como advogado, quero ver a data final de cada prazo assim que a intimação chega.
2. Como advogado, quero saber quando a quantidade de dias foi presumida, para conferir.

## Requisitos funcionais
| ID | Requisito |
| --- | --- |
| FR-1 | Calcular publicação, início e fim a partir de disponibilização, dias úteis e tribunal. |
| FR-2 | Detalhar os dias pulados (fim de semana, feriado, recesso) no resultado. |
| FR-3 | Extrair a quantidade de dias do texto da intimação quando houver padrão claro ("prazo de 5 (cinco) dias", "prazo de quinze dias"). Sem prazo no texto, usar 5 dias (CPC art. 218, §3º); com prazos diferentes no texto, usar o menor. Nos dois casos marcar `situacao = confirmar`; o primeiro com `origem_dias = padrao`. |
| FR-4 | Gerar um prazo por comunicação nova e escritório, com evento `prazo.calculado`. |
| FR-5 | Expor o cálculo avulso na API (`POST /prazos/calcular`). |

## Critérios de aceite
- **AC-1** Disponibilização 05/10/2026, 15 dias, TJES → publicação 06/10, início 07/10, fim 28/10/2026 (12/10 pulado).
- **AC-2** Disponibilização 18/12/2026, 5 dias → publicação 21/12/2026, início 21/01/2027, fim 27/01/2027 (recesso).
- **AC-3** Disponibilização 05/02/2027, 5 dias, sem feriado de Carnaval cadastrado → fim 15/02/2027; com 08 e 09/02 cadastrados para o TJES → fim 17/02/2027.
- **AC-4** Disponibilização 24/03/2027, 5 dias → início 29/03 (Sexta-feira Santa 26/03 pulada), fim 02/04/2027.
- **AC-5** Texto "no prazo de 5 (cinco) dias" → 5 dias, `origem_dias = texto`, `situacao = aberto`; texto sem prazo → 5, `origem_dias = padrao`, `situacao = confirmar`; "5 dias para o autor e 10 dias para o réu" → 5, `situacao = confirmar`.
- **AC-6** Comunicação nova ingerida pelo DJEN → um prazo e um evento `prazo.calculado` por escritório.

## Fora de escopo
Prazo em dobro (CPC arts. 180, 183, 186, 229), prazos em horas, meses e anos,
intimação por portal/ciência tácita, feriados municipais automáticos.

## Premissas
- A ferramenta é de apoio: o contrato com o escritório diz que a conferência final é do advogado.
- [PERGUNTA] Validar as regras 1, 2 e 6 com o advogado do escritório piloto (amostra de 50 intimações reais).
