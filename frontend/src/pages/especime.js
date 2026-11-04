import { api } from '../api.js';
import { esc, mensagemErro } from '../util.js';
import { Visualizador } from '../three/Visualizador.js';

const NOME_RELACAO = { causa: 'Causa', afeta: 'Pode ser afetado por' };

export async function paginaEspecime(raiz, slug) {
  raiz.innerHTML = `<section class="pagina"><p class="carregando">Carregando espécime…</p></section>`;

  let entidade;
  try {
    entidade = await api.entidade(slug);
  } catch (erro) {
    raiz.innerHTML = `<section class="pagina">${mensagemErro(erro)}<p><a href="#/">Voltar ao início</a></p></section>`;
    return;
  }

  const partes = Object.fromEntries(entidade.partes.map((p) => [p.chave, p]));
  const porRelacao = (rel) => entidade.doencas.filter((d) => d.relacao === rel);

  raiz.innerHTML = `
    <article class="especime">
      <nav class="trilha" aria-label="Você está em">
        <a href="#/#${esc(entidade.categoria_slug)}">${esc(entidade.categoria_nome)}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">${esc(entidade.nome)}</span>
      </nav>

      <div class="especime__grade">
        <figure class="campo campo--especime">
          <div class="campo__palco" data-palco></div>
          <div class="dica-parte" data-dica hidden></div>
          <div class="ferramentas" role="group" aria-label="Ferramentas do modelo 3D">
            <button type="button" class="ferramenta" data-pausar aria-pressed="false">Pausar</button>
            <button type="button" class="ferramenta" data-aramado aria-pressed="false">Aramado</button>
            <label class="ferramenta ferramenta--corte">
              Corte
              <input type="range" min="0" max="1" step="0.01" value="0" data-corte />
            </label>
          </div>
          <figcaption class="campo__legenda">
            <span class="escala" aria-hidden="true"></span> ${esc(entidade.tamanho ?? '')}
          </figcaption>
          <p class="campo__instrucao">Arraste para girar, use a roda do mouse para aproximar e clique numa parte.</p>
        </figure>

        <div class="especime__info">
          <header>
            <h1>${esc(entidade.nome)}</h1>
            <p class="cientifico">${esc(entidade.nome_cientifico)}</p>
          </header>
          <p class="especime__descricao">${esc(entidade.descricao)}</p>

          <section aria-labelledby="titulo-partes">
            <h2 id="titulo-partes">Partes do modelo</h2>
            <div class="partes" role="group" aria-label="Destacar parte no modelo">
              ${entidade.partes.map((p) => `<button type="button" class="parte" data-parte="${esc(p.chave)}" aria-pressed="false">${esc(p.nome)}</button>`).join('')}
            </div>
            <div class="parte-detalhe" data-detalhe aria-live="polite">
              <p class="parte-detalhe__vazio">Selecione uma parte no modelo ou na lista acima.</p>
            </div>
          </section>

          ${['causa', 'afeta']
            .filter((rel) => porRelacao(rel).length)
            .map(
              (rel) => `
              <section>
                <h2>${NOME_RELACAO[rel]}</h2>
                <ul class="lista-doencas">
                  ${porRelacao(rel).map((d) => `<li><a href="#/doenca/${esc(d.slug)}">${esc(d.nome)}</a><span>${esc(d.resumo)}</span></li>`).join('')}
                </ul>
              </section>`
            )
            .join('')}

          ${entidade.curiosidades.length ? `
            <section>
              <h2>Você sabia?</h2>
              <ul class="curiosidades">${entidade.curiosidades.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
            </section>` : ''}
        </div>
      </div>
    </article>
  `;

  const dica = raiz.querySelector('[data-dica]');
  const detalhe = raiz.querySelector('[data-detalhe]');
  const botoes = [...raiz.querySelectorAll('[data-parte]')];

  const mostrarParte = (chave) => {
    botoes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.parte === chave)));
    const parte = partes[chave];
    detalhe.innerHTML = parte
      ? `<h3>${esc(parte.nome)}</h3><p>${esc(parte.descricao)}</p>`
      : `<p class="parte-detalhe__vazio">Selecione uma parte no modelo ou na lista acima.</p>`;
  };

  const visualizador = new Visualizador(raiz.querySelector('[data-palco]'), {
    aoPassar: (chave, x, y) => {
      if (!chave) return (dica.hidden = true);
      dica.hidden = false;
      dica.textContent = partes[chave]?.nome ?? chave;
      dica.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    },
    aoSelecionar: mostrarParte,
  });

  botoes.forEach((b) =>
    b.addEventListener('click', () => {
      const chave = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.parte;
      visualizador.selecionar(chave);
      mostrarParte(chave);
    })
  );

  const botaoPausar = raiz.querySelector('[data-pausar]');
  const botaoAramado = raiz.querySelector('[data-aramado]');
  const alternar = (botao) => {
    const ativo = botao.getAttribute('aria-pressed') !== 'true';
    botao.setAttribute('aria-pressed', String(ativo));
    return ativo;
  };
  botaoPausar.setAttribute('aria-pressed', String(visualizador.pausado));
  botaoPausar.addEventListener('click', () => visualizador.pausar(alternar(botaoPausar)));
  botaoAramado.addEventListener('click', () => visualizador.definirAramado(alternar(botaoAramado)));
  raiz.querySelector('[data-corte]').addEventListener('input', (e) => visualizador.definirCorte(Number(e.target.value)));

  try {
    await visualizador.carregar(entidade);
  } catch (erro) {
    raiz.querySelector('[data-palco]').innerHTML = mensagemErro(erro);
  }

  return () => visualizador.destruir();
}
