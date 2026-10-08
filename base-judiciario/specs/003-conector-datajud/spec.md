# Spec 003 — Conector DataJud

Status: aprovada com premissas · Fase: 1 · Depende de: 001

## Contexto
O DataJud (API pública do CNJ) entrega capa e movimentações com códigos TPU de
91 tribunais. Serve para histórico e enriquecimento dos processos que chegam
pelo DJEN ou que o escritório monitora pelo número.

## Histórias de usuário
1. Como advogado, quero ver classe, assuntos, órgão julgador e andamentos do processo que me intimou.
2. Como escritório, quero monitorar um processo pelo número e ser avisado de movimentos novos.

## Requisitos funcionais
| ID | Requisito |
| --- | --- |
| FR-1 | Descobrir o índice DataJud (`api_publica_<alias>`) a partir do número CNJ (J.TT). |
| FR-2 | Consultar por número CNJ com a chave pública em variável de ambiente `DATAJUD_API_KEY` (C9). |
| FR-3 | Gravar o bruto com hash (C2). |
| FR-4 | Atualizar a capa do processo com o registro mais recente entre os graus retornados. |
| FR-5 | Gravar movimentos sem duplicar (hash de grau + código + data-hora + complementos). |
| FR-6 | Emitir `movimento.novo` por escritório vinculado só para movimentos novos de processo que já tinha movimentos (não na primeira carga). |
| FR-7 | Enriquecer automaticamente o processo quando chega uma comunicação nova dele. |
| FR-8 | Tribunal sem índice no DataJud (ex.: STF) é recusado com erro claro, sem tentar a chamada. |

## Requisitos não funcionais
- Mesmo cliente HTTP da spec 002 (tentativas, limitador por fonte).
- Datas do DataJud em dois formatos (`2023-05-10T14:22:31.000Z` e `20230510142231`) aceitas.

## Critérios de aceite
- **AC-1** Dado o número `5000123-31.2026.8.08.0024`, quando o índice é resolvido, então é `api_publica_tjes`; dado `1000456-23.2026.5.17.0001`, então `api_publica_trt17`.
- **AC-2** Dado um processo com 3 movimentos no DataJud, quando consultado duas vezes, então existem 3 movimentos e a capa está preenchida.
- **AC-3** Dado um processo já sincronizado, quando surge 1 movimento novo, então 1 evento `movimento.novo` sai por escritório vinculado; na primeira carga nenhum sai.
- **AC-4** Dado um número de processo do STF (J=1), quando consultado, então o conector recusa sem chamada HTTP.

## Privacidade (C8)
DataJud não traz partes. Movimentos ficam na base compartilhada; acesso pelo vínculo `processo_escritorio`.

## Fora de escopo
Busca por classe/assunto/órgão, paginação `search_after` para varreduras em massa.

## Premissas
- P1: endpoint `POST https://api-publica.datajud.cnj.jus.br/api_publica_<alias>/_search`, cabeçalho
  `Authorization: APIKey <chave>`, corpo `{"query":{"match":{"numeroProcesso":"<20 dígitos>"}}}`,
  resposta Elasticsearch `hits.hits[]._source`. Modelado a partir da documentação pública do CNJ e de
  bibliotecas abertas (pydatajud, Unlicense); não validado contra a API real neste ambiente.
- P2: a chave pública é publicada pelo CNJ e pode mudar; por isso fica em variável de ambiente.
