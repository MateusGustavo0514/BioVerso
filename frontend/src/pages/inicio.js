import { api } from '../api.js';
import { esc, mancha, mensagemErro } from '../util.js';
import { Visualizador } from '../three/Visualizador.js';

const ESPECIME_DESTAQUE = 'sars-cov-2';

export async function paginaInicial(raiz) {
  raiz.innerHTML = `
    <section class="abertura">
      <div class="abertura__texto">
        <h1>Explore vírus, bactérias e órgãos em 3D</h1>
        <p class="abertura__lead">Gire, aproxime e toque em cada parte para entender como ela funciona e quais doenças estão ligadas a ela.</p>
        <a class="botao" href="#/especime/${ESPECIME_DESTAQUE}">Explorar o coronavírus</a>
      </div>
      <figure class="campo campo--abertura">
        <div class="campo__palco" data-palco></div>
        <figcaption class="campo__legenda" data-legenda>Carregando modelo…</figcaption>
      </figure>
    </section>
    <div data-colecao><p class="carregando">Carregando espécimes…</p></div>
  `;

  const palco = raiz.querySelector('[data-palco]');
  const legenda = raiz.querySelector('[data-legenda]');
  const visualizador = new Visualizador(palco, { interativo: false });

  try {
    const [categorias, entidades, destaque] = await Promise.all([
      api.categorias(),
      api.entidades(),
      api.entidade(ESPECIME_DESTAQUE),
    ]);

    await visualizador.carregar(destaque);
    legenda.innerHTML = `<span class="escala" aria-hidden="true"></span> ${esc(destaque.nome_cientifico)}, ${esc(destaque.tamanho?.toLowerCase())}`;

    raiz.querySelector('[data-colecao]').innerHTML = categorias
      .map((cat) => {
        const itens = entidades.filter((e) => e.categoria_slug === cat.slug);
        return `
          <section class="colecao" id="${esc(cat.slug)}" aria-labelledby="titulo-${esc(cat.slug)}">
            <header class="colecao__cabecalho">
              <h2 id="titulo-${esc(cat.slug)}">${esc(cat.nome)}</h2>
              <p>${esc(cat.descricao)}</p>
            </header>
            <ul class="laminas">
              ${itens.map(cartaoLamina).join('') || '<li class="vazio">Nenhum espécime cadastrado nesta categoria ainda.</li>'}
            </ul>
          </section>`;
      })
      .join('');
  } catch (erro) {
    legenda.textContent = '';
    raiz.querySelector('[data-colecao]').innerHTML = mensagemErro(erro);
  }

  return () => visualizador.destruir();
}

function cartaoLamina(e) {
  return `
    <li>
      <a class="lamina" href="#/especime/${esc(e.slug)}">
        <span class="lamina__etiqueta">
          <span class="lamina__nome">${esc(e.nome)}</span>
          <span class="lamina__cientifico">${esc(e.nome_cientifico)}</span>
        </span>
        <span class="lamina__vidro">${mancha(e.cor_primaria, e.cor_secundaria)}</span>
        <span class="lamina__resumo">${esc(e.resumo)}</span>
      </a>
    </li>`;
}
