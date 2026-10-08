-- Spec 001 · esquema canônico v0
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE escritorio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE escritorio_api_key (
  id            bigserial PRIMARY KEY,
  escritorio_id uuid NOT NULL REFERENCES escritorio(id) ON DELETE CASCADE,
  hash          char(64) NOT NULL UNIQUE,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  revogado_em   timestamptz
);

CREATE TABLE tribunal (
  sigla         text PRIMARY KEY,
  segmento_j    smallint NOT NULL,
  codigo_tt     smallint NOT NULL,
  uf            char(2),
  sistema       text,
  alias_datajud text,
  endpoints     jsonb NOT NULL DEFAULT '{}',
  versao_mni    text,
  UNIQUE (segmento_j, codigo_tt)
);

CREATE TABLE feriado (
  id             bigserial PRIMARY KEY,
  data           date NOT NULL,
  tribunal_sigla text REFERENCES tribunal(sigla),
  descricao      text NOT NULL,
  UNIQUE NULLS NOT DISTINCT (data, tribunal_sigla)
);

-- C2: bruto imutável, deduplicado por fonte + hash
CREATE TABLE payload_bruto (
  id          bigserial PRIMARY KEY,
  fonte       text NOT NULL,
  requisicao  jsonb NOT NULL,
  resposta    jsonb NOT NULL,
  hash        char(64) NOT NULL,
  coletado_em timestamptz NOT NULL,
  UNIQUE (fonte, hash)
);
CREATE INDEX payload_bruto_fonte_coletado ON payload_bruto (fonte, coletado_em, id);

CREATE FUNCTION payload_bruto_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payload_bruto é imutável (constituição C2)';
END $$;
CREATE TRIGGER payload_bruto_imutavel BEFORE UPDATE OR DELETE ON payload_bruto
  FOR EACH ROW EXECUTE FUNCTION payload_bruto_imutavel();

CREATE TABLE processo (
  id                bigserial PRIMARY KEY,
  numero_cnj        char(20) NOT NULL UNIQUE CHECK (numero_cnj ~ '^[0-9]{20}$'),
  tribunal_sigla    text NOT NULL,
  classe_codigo     integer,
  classe_nome       text,
  assuntos          jsonb NOT NULL DEFAULT '[]',
  orgao_julgador    jsonb,
  graus             text[] NOT NULL DEFAULT '{}',
  sistema           text,
  formato           text,
  nivel_sigilo      smallint,
  data_ajuizamento  timestamptz,
  ultima_atualizacao_fonte timestamptz,
  capa_sincronizada_em timestamptz,
  fonte             text NOT NULL,
  coletado_em       timestamptz NOT NULL,
  payload_bruto_id  bigint REFERENCES payload_bruto(id)
);

CREATE TABLE movimento (
  id               bigserial PRIMARY KEY,
  processo_id      bigint NOT NULL REFERENCES processo(id) ON DELETE CASCADE,
  grau             text,
  codigo_tpu       integer NOT NULL,
  nome             text NOT NULL,
  data_hora        timestamptz NOT NULL,
  complementos     jsonb NOT NULL DEFAULT '[]',
  hash             char(64) NOT NULL,
  fonte            text NOT NULL,
  coletado_em      timestamptz NOT NULL,
  payload_bruto_id bigint REFERENCES payload_bruto(id),
  UNIQUE (processo_id, hash)
);
CREATE INDEX movimento_processo_data ON movimento (processo_id, data_hora DESC);

