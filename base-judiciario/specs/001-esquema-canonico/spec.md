# Spec 001 — Esquema canônico

Status: aprovada (premissas abaixo) · Fase: 1 · Depende de: Portão 1 (spikes)

## Contexto
Todas as fontes (DJEN, DataJud, MNI, portais, agregador) desembocam num mesmo
modelo de dados. Esta spec define esse modelo e as garantias que ele dá, antes
de qualquer conector existir.

## Histórias de usuário
1. Como desenvolvedor de conector, quero um único lugar para gravar o que coletei,
   para não reinventar armazenamento a cada fonte.
2. Como auditor, quero saber de onde e quando veio cada fato, para resolver conflitos
   entre fontes e provar o que recebemos.
3. Como escritório, quero ver só os meus processos e intimações.

## Requisitos funcionais
| ID | Requisito |
| --- | --- |
| FR-1 | Validar e normalizar o número CNJ (20 dígitos, DV módulo 97) e derivar segmento J, tribunal TT e ano. |
| FR-2 | Guardar cada resposta bruta de fonte com fonte, requisição, resposta, hash SHA-256 e data de coleta. |
| FR-3 | Impedir alteração e exclusão de respostas brutas. |
| FR-4 | Guardar processo, movimento, parte, documento, comunicação, prazo, monitoramento, execução de coleta e evento, cada fato com `fonte` e `coletado_em`. |
| FR-5 | Ligar processos e comunicações aos escritórios que os monitoram; nenhum dado de um escritório aparece para outro. |
| FR-6 | Aplicar e reverter migrations em ordem, registrando o que foi aplicado. |
| FR-7 | Manter o registro de tribunais (sigla, J.TT, sistema, alias DataJud) e o calendário de feriados por tribunal. |

## Requisitos não funcionais
- PostgreSQL 16; JSONB para o bruto.
- Migrations idempotentes: rodar `up` duas vezes não muda nada.

## Critérios de aceite
- **AC-1** Dado um banco vazio, quando as migrations sobem e depois descem, então o banco volta vazio sem erro, e subir de novo funciona.
- **AC-2** Dado `0000832-35.2018.4.01.3202` (válido), quando validado, então retorna os 20 dígitos, J=4, TT=01; dado o mesmo número com DV trocado, então é recusado.
- **AC-3** Dado um payload bruto gravado, quando alguém tenta `UPDATE` ou `DELETE`, então o banco recusa.
- **AC-4** Dado o mesmo payload gravado duas vezes, então existe uma só linha (dedupe por fonte + hash).
- **AC-5** Dado um movimento sem `fonte` ou sem `coletado_em`, quando inserido, então o banco recusa.
- **AC-6** Dados dois escritórios, quando o escritório A consulta, então não vê processos ou comunicações ligados só ao B.

## Privacidade (C8)
Comunicações trazem nomes de partes e advogados (dados pessoais publicados em
diário oficial). Base legal: exercício regular de direitos em processo judicial
(LGPD art. 7º, VI) e legítimo interesse do escritório cliente. Acesso sempre
filtrado pelas tabelas de vínculo com o escritório.

## Fora de escopo
Storage de documentos (spec 009), cofre de credenciais (spec 006), busca textual.

## Premissas
- Processo, movimento e comunicação são dados públicos compartilhados entre
  escritórios na base; o isolamento é feito pelo vínculo, não por cópia.
