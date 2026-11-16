import { criarVirus } from './virus.js';
import { criarBacilo } from './bacilo.js';
import { criarCoco } from './coco.js';
import { criarCoracao } from './coracao.js';
import { criarPulmoes } from './pulmoes.js';
import { criarBala } from './bala.js';
import { criarFilamento } from './filamento.js';
import { criarEspiral } from './espiral.js';
import { criarDiplococo } from './diplococo.js';
import { criarEstomago } from './estomago.js';
import { criarIntestino } from './intestino.js';
import { criarFigado } from './figado.js';
import { criarRim } from './rim.js';
import { criarOlho } from './olho.js';
import { criarPele } from './pele.js';
import { criarOsso } from './osso.js';
import { criarCerebro } from './cerebro.js';

// A coluna `modelo_tipo` do banco escolhe qual gerador usar.
// Para adicionar um novo modelo: crie o arquivo, registre aqui e cadastre no banco.
const geradores = {
  virus: criarVirus,
  bacilo: criarBacilo,
  coco: criarCoco,
  coracao: criarCoracao,
  pulmoes: criarPulmoes,
  bala: criarBala,
  filamento: criarFilamento,
  espiral: criarEspiral,
  diplococo: criarDiplococo,
  estomago: criarEstomago,
  intestino: criarIntestino,
  figado: criarFigado,
  rim: criarRim,
  olho: criarOlho,
  pele: criarPele,
  osso: criarOsso,
  cerebro: criarCerebro,
};

export function criarModelo(tipo, params = {}, cores) {
  const gerador = geradores[tipo];
  if (!gerador) throw new Error(`Não existe gerador 3D para o tipo "${tipo}".`);
  return gerador(params, cores);
}
