import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { curvaNovelo, esferasInstanciadas, marcarParte } from '../utils/geometria.js';

/**
 * Interiores de vírus: cada função monta o genoma e as proteínas que o acompanham,
 * dentro de uma esfera de raio `raio`. `nucleo.tipo` em modelo_params escolhe qual usar.
 * As chaves das partes podem ser trocadas pelos parâmetros `chave*`, para baterem com o banco.
 */

const fisico = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.5, ...extra });

/**
 * Super-hélice: enrola uma curva em volta do trajeto, usando os referenciais de Frenet.
 * Por padrão a amplitude abre em cada conta e fecha entre elas, como um colar enrolado em
 * contas; com `continua`, a amplitude é constante (hélice comum). `fracao` < 1 percorre só
 * o começo do trajeto e `fase` gira a hélice (duas fitas em oposição = dupla hélice).
 */
export function curvaSuperHelice(trajeto, { contas, voltasPorConta = 1, amplitude, continua = false, fracao = 1, fase = 0, amostrasPorConta = 24 }) {
  const amostras = Math.ceil(contas * amostrasPorConta);
  const fechada = trajeto.closed && fracao === 1;
  const { normals, binormals } = trajeto.computeFrenetFrames(amostras, trajeto.closed);
  const pontos = [];
  const ultimo = Math.floor(amostras * fracao);
  for (let i = 0; i <= ultimo; i++) {
    const u = i / amostras;
    const abertura = continua ? amplitude : amplitude * Math.abs(Math.sin(u * contas * Math.PI)) ** 0.5;
    const angulo = u * contas * voltasPorConta * Math.PI * 2 + fase;
    pontos.push(
      trajeto.getPointAt(Math.min(u, 1))
        .addScaledVector(normals[Math.min(i, amostras - 1)], Math.cos(angulo) * abertura)
        .addScaledVector(binormals[Math.min(i, amostras - 1)], Math.sin(angulo) * abertura)
    );
  }
  if (fechada) pontos.pop(); // a curva fechada repete o primeiro ponto sozinha
  const curva = new THREE.CatmullRomCurve3(pontos, fechada);
  curva.arcLengthDivisions = amostras * 4; // o padrão (200) achataria as voltas
  return curva;
}

/**
 * Novelo (coronavírus, HPV, hepatite B): fita enrolada num trajeto sorteado, com contas de
 * proteína ao longo dele. `fechada` liga as pontas (DNA circular); `duplaParcial` acrescenta
 * uma segunda fita em oposição ao longo dessa fração do trajeto (DNA parcialmente dupla).
 */
function criarNucleoNovelo(spec, raio, aleatorio) {
  const {
    contas = 40, voltasPorConta = 2.5, raioMin = 0.3, raioMax = 0.72, fechada = false, continua = false,
    duplaParcial = 0, espessura = 0.014, raioConta = 0.085,
    corRna = '#f0c75e', corProteina = '#6a5acd', corPolimerase = '#e0527a',
    chaveRna = 'rna', chaveProteina = 'proteina_n', chavePolimerase = 'polimerase', polimerases = 0,
  } = spec;
  const nucleo = new THREE.Group();
  const trajeto = curvaNovelo({ raioMin: raio * raioMin, raioMax: raio * raioMax, pontos: contas, aleatorio, fechada });
  const amplitude = raio * raioConta * 1.05;

  const fitas = [new THREE.TubeGeometry(curvaSuperHelice(trajeto, { contas, voltasPorConta, amplitude, continua }), contas * 60, raio * espessura, 6, fechada)];
  if (duplaParcial > 0) {
    const segunda = curvaSuperHelice(trajeto, { contas, voltasPorConta, amplitude, continua, fracao: duplaParcial, fase: Math.PI });
    fitas.push(new THREE.TubeGeometry(segunda, Math.ceil(contas * 60 * duplaParcial), raio * espessura, 6, false));
  }
  fitas.forEach((f) => f.deleteAttribute('uv'));
  nucleo.add(marcarParte(new THREE.Mesh(mergeGeometries(fitas), fisico(corRna)), chaveRna));

  if (chaveProteina) {
    const posicoes = Array.from({ length: contas }, (_, i) => trajeto.getPointAt((i + 0.5) / contas));
    nucleo.add(marcarParte(esferasInstanciadas(posicoes, raio * raioConta, corProteina, aleatorio), chaveProteina));
  }
  if (polimerases > 0) {
    const posicoes = Array.from({ length: polimerases }, () => trajeto.getPointAt(aleatorio()));
    nucleo.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.07, corPolimerase, aleatorio), chavePolimerase));
  }
  return nucleo;
}

