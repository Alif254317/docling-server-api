# Spec 000 — Spikes da fase 0

Status: scripts prontos, execução pendente · Fase: 0

Spikes produzem relatório, não código de produção. Os scripts estão em
`scripts/` e precisam de uma máquina com acesso aos domínios do CNJ (o ambiente
onde esta base foi escrita bloqueia `*.jus.br`).

| Spike | Comando | Pergunta respondida | Saída |
| --- | --- | --- | --- |
| 000-djen | `npm run spike:djen -- --oab 12345 --uf ES --dias 30` | Volume, campos reais e limites da API Comunica; confirma a premissa P1 da spec 002 | `relatorios/spike-djen-<data>.json` + resumo no terminal |
| 000-datajud | `npm run spike:datajud -- --de relatorios/spike-djen-<data>.json` | Atraso em dias entre a disponibilização no DJEN e o movimento no DataJud | `relatorios/spike-datajud-<data>.json` |
| 000-mni-jfes | manual | Processo completo baixado via MNI do eproc da JFES com credencial do advogado piloto; impacto do MFA da PDPJ | relatório em texto |

## Critério de saída (Portão 1)
- Formato real do DJEN conferido com o normalizador: `npm run spike:djen` falha se algum item não normalizar.
- Atraso DataJud medido para ao menos 20 processos.
- Termos de uso do DataJud e da API Comunica lidos e registrados em `docs/adr/`.
