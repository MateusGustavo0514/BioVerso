import { paginaInicial } from './pages/inicio.js';
import { paginaEspecime } from './pages/especime.js';
import { paginaDoencas, paginaDoenca } from './pages/doencas.js';

const rotas = [
  [/^\/?$/, paginaInicial],
  [/^\/especime\/([\w-]+)$/, paginaEspecime],
  [/^\/doencas$/, paginaDoencas],
  [/^\/doenca\/([\w-]+)$/, paginaDoenca],
];

export function iniciarRotas(raiz) {
  let limparAnterior = null;
  let navegacaoAtual = 0;

  async function resolver() {
    // formato: #/caminho#ancora
    const [, caminho = '/', ancora] = location.hash.match(/^#([^#]*)#?(.*)$/) ?? [];
    const rota = rotas.find(([padrao]) => padrao.test(caminho));

    const navegacao = ++navegacaoAtual;
    limparAnterior?.();
    limparAnterior = null;

    if (!rota) {
      raiz.innerHTML = `<section class="pagina"><h1>Página não encontrada</h1><p><a href="#/">Voltar ao início</a></p></section>`;
      return;
    }
    const [padrao, pagina] = rota;
    const limpar = await pagina(raiz, ...caminho.match(padrao).slice(1));
    if (navegacao !== navegacaoAtual) return limpar?.(); // o usuário já navegou para outra página
    limparAnterior = limpar;

    if (ancora) document.getElementById(ancora)?.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', resolver);
  resolver();
}
