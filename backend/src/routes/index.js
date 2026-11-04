import { Router } from 'express';
import { db } from '../db/database.js';

const rotas = Router();

const lerParams = (entidade) => ({
  ...entidade,
  modelo_params: entidade.modelo_params ? JSON.parse(entidade.modelo_params) : {},
});

const SELECT_ENTIDADE = `
  SELECT e.*, c.slug AS categoria_slug, c.nome AS categoria_nome
  FROM entidades e
  JOIN categorias c ON c.id = e.categoria_id
`;

// ---------- Categorias ----------
rotas.get('/categorias', (req, res) => {
  const lista = db.prepare(`
    SELECT c.*, COUNT(e.id) AS total
    FROM categorias c
    LEFT JOIN entidades e ON e.categoria_id = c.id
    GROUP BY c.id
    ORDER BY c.ordem
  `).all();
  res.json(lista);
});

// ---------- Entidades (vírus, bactérias, órgãos) ----------
// GET /api/entidades?categoria=virus&busca=corona
rotas.get('/entidades', (req, res) => {
  const { categoria, busca } = req.query;
  const filtros = [];
  const valores = {};

  if (categoria) {
    filtros.push('c.slug = @categoria');
    valores.categoria = categoria;
  }
  if (busca) {
    filtros.push('(e.nome LIKE @busca OR e.nome_cientifico LIKE @busca OR e.resumo LIKE @busca)');
    valores.busca = `%${busca}%`;
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const lista = db.prepare(`${SELECT_ENTIDADE} ${where} ORDER BY c.ordem, e.nome`).all(valores);
  res.json(lista.map(lerParams));
});

rotas.get('/entidades/:slug', (req, res) => {
  const entidade = db.prepare(`${SELECT_ENTIDADE} WHERE e.slug = ?`).get(req.params.slug);
  if (!entidade) return res.status(404).json({ erro: 'Espécime não encontrado.' });

  const partes = db.prepare('SELECT chave, nome, descricao FROM partes WHERE entidade_id = ? ORDER BY id').all(entidade.id);
  const curiosidades = db.prepare('SELECT texto FROM curiosidades WHERE entidade_id = ?').all(entidade.id).map((c) => c.texto);
  const doencas = db.prepare(`
    SELECT d.slug, d.nome, d.resumo, ed.relacao
    FROM entidade_doenca ed
    JOIN doencas d ON d.id = ed.doenca_id
    WHERE ed.entidade_id = ?
    ORDER BY d.nome
  `).all(entidade.id);

  res.json({ ...lerParams(entidade), partes, curiosidades, doencas });
});

// ---------- Doenças (CRUD completo como exemplo) ----------
rotas.get('/doencas', (req, res) => {
  res.json(db.prepare('SELECT slug, nome, resumo FROM doencas ORDER BY nome').all());
});

rotas.get('/doencas/:slug', (req, res) => {
  const doenca = db.prepare('SELECT * FROM doencas WHERE slug = ?').get(req.params.slug);
  if (!doenca) return res.status(404).json({ erro: 'Doença não encontrada.' });

  const relacionadas = db.prepare(`
    SELECT e.slug, e.nome, e.nome_cientifico, e.cor_primaria, e.cor_secundaria, c.slug AS categoria_slug, ed.relacao
    FROM entidade_doenca ed
    JOIN entidades e ON e.id = ed.entidade_id
    JOIN categorias c ON c.id = e.categoria_id
    WHERE ed.doenca_id = ?
    ORDER BY c.ordem, e.nome
  `).all(doenca.id);

  res.json({ ...doenca, relacionadas });
});

const CAMPOS_DOENCA = ['slug', 'nome', 'resumo', 'descricao', 'transmissao', 'sintomas', 'prevencao'];

function validarDoenca(corpo) {
  const faltando = ['slug', 'nome', 'resumo', 'descricao'].filter((c) => !corpo?.[c]?.toString().trim());
  if (faltando.length) return `Preencha os campos: ${faltando.join(', ')}.`;
  if (!/^[a-z0-9-]+$/.test(corpo.slug)) return 'O slug deve ter apenas letras minúsculas, números e hífens.';
  return null;
}

rotas.post('/doencas', (req, res) => {
  const erro = validarDoenca(req.body);
  if (erro) return res.status(400).json({ erro });

  const dados = Object.fromEntries(CAMPOS_DOENCA.map((c) => [c, req.body[c] ?? null]));
  try {
    db.prepare(`
      INSERT INTO doencas (slug, nome, resumo, descricao, transmissao, sintomas, prevencao)
      VALUES (@slug, @nome, @resumo, @descricao, @transmissao, @sintomas, @prevencao)
    `).run(dados);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ erro: 'Já existe uma doença com esse slug.' });
    throw e;
  }
  res.status(201).json(db.prepare('SELECT * FROM doencas WHERE slug = ?').get(dados.slug));
});

rotas.put('/doencas/:slug', (req, res) => {
  const atual = db.prepare('SELECT * FROM doencas WHERE slug = ?').get(req.params.slug);
  if (!atual) return res.status(404).json({ erro: 'Doença não encontrada.' });

  const dados = { ...atual, ...req.body, slug: atual.slug };
  const erro = validarDoenca(dados);
  if (erro) return res.status(400).json({ erro });

  db.prepare(`
    UPDATE doencas SET nome=@nome, resumo=@resumo, descricao=@descricao,
      transmissao=@transmissao, sintomas=@sintomas, prevencao=@prevencao
    WHERE slug=@slug
  `).run(Object.fromEntries(CAMPOS_DOENCA.map((c) => [c, dados[c] ?? null])));
  res.json(db.prepare('SELECT * FROM doencas WHERE slug = ?').get(atual.slug));
});

rotas.delete('/doencas/:slug', (req, res) => {
  const { changes } = db.prepare('DELETE FROM doencas WHERE slug = ?').run(req.params.slug);
  if (!changes) return res.status(404).json({ erro: 'Doença não encontrada.' });
  res.status(204).end();
});

export default rotas;
