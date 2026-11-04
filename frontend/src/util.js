/** Escapa texto vindo da API antes de inserir em HTML. */
export const esc = (valor = '') =>
  String(valor).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const mensagemErro = (erro) => `
  <div class="aviso" role="alert">
    <p class="aviso__titulo">O conteúdo não carregou.</p>
    <p>${esc(erro.message)}</p>
  </div>`;

/** Mancha em forma de lâmina corada, com as cores do espécime. */
export const mancha = (primaria, secundaria) =>
  `<span class="mancha" style="--c1:${esc(primaria)};--c2:${esc(secundaria)}" aria-hidden="true"></span>`;
