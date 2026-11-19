import { api } from '../api.js';
import { esc, mancha, mensagemErro } from '../util.js';
import { gerarMiniaturas } from '../three/miniaturas.js';

export async function paginaDoencas(raiz) {
  raiz.innerHTML = `<section class="pagina"><p class="carregando">Carregando doenças…</p></section>`;
  try {
    const doencas = await api.doencas();
    raiz.innerHTML = `
      <section class="pagina">
        <h1>Doenças</h1>
        <p class="pagina__lead">Veja como cada doença se transmite, quais sinais observar e como se prevenir.</p>
        <ul class="lista-doencas lista-doencas--grande">
          ${doencas.map((d) => `<li><a href="#/doenca/${esc(d.slug)}">${esc(d.nome)}</a><span>${esc(d.resumo)}</span></li>`).join('')}
        </ul>
      </section>`;
  } catch (erro) {
    raiz.innerHTML = `<section class="pagina">${mensagemErro(erro)}</section>`;
  }
}

export async function paginaDoenca(raiz, slug) {
  let cancelarMiniaturas = () => {};
  raiz.innerHTML = `<section class="pagina"><p class="carregando">Carregando…</p></section>`;
  try {
    const d = await api.doenca(slug);
    const grupo = (rel, titulo) => {
      const itens = d.relacionadas.filter((r) => r.relacao === rel);
      if (!itens.length) return '';
      return `
        <section>
          <h2>${titulo}</h2>
          <ul class="relacionadas">
            ${itens.map((r) => `
              <li><a href="#/especime/${esc(r.slug)}"><span class="relacionadas__vidro" data-miniatura="${esc(r.slug)}">${mancha(r.cor_primaria, r.cor_secundaria)}</span>
                <span><strong>${esc(r.nome)}</strong><em>${esc(r.nome_cientifico)}</em></span></a></li>`).join('')}
          </ul>
        </section>`;
    };

    raiz.innerHTML = `
      <article class="pagina doenca">
        <nav class="trilha" aria-label="Você está em">
          <a href="#/doencas">Doenças</a><span aria-hidden="true">/</span><span aria-current="page">${esc(d.nome)}</span>
        </nav>
        <h1>${esc(d.nome)}</h1>
        <p class="pagina__lead">${esc(d.resumo)} ${esc(d.descricao)}</p>
        <dl class="ficha">
          ${d.transmissao ? `<div><dt>Transmissão</dt><dd>${esc(d.transmissao)}</dd></div>` : ''}
          ${d.sintomas ? `<div><dt>Sintomas</dt><dd>${esc(d.sintomas)}</dd></div>` : ''}
          ${d.prevencao ? `<div><dt>Prevenção</dt><dd>${esc(d.prevencao)}</dd></div>` : ''}
        </dl>
        ${grupo('causa', 'Agentes causadores')}
        ${grupo('afeta', 'Órgãos afetados')}
      </article>`;

    // Foto do modelo 3D no lugar da mancha, como nos cartões da home (fotos já tiradas vêm do cache)
    // (decorativa: se a lista falhar, a mancha colorida continua)
    const todas = d.relacionadas.length ? await api.entidades().catch(() => []) : [];
    if (todas.length) {
      const slugs = new Set(d.relacionadas.map((r) => r.slug));
      cancelarMiniaturas = gerarMiniaturas(todas.filter((e) => slugs.has(e.slug)), (slugEntidade, url) => {
        raiz.querySelectorAll(`[data-miniatura="${CSS.escape(slugEntidade)}"]`).forEach((vidro) => {
          const imagem = new Image();
          imagem.className = 'relacionadas__modelo';
          imagem.alt = ''; // decorativa: o nome está ao lado
          imagem.src = url;
          vidro.replaceChildren(imagem);
        });
      });
    }
  } catch (erro) {
    raiz.innerHTML = `<section class="pagina">${mensagemErro(erro)}<p><a href="#/doencas">Ver todas as doenças</a></p></section>`;
  }
  return () => cancelarMiniaturas();
}
