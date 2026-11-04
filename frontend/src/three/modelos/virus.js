import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, pontosFibonacci, curvaNovelo, esferasInstanciadas, marcarParte } from '../utils/geometria.js';
import { criarHalo } from '../shaders/fresnel.js';

/** Geometria de uma espícula: haste (cilindro) + cabeça (esfera achatada), apontando para +Y. */
function geometriaEspicula(comprimento, bulbo) {
  const haste = new THREE.CylinderGeometry(bulbo * 0.28, bulbo * 0.4, comprimento, 8);
  haste.translate(0, comprimento / 2, 0);
  const cabeca = new THREE.SphereGeometry(bulbo, 16, 12);
  cabeca.scale(1, 0.8, 1);
  cabeca.translate(0, comprimento, 0);
  return mergeGeometries([haste, cabeca]);
}

/**
 * Super-hélice: enrola uma curva em volta do trajeto, usando os referenciais de Frenet.
 * A amplitude abre em cada conta e fecha entre elas, como um colar enrolado em contas.
 */
function curvaSuperHelice(trajeto, { contas, voltasPorConta, amplitude }) {
  const amostras = contas * 24;
  const { normals, binormals } = trajeto.computeFrenetFrames(amostras);
  const pontos = [];
  for (let i = 0; i <= amostras; i++) {
    const u = i / amostras;
    const abertura = amplitude * Math.abs(Math.sin(u * contas * Math.PI)) ** 0.5;
    const angulo = u * contas * voltasPorConta * Math.PI * 2;
    pontos.push(
      trajeto.getPointAt(u)
        .addScaledVector(normals[i], Math.cos(angulo) * abertura)
        .addScaledVector(binormals[i], Math.sin(angulo) * abertura)
    );
  }
  const curva = new THREE.CatmullRomCurve3(pontos);
  curva.arcLengthDivisions = amostras * 4; // o padrão (200) achataria as voltas
  return curva;
}