CREATE TABLE parte (
  id          bigserial PRIMARY KEY,
  processo_id bigint NOT NULL REFERENCES processo(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  polo        text,
  documento   text,
  fonte       text NOT NULL,
  coletado_em timestamptz NOT NULL
);

CREATE TABLE representante (
  id         bigserial PRIMARY KEY,
  parte_id   bigint NOT NULL REFERENCES parte(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  oab_numero text,
  oab_uf     char(2)
);

CREATE TABLE documento (
  id            bigserial PRIMARY KEY,
  processo_id   bigint NOT NULL REFERENCES processo(id) ON DELETE CASCADE,
  id_origem     text NOT NULL,
  tipo          text,
  data          timestamptz,
  chave_storage text,
  hash          char(64),
  fonte         text NOT NULL,
  coletado_em   timestamptz NOT NULL,
  UNIQUE (processo_id, fonte, id_origem)
);

CREATE TABLE comunicacao (
  id                        bigserial PRIMARY KEY,
  id_djen                   bigint NOT NULL UNIQUE,
  processo_id               bigint REFERENCES processo(id),
  numero_processo_original  text NOT NULL,
  sigla_tribunal            text,
  tipo_comunicacao          text,
  tipo_documento            text,
  orgao                     text,
  classe                    text,
  texto                     text NOT NULL DEFAULT '',
  data_disponibilizacao     date NOT NULL,
  data_publicacao           date,
  meio                      text,
  link                      text,
  hash_djen                 text,
  destinatarios             jsonb NOT NULL DEFAULT '[]',
  advogados                 jsonb NOT NULL DEFAULT '[]',
  situacao                  text NOT NULL CHECK (situacao IN ('ok', 'revisao')),
  motivo_revisao            text,
  fonte                     text NOT NULL,
  coletado_em               timestamptz NOT NULL,
  payload_bruto_id          bigint NOT NULL REFERENCES payload_bruto(id)
);
CREATE INDEX comunicacao_processo ON comunicacao (processo_id);
CREATE INDEX comunicacao_disponibilizacao ON comunicacao (data_disponibilizacao);

CREATE TABLE monitoramento (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id      uuid NOT NULL REFERENCES escritorio(id) ON DELETE CASCADE,
  tipo               text NOT NULL CHECK (tipo IN ('oab', 'processo')),
  oab_numero         text,
  oab_uf             char(2),
  numero_cnj         char(20),
  frequencia_min     integer NOT NULL DEFAULT 60 CHECK (frequencia_min >= 5),
  ativo              boolean NOT NULL DEFAULT true,
  proxima_coleta_em  timestamptz NOT NULL DEFAULT now(),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (tipo = 'oab' AND oab_numero IS NOT NULL AND oab_uf IS NOT NULL AND numero_cnj IS NULL) OR
    (tipo = 'processo' AND numero_cnj IS NOT NULL AND oab_numero IS NULL AND oab_uf IS NULL)
  )
);
CREATE UNIQUE INDEX monitoramento_alvo ON monitoramento
  (escritorio_id, tipo, coalesce(oab_numero, ''), coalesce(oab_uf, ''), coalesce(numero_cnj, ''));
CREATE INDEX monitoramento_vencidos ON monitoramento (proxima_coleta_em) WHERE ativo;

-- C8: vínculos de acesso por escritório
CREATE TABLE processo_escritorio (
  processo_id   bigint NOT NULL REFERENCES processo(id) ON DELETE CASCADE,
  escritorio_id uuid NOT NULL REFERENCES escritorio(id) ON DELETE CASCADE,
  origem        text NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (processo_id, escritorio_id)
);
CREATE INDEX processo_escritorio_esc ON processo_escritorio (escritorio_id);

CREATE TABLE comunicacao_escritorio (
  comunicacao_id   bigint NOT NULL REFERENCES comunicacao(id) ON DELETE CASCADE,
  escritorio_id    uuid NOT NULL REFERENCES escritorio(id) ON DELETE CASCADE,
  monitoramento_id uuid REFERENCES monitoramento(id) ON DELETE SET NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comunicacao_id, escritorio_id)
);
CREATE INDEX comunicacao_escritorio_esc ON comunicacao_escritorio (escritorio_id);

CREATE TABLE execucao_coleta (
  id               bigserial PRIMARY KEY,
  monitoramento_id uuid REFERENCES monitoramento(id) ON DELETE SET NULL,
  fonte            text NOT NULL,
  iniciado_em      timestamptz NOT NULL DEFAULT now(),
  terminado_em     timestamptz,
  situacao         text NOT NULL CHECK (situacao IN ('rodando', 'ok', 'falha')),
  itens            integer NOT NULL DEFAULT 0,
  novos            integer NOT NULL DEFAULT 0,
  erro             text
);
CREATE INDEX execucao_coleta_mon ON execucao_coleta (monitoramento_id, iniciado_em DESC);

CREATE TABLE prazo (
  id             bigserial PRIMARY KEY,
  comunicacao_id bigint NOT NULL REFERENCES comunicacao(id) ON DELETE CASCADE,
  escritorio_id  uuid NOT NULL REFERENCES escritorio(id) ON DELETE CASCADE,
  publicacao     date NOT NULL,
  inicio         date NOT NULL,
  fim            date NOT NULL,
  dias_uteis     integer NOT NULL,
  origem_dias    text NOT NULL CHECK (origem_dias IN ('texto', 'padrao', 'manual')),
  regra          text NOT NULL,
  situacao       text NOT NULL CHECK (situacao IN ('confirmar', 'aberto', 'cumprido', 'cancelado')),
  detalhes       jsonb NOT NULL DEFAULT '{}',
  calculado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comunicacao_id, escritorio_id)
);
CREATE INDEX prazo_esc_fim ON prazo (escritorio_id, fim);

CREATE TABLE evento (
  id                   bigserial PRIMARY KEY,
  escritorio_id        uuid NOT NULL REFERENCES escritorio(id) ON DELETE CASCADE,
  tipo                 text NOT NULL,
  chave                text NOT NULL UNIQUE,
  dados                jsonb NOT NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  situacao             text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'entregue', 'morto')),
  tentativas           integer NOT NULL DEFAULT 0,
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  entregue_em          timestamptz,
  ultimo_erro          text
);
CREATE INDEX evento_pendentes ON evento (proxima_tentativa_em) WHERE situacao = 'pendente';
CREATE INDEX evento_esc ON evento (escritorio_id, id);

CREATE TABLE webhook (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio_id uuid NOT NULL REFERENCES escritorio(id) ON DELETE CASCADE,
  url           text NOT NULL,
  segredo       text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- Tribunais do piloto (ES) e superiores. Demais são derivados do número CNJ.
INSERT INTO tribunal (sigla, segmento_j, codigo_tt, uf, sistema, alias_datajud) VALUES
  ('STF',    1,  0, NULL, NULL,    NULL),
  ('STJ',    3,  0, NULL, NULL,    'stj'),
  ('TRF2',   4,  2, NULL, 'eproc', 'trf2'),
  ('TST',    5,  0, NULL, 'PJe',   'tst'),
  ('TRT17',  5, 17, 'ES', 'PJe',   'trt17'),
  ('TSE',    6,  0, NULL, NULL,    'tse'),
  ('TRE-ES', 6,  8, 'ES', 'PJe',   'tre-es'),
  ('TJES',   8,  8, 'ES', 'PJe',   'tjes');
