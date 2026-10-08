# Plano técnico — Spec 001

## Conformidade com a constituição
| Princípio | Como este plano cumpre |
| --- | --- |
| C1 | `src/domain/cnj.ts` valida DV módulo 97; colunas `numero_cnj char(20)` com `CHECK` de 20 dígitos. |
| C2 | Gatilho `payload_bruto_imutavel` recusa `UPDATE`/`DELETE`. |
| C3 | Tabelas normalizadas guardam `payload_bruto_id`; reprocessamento relê o bruto. |
| C4 | `fonte text NOT NULL`, `coletado_em timestamptz NOT NULL` nas tabelas de fatos. |
| C8 | Tabelas de vínculo `processo_escritorio` e `comunicacao_escritorio`; toda consulta da API passa por elas. |
| C11 | PostgreSQL 16, driver `pg`. |

## Módulos e arquivos
- `migrations/NNN_nome.up.sql` e `.down.sql` — SQL puro, aplicado em ordem.
- `src/db/migrate.ts` — runner com tabela `schema_migrations`, `up` e `down`, em transação e com advisory lock.
- `src/db/pool.ts` — pool `pg` a partir de `DATABASE_URL`.
- `src/domain/cnj.ts` — parse, validação, formatação e cálculo de DV.
- `src/domain/hash.ts` — SHA-256 de JSON canônico (chaves ordenadas), para dedupe estável.
- `src/db/bruto.ts` — `gravarBruto()` com `ON CONFLICT (fonte, hash) DO NOTHING` + leitura do id existente.

## Modelo de dados
Ver `data-model.md`.

## Decisões
- Runner de migrations próprio (50 linhas) em vez de biblioteca: menos dependências e controle do `down`.
- Hash sobre JSON canônico, não sobre o texto HTTP: duas respostas iguais com espaços diferentes viram uma.
- Dados públicos compartilhados + tabelas de vínculo (ver premissa da spec).

## Riscos
- Crescimento do `payload_bruto`: particionar por mês quando passar de ~50 GB (fora desta spec).