/** Nucleocapsídeo contínuo (coronavírus): fita de RNA enrolada nas contas de proteína N. */
function criarNucleoNovelo({ contas = 40, voltasPorConta = 2.5, corRna = '#f0c75e', corProteina = '#6a5acd' }, raio, aleatorio) {
  const nucleo = new THREE.Group();
  const raioConta = raio * 0.085;
  const trajeto = curvaNovelo({ raioMin: raio * 0.3, raioMax: raio * 0.72, pontos: contas, aleatorio });

  const geoRna = new THREE.TubeGeometry(
    curvaSuperHelice(trajeto, { contas, voltasPorConta, amplitude: raioConta * 1.05 }),
    contas * 60, raio * 0.014, 6, false
  );
  const rna = new THREE.Mesh(geoRna, new THREE.MeshPhysicalMaterial({ color: corRna, roughness: 0.35, clearcoat: 0.5 }));
  nucleo.add(marcarParte(rna, 'rna'));

  const posicoes = Array.from({ length: contas }, (_, i) => trajeto.getPointAt((i + 0.5) / contas));
  nucleo.add(marcarParte(esferasInstanciadas(posicoes, raioConta, corProteina, aleatorio), 'proteina_n'));
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
 * Genoma segmentado (influenza): bastões de RNA em dupla hélice, revestidos por NP,
 * com a polimerase na ponta e no arranjo "7 + 1" (sete em volta de um).
 */
function criarNucleoSegmentado(
  { segmentos = 8, comprimentos = [1, 1, 0.96, 0.8, 0.72, 0.62, 0.52, 0.46], corRna = '#f0c75e', corProteina = '#6a5acd', corPolimerase = '#e0527a' },
  raio,
  aleatorio
) {
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
    const x = i === 0 ? 0 : Math.cos(anguloAnel) * raio * 0.3;
    const z = i === 0 ? 0 : Math.sin(anguloAnel) * raio * 0.3;
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

  const rna = new THREE.Mesh(
    mergeGeometries(fitas),
    new THREE.MeshPhysicalMaterial({ color: corRna, roughness: 0.35, clearcoat: 0.5 })
  );
  nucleo.add(marcarParte(rna, 'rna'));
  nucleo.add(marcarParte(esferasInstanciadas(contas, raioConta, corProteina, aleatorio, 10), 'proteina_np'));
  nucleo.add(marcarParte(esferasInstanciadas(polimerases, raio * 0.07, corPolimerase, aleatorio), 'polimerase'));
  return nucleo;
}

// O parâmetro `nucleo.tipo` escolhe como o vírus guarda o genoma
const NUCLEOS = { novelo: criarNucleoNovelo, segmentado: criarNucleoSegmentado };

/**
 * Vírus envelopado genérico (coronavírus, influenza...).
 * Parâmetros vêm do banco (entidades.modelo_params).
 */
export function criarVirus(params, cores) {
  const {
    raio = 1,
    rugosidade = 0.04,
    saliencias = 0,
    espiculas = [{ chave: 'espicula', quantidade: 60, comprimento: 0.3, bulbo: 0.12 }],
    nucleo: paramsNucleo = null,
    matriz: paramsMatriz = null,
    semente = 7,
  } = params;

  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  // Envelope: esfera deformada por ruído simplex
  const geoEnvelope = deformarComRuido(new THREE.SphereGeometry(raio, 128, 96), {
    amplitude: rugosidade,
    frequencia: 3,
    semente,
  });
  const envelope = new THREE.Mesh(
    geoEnvelope,
    new THREE.MeshPhysicalMaterial({
      color: cores.primaria,
      roughness: 0.6,
      sheen: 1,
      sheenColor: new THREE.Color(cores.primaria).offsetHSL(0, 0, 0.2),
      clearcoat: 0.3,
    })
  );
  grupo.add(marcarParte(envelope, 'envelope'));

  // Pequenas saliências da membrana (proteínas M/E) com InstancedMesh
  if (saliencias > 0) {
    const geo = new THREE.SphereGeometry(raio * 0.035, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cores.primaria).offsetHSL(0, 0.1, -0.15), roughness: 0.7 });
    const malha = new THREE.InstancedMesh(geo, mat, saliencias);
    const m = new THREE.Matrix4();
    const pontos = pontosFibonacci(saliencias);
    pontos.forEach((p, i) => {
      const deslocado = p.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), aleatorio() * 0.3);
      m.makeTranslation(deslocado.multiplyScalar(raio * 1.0));
      malha.setMatrixAt(i, m);
    });
    grupo.add(marcarParte(malha, 'proteina_m'));
  }

  // Espículas: todas distribuídas numa espiral de Fibonacci e sorteadas entre os tipos
  const total = espiculas.reduce((s, e) => s + e.quantidade, 0);
  const direcoes = pontosFibonacci(total);
  for (let i = direcoes.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [direcoes[i], direcoes[j]] = [direcoes[j], direcoes[i]];
  }

  const cima = new THREE.Vector3(0, 1, 0);
  const matriz = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const escala = new THREE.Vector3();
  const eixoAleatorio = new THREE.Vector3();
  let indice = 0;

  for (const tipo of espiculas) {
    const geo = geometriaEspicula(tipo.comprimento, tipo.bulbo);
    const mat = new THREE.MeshPhysicalMaterial({
      color: tipo.cor ?? cores.secundaria,
      roughness: 0.35,
      clearcoat: 0.6,
    });
    const malha = new THREE.InstancedMesh(geo, mat, tipo.quantidade);

    for (let k = 0; k < tipo.quantidade; k++, indice++) {
      const dir = direcoes[indice].clone();
      // leve inclinação aleatória para não parecer artificial
      eixoAleatorio.set(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
      dir.applyAxisAngle(eixoAleatorio, (aleatorio() - 0.5) * 0.35).normalize();
      quat.setFromUnitVectors(cima, dir);
      const s = 0.85 + aleatorio() * 0.3;
      escala.set(s, s, s);
      matriz.compose(dir.clone().multiplyScalar(raio * 0.97), quat, escala);
      malha.setMatrixAt(k, matriz);
    }
    grupo.add(marcarParte(malha, tipo.chave));
  }

  // Interior opcional: cada vírus guarda o genoma de um jeito
  const nucleo = paramsNucleo && NUCLEOS[paramsNucleo.tipo](paramsNucleo, raio, aleatorio);
  if (nucleo) grupo.add(nucleo);

  // Camada de proteína logo abaixo do envelope (fora do núcleo: ela não gira)
  if (paramsMatriz) {
    const posicoes = pontosFibonacci(paramsMatriz.quantidade).map((p) => p.multiplyScalar(raio * 0.93));
    grupo.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.042, paramsMatriz.cor, aleatorio, 8), 'proteina_m1'));
  }

  const maiorEspicula = Math.max(...espiculas.map((e) => e.comprimento + e.bulbo));
  const halo = criarHalo(raio + maiorEspicula + 0.08, { cor: cores.secundaria, intensidade: 0.9, potencia: 3 });
  grupo.add(halo);

  function atualizar(t) {
    const respiro = 1 + Math.sin(t * 1.3) * 0.008;
    envelope.scale.setScalar(respiro);
    if (nucleo) nucleo.rotation.y = t * 0.06;
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar };
}
