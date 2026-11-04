import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { db, aplicarSchema } from './database.js';
import { categorias, entidades, doencas } from './dados-iniciais.js';

export function popularBanco() {
  aplicarSchema();

  const executar = db.transaction(() => {
    // Limpa tudo (ordem respeita as chaves estrangeiras)
    for (const tabela of ['entidade_doenca', 'curiosidades', 'partes', 'entidades', 'doencas', 'categorias']) {
      db.prepare(`DELETE FROM ${tabela}`).run();
    }

    const insCategoria = db.prepare(
      'INSERT INTO categorias (slug, nome, descricao, ordem) VALUES (@slug, @nome, @descricao, @ordem)'
    );
    const idCategoria = {};
    for (const c of categorias) idCategoria[c.slug] = insCategoria.run(c).lastInsertRowid;

    const insDoenca = db.prepare(`
      INSERT INTO doencas (slug, nome, resumo, descricao, transmissao, sintomas, prevencao)
      VALUES (@slug, @nome, @resumo, @descricao, @transmissao, @sintomas, @prevencao)
    `);
    const idDoenca = {};
    for (const d of doencas) idDoenca[d.slug] = insDoenca.run(d).lastInsertRowid;

    const insEntidade = db.prepare(`
      INSERT INTO entidades (slug, nome, nome_cientifico, categoria_id, resumo, descricao, tamanho,
                             modelo_tipo, modelo_params, modelo_url, cor_primaria, cor_secundaria)
      VALUES (@slug, @nome, @nome_cientifico, @categoria_id, @resumo, @descricao, @tamanho,
              @modelo_tipo, @modelo_params, @modelo_url, @cor_primaria, @cor_secundaria)
    `);
    const insParte = db.prepare('INSERT INTO partes (entidade_id, chave, nome, descricao) VALUES (?, ?, ?, ?)');
    const insCuriosidade = db.prepare('INSERT INTO curiosidades (entidade_id, texto) VALUES (?, ?)');
    const insRelacao = db.prepare('INSERT INTO entidade_doenca (entidade_id, doenca_id, relacao) VALUES (?, ?, ?)');

    for (const e of entidades) {
      const id = insEntidade.run({
        ...e,
        categoria_id: idCategoria[e.categoria],
        modelo_params: e.modelo_params ? JSON.stringify(e.modelo_params) : null,
        modelo_url: e.modelo_url ?? null,
      }).lastInsertRowid;

      for (const p of e.partes ?? []) insParte.run(id, p.chave, p.nome, p.descricao);
      for (const texto of e.curiosidades ?? []) insCuriosidade.run(id, texto);
      for (const r of e.doencas ?? []) insRelacao.run(id, idDoenca[r.slug], r.relacao);
    }
  });

  executar();
  console.log(`Banco populado: ${entidades.length} entidades, ${doencas.length} doenças.`);
}

// Executado diretamente: `npm run seed`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  popularBanco();
}
