-- BioVerso: esquema do banco de dados (SQLite)

CREATE TABLE IF NOT EXISTS categorias (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL UNIQUE,          -- 'virus' | 'bacteria' | 'orgao'
  nome      TEXT NOT NULL,
  descricao TEXT,
  ordem     INTEGER NOT NULL DEFAULT 0
);

-- Tudo que tem um modelo 3D: vírus, bactérias e órgãos
CREATE TABLE IF NOT EXISTS entidades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  nome            TEXT NOT NULL,
  nome_cientifico TEXT,
  categoria_id    INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  resumo          TEXT NOT NULL,
  descricao       TEXT NOT NULL,
  tamanho         TEXT,
  modelo_tipo     TEXT NOT NULL,            -- gerador procedural no front (virus, bacilo, coco, coracao, pulmoes)
  modelo_params   TEXT,                     -- JSON com parâmetros do gerador
  modelo_url      TEXT,                     -- opcional: arquivo .glb em /models (substitui o procedural)
  cor_primaria    TEXT NOT NULL DEFAULT '#cccccc',
  cor_secundaria  TEXT NOT NULL DEFAULT '#888888',
  criado_em       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Partes clicáveis do modelo 3D (a chave bate com userData.parte no Three.js)
CREATE TABLE IF NOT EXISTS partes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade_id INTEGER NOT NULL REFERENCES entidades(id) ON DELETE CASCADE,
  chave       TEXT NOT NULL,
  nome        TEXT NOT NULL,
  descricao   TEXT NOT NULL,
  UNIQUE (entidade_id, chave)
);

CREATE TABLE IF NOT EXISTS curiosidades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade_id INTEGER NOT NULL REFERENCES entidades(id) ON DELETE CASCADE,
  texto       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doencas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  nome        TEXT NOT NULL,
  resumo      TEXT NOT NULL,
  descricao   TEXT NOT NULL,
  transmissao TEXT,
  sintomas    TEXT,
  prevencao   TEXT
);

-- Relação N:N: um agente "causa" uma doença; uma doença "afeta" um órgão
CREATE TABLE IF NOT EXISTS entidade_doenca (
  entidade_id INTEGER NOT NULL REFERENCES entidades(id) ON DELETE CASCADE,
  doenca_id   INTEGER NOT NULL REFERENCES doencas(id) ON DELETE CASCADE,
  relacao     TEXT NOT NULL CHECK (relacao IN ('causa', 'afeta')),
  PRIMARY KEY (entidade_id, doenca_id, relacao)
);

CREATE INDEX IF NOT EXISTS idx_entidades_categoria ON entidades(categoria_id);
CREATE INDEX IF NOT EXISTS idx_partes_entidade ON partes(entidade_id);
