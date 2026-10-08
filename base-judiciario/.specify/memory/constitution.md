# Constituição — Base Própria de Dados do Judiciário

Versão 1.0.0 · ratificada em 2026-10-08

Toda spec, plano, tarefa e PR deste projeto obedece a estes princípios. Um
desvio só é aceito com um registro de decisão em `docs/adr/`.

| Nº | Princípio | Como se verifica |
| --- | --- | --- |
| C1 | O número CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO) é a chave de todo processo. | Validação do dígito verificador (módulo 97, Res. CNJ 65/2008) em todo ponto de entrada. |
| C2 | O payload bruto de cada fonte é guardado imutável, com hash. | Gatilho no banco recusa `UPDATE`/`DELETE` em `payload_bruto`; teste automatizado. |
| C3 | O dado normalizado é derivado do bruto e pode ser reprocessado. | Comando de reprocessamento coberto por teste de ponta a ponta. |
| C4 | Cada fato registra fonte e data de coleta. | Colunas `fonte` e `coletado_em` `NOT NULL` nas tabelas de fatos. |
| C5 | Toda intimação tem ao menos duas fontes possíveis. | Matriz de cobertura por tribunal revisada a cada portão. |
| C6 | Teste antes do código: cada critério de aceite vira teste automatizado. | Testes `AC-*` nomeados pelo critério; PR sem eles é recusado. |
| C7 | Cada conector é isolado e segue a mesma interface. | Interface `Conector` única em `src/connectors/types.ts`. |
| C8 | LGPD: dados separados por escritório; nada sigiloso sem vínculo do advogado. | Teste de isolamento entre escritórios; revisão de privacidade em cada spec. |
| C9 | Segredos só no cofre ou em variável de ambiente, nunca em código ou log. | Varredura de segredos no CI; logger com redação de campos sensíveis. |
| C10 | Sem dependência AGPL; licença conferida antes de reaproveitar código. | `npm run check:licenses` no CI. |
| C11 | Stack: TypeScript no Node.js, PostgreSQL, Redis + BullMQ, storage S3. | Desvio só com ADR. |
| C12 | Servidores no Brasil. | Item obrigatório no plano técnico de infraestrutura. |

## Regras de processo

1. Ordem fixa: spec → plano → tarefas → testes vermelhos → código → testes verdes.
2. Quando o código revela algo que a spec não previa, corrige-se a spec primeiro.
3. A spec descreve comportamento observável; tecnologia só aparece no `plan.md`.
4. Toda pergunta em aberto fica marcada `[PERGUNTA]` e bloqueia a aprovação da spec,
   exceto quando registrada como premissa explícita com dono e prazo para confirmar.

## Governança

Emendas exigem PR que altera este arquivo, incrementa a versão (semver) e
atualiza as specs afetadas.
