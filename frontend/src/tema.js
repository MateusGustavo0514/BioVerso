// Tema claro ou escuro. O script no <head> do index.html já aplica o tema antes da
// primeira pintura (sem piscar); aqui ficam o botão do topo e a escolha salva.
const CHAVE = 'bioverso-tema';
const sistemaEscuro = window.matchMedia('(prefers-color-scheme: dark)');

// localStorage pode estar bloqueado (aba anônima, cookies desligados): o tema só deixa de ser lembrado
const lerEscolha = () => {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
};
const salvarEscolha = (tema) => {
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {}
};

export function iniciarTema(botao) {
  const aplicar = (tema) => {
    document.documentElement.dataset.tema = tema;
    botao.setAttribute('aria-pressed', String(tema === 'escuro'));
  };

  aplicar(lerEscolha() ?? (sistemaEscuro.matches ? 'escuro' : 'claro'));

  botao.addEventListener('click', () => {
    const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
    aplicar(novo);
    salvarEscolha(novo);
  });

  // sem escolha salva, o site acompanha o tema do sistema
  sistemaEscuro.addEventListener('change', (e) => lerEscolha() || aplicar(e.matches ? 'escuro' : 'claro'));
}
