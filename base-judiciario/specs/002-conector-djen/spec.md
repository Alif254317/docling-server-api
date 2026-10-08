# Spec 002 — Conector DJEN

Status: aprovada com premissas · Fase: 1 · Depende de: 001

## Contexto
O DJEN (Diário de Justiça Eletrônico Nacional) publica as intimações com texto
integral e é o gatilho de prazos. É a fonte nº 1 da base.

## Histórias de usuário
1. Como advogado do escritório, quero que toda intimação publicada no DJEN para a minha OAB apareça no sistema no mesmo dia, para não perder prazo.
2. Como operador, quero ver quando a coleta de uma OAB falhou, para agir antes do fim do dia.
3. Como desenvolvedor, quero reprocessar intimações antigas a partir do bruto, quando o normalizador mudar.

## Requisitos funcionais
| ID | Requisito |
| --- | --- |
| FR-1 | Consultar o DJEN por OAB monitorada ao menos a cada hora (frequência configurável por monitoramento), paginando até o fim. |
| FR-2 | Gravar cada página de resposta bruta com hash antes de qualquer transformação (C2). |
| FR-3 | Criar ou atualizar a Comunicação pelo id do DJEN, sem duplicar. |
| FR-4 | Ligar a Comunicação ao Processo pelo número CNJ, criando o Processo se não existir, e ao escritório dono do monitoramento. |
| FR-5 | Emitir o evento `comunicacao.nova` uma única vez por comunicação e escritório. |
| FR-6 | Registrar sucesso, falha, itens e novos por monitoramento a cada execução. |
| FR-7 | Comunicação com número CNJ inválido não é descartada: vira `situacao = revisao` e emite `comunicacao.revisao`. |
| FR-8 | Reprocessar todo o bruto do DJEN sem gerar eventos novos nem duplicatas, religando o escritório mesmo que o monitoramento tenha sido apagado. |
| FR-9 | A janela de cada coleta vai da véspera da última coleta com sucesso (ou da criação do monitoramento) até hoje, recuando no máximo 30 dias; frequência máxima de 1 dia. |
| FR-10 | Item com data inválida vai para a lista de erros sem impedir a gravação dos demais itens da página. |
| FR-11 | Monitoramento por número de processo traz todas as intimações do processo (inclusive para a outra parte): gera comunicação e evento, mas não gera prazo. Prazos vêm só do monitoramento por OAB. |

## Requisitos não funcionais
- Até 2 h entre a disponibilização no DJEN e o evento (com frequência de 60 min).
- Respeitar o limite de chamadas da API Comunica: limitador por fonte e `Retry-After` em HTTP 429.
- Até 3 tentativas com espera crescente em erro de rede, 429 e 5xx.

## Critérios de aceite
- **AC-1** Dado uma OAB monitorada com 3 intimações no dia, quando a coleta roda, então existem 3 Comunicações e 3 eventos `comunicacao.nova`.
- **AC-2** Dado que a mesma intimação volta na coleta seguinte, quando a coleta roda, então nada é duplicado e nenhum evento novo sai.
- **AC-3** Dado que a API Comunica responde erro 3 vezes, quando a coleta termina, então a execução fica registrada como falha e um evento `coleta.falhou` é emitido.
- **AC-4** Dado um número CNJ com dígito inválido, quando a intimação chega, então o bruto é guardado, a comunicação fica em revisão e um evento `comunicacao.revisao` é emitido.
- **AC-5** Dado o bruto de várias coletas, quando o reprocessamento roda depois de apagar o normalizado, então o resultado normalizado é idêntico ao original e nenhum evento novo é criado.
- **AC-6** Dado mais de uma página de resultados, quando a coleta roda, então todas as páginas são lidas e gravadas.
- **AC-7** Dado que a última coleta com sucesso foi em 01/10 e as seguintes falharam, quando a coleta roda em 05/10, então a janela pedida é 30/09 a 05/10.
- **AC-8** Dado uma página com um item de data inexistente, quando a coleta roda, então os demais itens são gravados e a coleta termina ok.
- **AC-9** Dado um monitoramento por processo, quando chega uma intimação, então há comunicação e evento, e nenhum prazo.

## Privacidade (C8)
Texto da intimação e nomes de partes ficam na base compartilhada; o acesso de
cada escritório vem de `comunicacao_escritorio`, criado só para o escritório
dono do monitoramento (por OAB ou por processo; ver FR-11).

## Fora de escopo
Cálculo de prazo (spec 005), Domicílio Judicial Eletrônico, busca por CPF/CNPJ, busca por nome.

## Premissas e perguntas em aberto
- Premissa P1 (confirmar no spike 000): endpoint `GET https://comunicaapi.pje.jus.br/api/v1/comunicacao`
  com `numeroOab`, `ufOab`, `dataDisponibilizacaoInicio`, `dataDisponibilizacaoFim`, `pagina`, `itensPorPagina`;
  resposta `{status, message, count, items[]}`. O formato foi modelado a partir de documentação pública e
  ainda não foi validado contra a API real (a rede do ambiente de desenvolvimento bloqueia o domínio).
  O normalizador aceita as variantes de nome de campo conhecidas.
- [PERGUNTA] Limite real de chamadas por minuto e se o uso comercial é permitido (spike 000-djen).
