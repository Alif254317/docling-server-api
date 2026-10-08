# Modelo de dados v0

Todas as datas-hora são `timestamptz`; datas de calendário forense são `date`
no fuso America/Sao_Paulo.

| Tabela | Campos-chave | Observações |
| --- | --- | --- |
| `escritorio` | id uuid, nome | Cliente da base. |
| `escritorio_api_key` | escritorio_id, hash sha256, criado_em, revogado_em | A chave em claro só é mostrada na criação. |
| `tribunal` | sigla PK, segmento_j, codigo_tt, uf, sistema, alias_datajud | Semeado para os tribunais do ES e superiores. |
| `feriado` | data, tribunal_sigla (nulo = nacional), descricao | Calendário além dos feriados nacionais calculados. |
| `payload_bruto` | id, fonte, requisicao jsonb, resposta jsonb, hash, coletado_em | Único (fonte, hash). Imutável (gatilho). |
| `processo` | id, numero_cnj único, tribunal_sigla, classe, assuntos, orgao_julgador, graus, nivel_sigilo, data_ajuizamento, fonte, coletado_em, payload_bruto_id | |
| `movimento` | id, processo_id, grau, codigo_tpu, nome, data_hora, complementos, hash, fonte, coletado_em, payload_bruto_id | Único (processo_id, hash). |
| `parte` | id, processo_id, nome, polo, documento, fonte, coletado_em | Preenchida por MNI (fase 2). |
| `representante` | id, parte_id, nome, oab_numero, oab_uf | |
| `documento` | id, processo_id, id_origem, tipo, data, chave_storage, hash, fonte, coletado_em | Fase 2. |
| `comunicacao` | id, id_djen único, processo_id (nulo se CNJ inválido), numero_processo_original, sigla_tribunal, tipo_comunicacao, tipo_documento, orgao, texto, data_disponibilizacao, data_publicacao, link, destinatarios, advogados, situacao (`ok` / `revisao`), motivo_revisao, fonte, coletado_em, payload_bruto_id | |
| `monitoramento` | id, escritorio_id, tipo (`oab` / `processo`), oab_numero, oab_uf, numero_cnj, frequencia_min, ativo | Único por escritório + alvo. |
| `processo_escritorio` | processo_id, escritorio_id, origem | Vínculo de acesso (C8). |
| `comunicacao_escritorio` | comunicacao_id, escritorio_id, monitoramento_id | Vínculo de acesso (C8). |
| `execucao_coleta` | id, monitoramento_id, fonte, iniciado_em, terminado_em, situacao, itens, novos, erro | Saúde por alvo (FR-6 da spec 002). |
| `prazo` | id, comunicacao_id, escritorio_id, inicio, fim, dias_uteis, origem_dias, regra, situacao, detalhes | Spec 005. |
| `evento` | id, escritorio_id, tipo, chave único, dados, criado_em, entregue_em, tentativas, proxima_tentativa_em, ultimo_erro, situacao | Outbox (spec 004). |
| `webhook` | id, escritorio_id, url, segredo, ativo | Spec 004. |
| `schema_migrations` | versao, aplicada_em | Runner. |
