import { api } from '../api.js';
import { esc, mancha, mensagemErro } from '../util.js';
import { Visualizador } from '../three/Visualizador.js';
import { gerarMiniaturas } from '../three/miniaturas.js';

const ESPECIME_DESTAQUE = 'sars-cov-2';

const seta = (caminho) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${caminho}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export async function paginaInicial(raiz) {
  raiz.innerHTML = `
    <section class="abertura">
      <div class="abertura__texto">
        <h1>Explore vírus, bactérias e órgãos em 3D</h1>
        <p class="abertura__lead">Gire, aproxime e toque em cada parte para entender como ela funciona e quais doenças estão ligadas a ela.</p>
        <a class="botao" href="#/especime/${ESPECIME_DESTAQUE}" data-explorar>Explorar o coronavírus</a>
      </div>
      <figure class="campo campo--abertura">
        <div class="campo__palco" data-palco></div>
        <button type="button" class="carrossel__seta carrossel__seta--anterior" data-anterior aria-label="Modelo anterior" hidden>${seta('M15 5l-7 7 7 7')}</button>
        <button type="button" class="carrossel__seta carrossel__seta--proximo" data-proximo aria-label="Próximo modelo" hidden>${seta('M9 5l7 7-7 7')}</button>
        <p class="carrossel__contador" data-contador aria-hidden="true"></p>
        <figcaption class="campo__legenda" data-legenda aria-live="polite">Carregando modelo…</figcaption>
      </figure>
    </section>
    <div data-colecao><p class="carregando">Carregando espécimes…</p></div>
  `;

  const palco = raiz.querySelector('[data-palco]');
  const legenda = raiz.querySelector('[data-legenda]');
  const explorar = raiz.querySelector('[data-explorar]');
  const contador = raiz.querySelector('[data-contador]');
  const setas = [raiz.querySelector('[data-anterior]'), raiz.querySelector('[data-proximo]')];
  const visualizador = new Visualizador(palco, { interativo: false });
  let cancelarMiniaturas = () => {};

  try {
    const [categorias, entidades] = await Promise.all([api.categorias(), api.entidades()]);

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

    // Destaque: as setas percorrem todos os espécimes, na mesma ordem das coleções
    let atual = Math.max(entidades.findIndex((e) => e.slug === ESPECIME_DESTAQUE), 0);
    const mostrar = async (indice) => {
      atual = (indice + entidades.length) % entidades.length;
      const entidade = entidades[atual];
      explorar.href = `#/especime/${encodeURIComponent(entidade.slug)}`;
      explorar.textContent = `Explorar ${entidade.nome}`;
      contador.textContent = `${atual + 1} de ${entidades.length}`;
      await visualizador.carregar(entidade);
      legenda.innerHTML = `<span class="escala" aria-hidden="true"></span> ${esc(entidade.nome)} (${esc(entidade.nome_cientifico)}), ${esc(entidade.tamanho?.toLowerCase())}`;
    };
    setas[0].addEventListener('click', () => mostrar(atual - 1));
    setas[1].addEventListener('click', () => mostrar(atual + 1));
    await mostrar(atual);
    if (entidades.length > 1) setas.forEach((botao) => (botao.hidden = false));

    // Só depois do destaque: as fotos dos cartões saem uma de cada vez, sem travar a página
    cancelarMiniaturas = gerarMiniaturas(entidades, (slug, url) => {
      const vidro = raiz.querySelector(`[data-miniatura="${CSS.escape(slug)}"]`);
      if (!vidro) return;
      const imagem = new Image();
      imagem.className = 'lamina__modelo';
      imagem.alt = ''; // decorativa: o nome já está na etiqueta do cartão
      imagem.src = url;
      vidro.replaceChildren(imagem);
    });
  } catch (erro) {
    legenda.textContent = '';
    raiz.querySelector('[data-colecao]').innerHTML = mensagemErro(erro);
  }

  return () => {
    cancelarMiniaturas();
    visualizador.destruir();
  };
}

function cartaoLamina(e) {
  return `
    <li>
      <a class="lamina" href="#/especime/${esc(e.slug)}">
        <span class="lamina__etiqueta">
          <span class="lamina__nome">${esc(e.nome)}</span>
          <span class="lamina__cientifico">${esc(e.nome_cientifico)}</span>
        </span>
        <span class="lamina__vidro" data-miniatura="${esc(e.slug)}">${mancha(e.cor_primaria, e.cor_secundaria)}</span>
        <span class="lamina__resumo">${esc(e.resumo)}</span>
      </a>
    </li>`;
}