/** Fita em grampo: desce por uma hélice, faz a volta na base e sobe pela hélice oposta. */
function curvaGrampo({ comprimento, raioHelice, passo }) {
  const amostras = Math.ceil((comprimento / passo) * 14);
  const pontoHelice = (u, fase) => {
    const angulo = ((u * comprimento) / passo) * Math.PI * 2 + fase;
    return new THREE.Vector3(Math.cos(angulo) * raioHelice, -u * comprimento, Math.sin(angulo) * raioHelice);
  };
  const pontos = [];
  for (let i = 0; i <= amostras; i++) pontos.push(pontoHelice(i / amostras, 0));
  for (let i = amostras; i >= 0; i--) pontos.push(pontoHelice(i / amostras, Math.PI));
  const curva = new THREE.CatmullRomCurve3(pontos);
  curva.arcLengthDivisions = amostras * 12; // o padrão (200) achataria as voltas
  return curva;
}

/**
 * Genoma segmentado (influenza, rotavírus): bastões de RNA em dupla hélice, revestidos
 * por proteína, com a polimerase na ponta, no arranjo "n + 1" (um no centro, os outros em volta).
 */
function criarNucleoSegmentado(spec, raio, aleatorio) {
  const {
    segmentos = 8, comprimentos = [1, 1, 0.96, 0.8, 0.72, 0.62, 0.52, 0.46], raioAnel = 0.3,
    corRna = '#f0c75e', corProteina = '#6a5acd', corPolimerase = '#e0527a',
    chaveRna = 'rna', chaveProteina = 'proteina_np', chavePolimerase = 'polimerase',
  } = spec;
  const nucleo = new THREE.Group();
  nucleo.rotation.z = -0.35; // inclinado para o arranjo não parecer colunas retas
  const comprimentoMaximo = raio * 1.15;
  const topo = comprimentoMaximo / 2;
  const raioHelice = raio * 0.045;
  const raioConta = raio * 0.034;
  const passoHelice = raio * 0.24;
  const passoContas = raioConta * 1.7;

  const fitas = [];
  const contas = [];
  const polimerases = [];
  for (let i = 0; i < segmentos; i++) {
    const anguloAnel = ((i - 1) / (segmentos - 1)) * Math.PI * 2;
    const x = i === 0 ? 0 : Math.cos(anguloAnel) * raio * raioAnel;
    const z = i === 0 ? 0 : Math.sin(anguloAnel) * raio * raioAnel;
    const comprimento = comprimentoMaximo * comprimentos[i % comprimentos.length];

    const fita = new THREE.TubeGeometry(
      curvaGrampo({ comprimento, raioHelice: raioHelice + raioConta, passo: passoHelice }),
      Math.ceil((comprimento / passoHelice) * 60), raio * 0.012, 6, false
    );
    fita.deleteAttribute('uv');
    fitas.push(fita.translate(x, topo, z));

    for (let d = 0; d < comprimento; d += passoContas) {
      const angulo = (d / passoHelice) * Math.PI * 2;
      for (const fase of [0, Math.PI]) {
        contas.push(new THREE.Vector3(x + Math.cos(angulo + fase) * raioHelice, topo - d, z + Math.sin(angulo + fase) * raioHelice));
      }
    }
    polimerases.push(new THREE.Vector3(x, topo + raio * 0.05, z));
  }

  nucleo.add(marcarParte(new THREE.Mesh(mergeGeometries(fitas), fisico(corRna)), chaveRna));
  // sem chaveProteina, o RNA fica nu (rotavírus: a dupla fita não é revestida)
  if (chaveProteina) nucleo.add(marcarParte(esferasInstanciadas(contas, raioConta, corProteina, aleatorio, 10), chaveProteina));
  nucleo.add(marcarParte(esferasInstanciadas(polimerases, raio * 0.07, corPolimerase, aleatorio), chavePolimerase));
  return nucleo;
}

/**
 * Nucleocapsídeo helicoidal ao longo de um trajeto dado (sarampo, raiva, Ebola): a proteína N
 * forma uma hélice contínua em volta do RNA. Usado pelos geradores que têm o próprio trajeto.
 */
