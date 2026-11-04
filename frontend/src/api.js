const BASE = import.meta.env.VITE_API_URL ?? '/api';

async function requisitar(caminho) {
  let resposta;
  try {
    resposta = await fetch(BASE + caminho);
  } catch {
    throw new Error('Não foi possível falar com a API. Verifique se o backend está rodando na porta 3333.');
  }
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? `A API respondeu com erro ${resposta.status}.`);
  return corpo;
}

export const api = {
  categorias: () => requisitar('/categorias'),
  entidades: (filtros = {}) => requisitar(`/entidades?${new URLSearchParams(filtros)}`),
  entidade: (slug) => requisitar(`/entidades/${encodeURIComponent(slug)}`),
  doencas: () => requisitar('/doencas'),
  doenca: (slug) => requisitar(`/doencas/${encodeURIComponent(slug)}`),
};
