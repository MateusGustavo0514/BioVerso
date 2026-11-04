import { criarVirus } from './virus.js';
import { criarBacilo } from './bacilo.js';
import { criarCoco } from './coco.js';
import { criarCoracao } from './coracao.js';
import { criarPulmoes } from './pulmoes.js';

// A coluna `modelo_tipo` do banco escolhe qual gerador usar.
// Para adicionar um novo modelo: crie o arquivo, registre aqui e cadastre no banco.
const geradores = {
  virus: criarVirus,
  bacilo: criarBacilo,
  coco: criarCoco,
  coracao: criarCoracao,
  pulmoes: criarPulmoes,
};

export function criarModelo(tipo, params = {}, cores) {
  const gerador = geradores[tipo];
  if (!gerador) throw new Error(`Não existe gerador 3D para o tipo "${tipo}".`);
  return gerador(params, cores);
}