export function helicePelaCurva(trajeto, raio, spec, aleatorio) {
  const {
    voltas = 60, amplitude = 0.07, espessura = 0.03, polimerases = 6,
    cor = '#6a5acd', corRna = '#f0c75e', corPolimerase = '#e0527a',
    chave = 'nucleocapsideo', chaveRna = 'rna', chavePolimerase = 'polimerase',
  } = spec;
  const grupo = new THREE.Group();
  const helice = curvaSuperHelice(trajeto, { contas: voltas, amplitude: raio * amplitude, continua: true, amostrasPorConta: 14 });
  grupo.add(marcarParte(new THREE.Mesh(new THREE.TubeGeometry(helice, voltas * 12, raio * espessura, 6, false), fisico(cor, { roughness: 0.5 })), chave));
  if (chaveRna) {
    grupo.add(marcarParte(new THREE.Mesh(new THREE.TubeGeometry(trajeto, 240, raio * 0.012, 5, trajeto.closed), fisico(corRna)), chaveRna));
  }
  if (polimerases > 0) {
    const posicoes = Array.from({ length: polimerases }, () => helice.getPointAt(aleatorio()));
    grupo.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.065, corPolimerase, aleatorio), chavePolimerase));
  }
  return grupo;
}

/** Nucleocapsídeo helicoidal flexível, dobrado dentro de uma partícula esférica (sarampo). */
function criarNucleoHelicoidal(spec, raio, aleatorio) {
  const { raioMin = 0.25, raioMax = 0.7, pontos = 18 } = spec;
  const trajeto = curvaNovelo({ raioMin: raio * raioMin, raioMax: raio * raioMax, pontos, aleatorio });
  return helicePelaCurva(trajeto, raio, spec, aleatorio);
}

/**
 * Capsídeo cônico (HIV): superfície de revolução com as duas pontas arredondadas, coberta por
 * hexâmeros de p24 distribuídos por amostragem da superfície. Dentro, duas cópias do RNA e as enzimas.
 */
function criarNucleoConico(spec, raio, aleatorio) {
  const {
    comprimento = 1.35, raioBase = 0.42, raioTopo = 0.13, hexameros = 150, enzimas = 10,
    corCapsideo = '#d8c8a8', corRna = '#f0c75e', corEnzimas = '#e0527a',
    chaveCapsideo = 'capsideo', chaveRna = 'rna', chaveEnzimas = 'enzimas',
  } = spec;
  const nucleo = new THREE.Group();
  nucleo.rotation.set(0.35, 0, 0.55); // inclinado: o cone aparece de lado no corte

  const metade = (raio * comprimento) / 2;
  const rTopo = raio * raioTopo;
  const rBase = raio * raioBase;
  const perfil = [];
  for (let a = Math.PI / 2; a >= 0; a -= Math.PI / 12) perfil.push(new THREE.Vector2(rTopo * Math.cos(a), metade - rTopo + rTopo * Math.sin(a)));
  for (let a = 0; a >= -Math.PI / 2; a -= Math.PI / 12) perfil.push(new THREE.Vector2(rBase * Math.cos(a), -metade + rBase + rBase * Math.sin(a)));
  const casca = new THREE.Mesh(new THREE.LatheGeometry(perfil, 36), fisico(corCapsideo, { roughness: 0.55, transparent: true, opacity: 0.85 }));
  nucleo.add(marcarParte(casca, chaveCapsideo));

  // hexâmeros: discos de seis lados orientados pela normal da casca
  const amostrador = new MeshSurfaceSampler(casca).setRandomGenerator(aleatorio).build();
  const disco = new THREE.CylinderGeometry(raio * 0.05, raio * 0.05, raio * 0.016, 6);
  const malha = new THREE.InstancedMesh(disco, fisico(new THREE.Color(corCapsideo).offsetHSL(0, 0.05, -0.08), { roughness: 0.5 }), hexameros);
  const posicao = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const giro = new THREE.Quaternion();
  const cima = new THREE.Vector3(0, 1, 0);
  const matriz = new THREE.Matrix4();
  for (let i = 0; i < hexameros; i++) {
    amostrador.sample(posicao, normal);
    quat.setFromUnitVectors(cima, normal).multiply(giro.setFromAxisAngle(cima, aleatorio() * Math.PI));
    malha.setMatrixAt(i, matriz.compose(posicao.addScaledVector(normal, raio * 0.006), quat, new THREE.Vector3(1, 1, 1)));
  }
  nucleo.add(marcarParte(malha, chaveCapsideo));

  // duas cópias do RNA, esticadas ao longo do eixo do cone
  const fitas = [];
  for (let k = 0; k < 2; k++) {
    const trajeto = curvaNovelo({
      raioMin: raio * 0.06, raioMax: raio * 0.2, pontos: 30, aleatorio,
      escala: new THREE.Vector3(1, (raio * comprimento * 0.36) / (raio * 0.2), 1),
    });
    const fita = new THREE.TubeGeometry(trajeto, 400, raio * 0.012, 5, false);
    fita.deleteAttribute('uv');
    fitas.push(fita.translate(0, -raio * 0.1, 0));
  }
  nucleo.add(marcarParte(new THREE.Mesh(mergeGeometries(fitas), fisico(corRna)), chaveRna));

  // enzimas (transcriptase reversa, integrase, protease) soltas perto da base larga
  const posicoes = Array.from({ length: enzimas }, () => {
    const y = -metade + rBase * 0.3 + aleatorio() * raio * comprimento * 0.5;
    const r = aleatorio() * rBase * 0.55;
    const a = aleatorio() * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  });
  nucleo.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.045, corEnzimas, aleatorio), chaveEnzimas));
  return nucleo;
}

