# Base própria de dados do Judiciário

Coleta, normaliza e monitora processos e intimações dos tribunais brasileiros,
e entrega o que muda por webhook. Construída com desenvolvimento orientado a
especificação (SDD): nada entra no código sem uma spec aprovada e um teste por
critério de aceite.

- Constituição (princípios C1–C12): [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- Specs, planos e tarefas: [`specs/`](specs/)
- Decisões: [`docs/adr/`](docs/adr/)
- O que está pronto e o que falta: [`STATUS.md`](STATUS.md)

## Como funciona

```text
monitoramento (OAB ou processo)
   │  agendador (a cada 60 s) reserva os vencidos
   ▼
fila coleta-djen ──► API Comunica (DJEN) ──► payload_bruto (imutável, hash)
   │                                              │
   │                                              ▼
   │                         comunicação + processo + vínculo do escritório
   │                         prazo (dias úteis, CPC) + eventos (outbox)
   ▼
fila coleta-datajud ──► DataJud ──► capa + movimentos (+ evento movimento.novo)
                                              │
entregador (a cada 15 s) ◄────────── evento ──┘ ──► webhook do escritório (HMAC)
```

## Rodar localmente

Requisitos: Node 22, PostgreSQL 16, Redis 7 (ou `docker compose up`).

```bash
cp .env.example .env            # ajuste DATAJUD_API_KEY (chave pública do CNJ)
npm ci
npm run migrate                 # cria o esquema
npm run escritorio:criar -- "Escritório Piloto"   # mostra a chave de API uma vez
npm run api                     # http://localhost:3000
npm run worker                  # coleta, DataJud, agenda e entrega de eventos
```

Exemplo:

```bash
CHAVE=bj_...
curl -X POST localhost:3000/monitoramentos -H "authorization: Bearer $CHAVE" \
  -H 'content-type: application/json' -d '{"tipo":"oab","numero":"12345","uf":"ES"}'
curl -X POST localhost:3000/webhooks -H "authorization: Bearer $CHAVE" \
  -H 'content-type: application/json' -d '{"url":"https://meu-sistema/hooks/judiciario"}'
curl localhost:3000/prazos -H "authorization: Bearer $CHAVE"
```

## API (spec 013)

| Método e rota | O que faz |
| --- | --- |
| `GET /saude` | Saúde e banco (sem chave) |
| `GET /metricas` | Métricas Prometheus (sem chave; restringir na rede) |
| `POST /monitoramentos` | `{"tipo":"oab","numero","uf"}` ou `{"tipo":"processo","numeroCnj"}` |
| `GET /monitoramentos`, `DELETE /monitoramentos/:id` | Listar e remover |
| `GET /processos/:numeroCnj` | Capa, movimentos e comunicações do processo |
| `GET /comunicacoes?desde=AAAA-MM-DD` | Intimações do escritório |
| `GET /prazos?ate=AAAA-MM-DD&situacao=` | Prazos calculados |
| `POST /prazos/calcular` | Cálculo avulso: `dataDisponibilizacao`, `dias` ou `texto`, `tribunal` |
| `POST /webhooks`, `GET /webhooks` | Cadastrar (devolve o segredo uma vez) e listar |
| `GET /eventos?situacao=pendente`, `POST /eventos/confirmacoes` | Eventos para quem não usa webhook |

Webhooks chegam com `X-Evento-Id`, `X-Evento-Tipo` e `X-Assinatura: sha256=<HMAC do corpo>`.
A entrega é pelo menos uma vez: deduplique por `X-Evento-Id`.

## Comandos

| Comando | Para quê |
| --- | --- |
| `npm run check` | Tipos, licenças (C10) e todos os testes |
| `npm test` | Testes (precisam de Postgres e Redis; `TEST_DATABASE_URL`, `TEST_REDIS_URL`) |
| `npm run migrate [-- down [n]]` | Aplicar ou reverter migrations |
| `npm run reprocessar -- djen\|datajud` | Refazer o normalizado a partir do bruto (C3) |
| `npm run spike:djen -- --oab N --uf UF` | Spike 000: confere o formato real do DJEN |
| `npm run spike:datajud -- --de relatorios/...json` | Spike 000: mede o atraso do DataJud |