/** Vértices únicos de um icosaedro subdividido e quais deles são os 12 originais (5 vizinhos). */
export function verticesIcosaedro(raio, detalhe) {
  const extrair = (geo) => {
    const pos = mergeVertices(geo).attributes.position;
    return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i));
  };
  const pontos = extrair(new THREE.IcosahedronGeometry(raio, detalhe));
  const originais = extrair(new THREE.IcosahedronGeometry(raio, 0));
  const pentons = pontos.map((p) => originais.some((o) => o.distanceTo(p) < raio * 0.01));
  return { pontos, pentons };
}

/**
 * Capsídeo icosaédrico (dengue, rotavírus, hepatite B): casca facetada e, opcionalmente, capsômeros
 * nos vértices (pentons nos 12 vértices de cinco vizinhos, hexons nos demais). `interior` é outro
 * núcleo, montado dentro da casca, o que permite camadas concêntricas (rotavírus).
 */
function criarNucleoIcosaedrico(spec, raio, aleatorio) {
  const { chave = 'capsideo', cor = '#d8c8a8', detalhe = 1, raioRel = 0.6, capsomeros = false, corCapsomero, interior = null } = spec;
  const nucleo = new THREE.Group();
  const r = raio * raioRel;
  nucleo.add(marcarParte(new THREE.Mesh(new THREE.IcosahedronGeometry(r, detalhe), fisico(cor, { roughness: 0.5, flatShading: true })), chave));

  if (capsomeros) {
    const { pontos, pentons } = verticesIcosaedro(r, detalhe);
    const malha = esferasInstanciadas(pontos, r * 0.07, corCapsomero ?? new THREE.Color(cor).offsetHSL(0, 0.08, -0.1), aleatorio, 10);
    const corPenton = new THREE.Color(corCapsomero ?? cor).offsetHSL(0.03, 0.1, 0.05);
    const corHexon = new THREE.Color(corCapsomero ?? cor).offsetHSL(0, 0.08, -0.1);
    pontos.forEach((_, i) => malha.setColorAt(i, pentons[i] ? corPenton : corHexon));
    nucleo.add(marcarParte(malha, chave));
  }
  if (interior) nucleo.add(criarNucleo(interior, r, aleatorio));
  return nucleo;
}

const NUCLEOS = {
  novelo: criarNucleoNovelo,
  segmentado: criarNucleoSegmentado,
  helicoidal: criarNucleoHelicoidal,
  conico: criarNucleoConico,
  icosaedrico: criarNucleoIcosaedrico,
};

/** Monta o interior descrito em `spec` (de modelo_params.nucleo) dentro de uma esfera de raio `raio`. */
export function criarNucleo(spec, raio, aleatorio) {
  const montar = NUCLEOS[spec.tipo];
  if (!montar) throw new Error(`Não existe interior do tipo "${spec.tipo}".`);
  return montar(spec, raio, aleatorio);
}
