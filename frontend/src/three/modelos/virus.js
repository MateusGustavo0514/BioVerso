import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, pontosFibonacci, esferasInstanciadas, marcarParte } from '../utils/geometria.js';
import { criarHalo } from '../shaders/fresnel.js';
import { criarNucleo } from './genomas.js';

/**
 * Geometria de uma espícula apontando para +Y: haste (cilindro) + cabeça.
 * `lobulos` = 3 faz a cabeça trimérica (gp120 do HIV, GP do Ebola).
 */
export function geometriaEspicula(comprimento, bulbo, lobulos = 1) {
  const haste = new THREE.CylinderGeometry(bulbo * 0.28, bulbo * 0.4, comprimento, 8);
  haste.translate(0, comprimento / 2, 0);
  const partes = [haste];
  if (lobulos === 1) {
    const cabeca = new THREE.SphereGeometry(bulbo, 16, 12);
    cabeca.scale(1, 0.8, 1);
    partes.push(cabeca.translate(0, comprimento, 0));
  } else {
    for (let i = 0; i < lobulos; i++) {
      const a = (i / lobulos) * Math.PI * 2;
      const lobo = new THREE.SphereGeometry(bulbo * 0.62, 12, 10);
      partes.push(lobo.translate(Math.cos(a) * bulbo * 0.5, comprimento, Math.sin(a) * bulbo * 0.5));
    }
  }
  return mergeGeometries(partes);
}

/** Capsômero pentamérico em estrela (HPV): cinco esferas em anel e uma no centro, apontando para +Y. */
function geometriaPentamero(raio) {
  const partes = [new THREE.SphereGeometry(raio * 0.6, 12, 10).translate(0, raio * 0.75, 0)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    partes.push(new THREE.SphereGeometry(raio * 0.5, 12, 10).translate(Math.cos(a) * raio, raio * 0.45, Math.sin(a) * raio));
  }
  return mergeGeometries(partes);
}

/**
 * Partícula viral genérica: envelope (esfera deformada por ruído ou capsídeo facetado),
 * espículas instanciadas, interior escolhido por `nucleo.tipo` e camadas opcionais.
 * Parâmetros vêm do banco (entidades.modelo_params).
 */
export function criarVirus(params, cores) {
  const {
    raio = 1,
    rugosidade = 0.04,
    saliencias = 0,
    chaveSaliencias = 'proteina_m',
    envelope: paramsEnvelope = {},
    espiculas = [{ chave: 'espicula', quantidade: 60, comprimento: 0.3, bulbo: 0.12 }],
    capsomeros: paramsCapsomeros = null,
    nucleo: paramsNucleo = null,
    matriz: paramsMatriz = null,
    semente = 7,
  } = params;
  const { chave: chaveEnvelope = 'envelope', facetado = false, detalhe = 2, cor: corEnvelope = cores.primaria } = paramsEnvelope;

  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  // Envelope: esfera deformada por ruído simplex, ou casca icosaédrica facetada (capsídeos)
  const geoEnvelope = facetado
    ? new THREE.IcosahedronGeometry(raio, detalhe)
    : deformarComRuido(new THREE.SphereGeometry(raio, 128, 96), { amplitude: rugosidade, frequencia: 3, semente });
  const envelope = new THREE.Mesh(
    geoEnvelope,
    new THREE.MeshPhysicalMaterial({
      color: corEnvelope,
      roughness: 0.6,
      sheen: 1,
      sheenColor: new THREE.Color(corEnvelope).offsetHSL(0, 0, 0.2),
      clearcoat: 0.3,
      flatShading: facetado,
    })
  );
  grupo.add(marcarParte(envelope, chaveEnvelope));

  // Pequenas saliências da membrana (proteínas M/E, antígeno de superfície) com InstancedMesh
  if (saliencias > 0) {
    const geo = new THREE.SphereGeometry(raio * 0.035, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(corEnvelope).offsetHSL(0, 0.1, -0.15), roughness: 0.7 });
    const malha = new THREE.InstancedMesh(geo, mat, saliencias);
    const m = new THREE.Matrix4();
    const pontos = pontosFibonacci(saliencias);
    pontos.forEach((p, i) => {
      const deslocado = p.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), aleatorio() * 0.3);
      m.makeTranslation(deslocado.multiplyScalar(raio * 1.0));
      malha.setMatrixAt(i, m);
    });
    grupo.add(marcarParte(malha, chaveSaliencias));
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
  const giro = new THREE.Quaternion();
  const escala = new THREE.Vector3();
  const eixoAleatorio = new THREE.Vector3();
  let indice = 0;

  for (const tipo of espiculas) {
    // `deitada`: proteína achatada sobre a membrana (proteína E da dengue), em vez de espícula em pé
    const geo = tipo.deitada
      ? new THREE.BoxGeometry(tipo.comprimento, tipo.bulbo * 0.5, tipo.bulbo).translate(0, tipo.bulbo * 0.25, 0)
      : geometriaEspicula(tipo.comprimento, tipo.bulbo, tipo.lobulos ?? 1);
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
      dir.applyAxisAngle(eixoAleatorio, (aleatorio() - 0.5) * (tipo.deitada ? 0 : 0.35)).normalize();
      quat.setFromUnitVectors(cima, dir).multiply(giro.setFromAxisAngle(cima, aleatorio() * Math.PI * 2));
      const s = 0.85 + aleatorio() * 0.3;
      escala.set(s, s, s);
      matriz.compose(dir.clone().multiplyScalar(raio * (tipo.deitada ? 1 : 0.97)), quat, escala);
      malha.setMatrixAt(k, matriz);
    }
    grupo.add(marcarParte(malha, tipo.chave));
  }

  // Capsômeros em estrela sobre o capsídeo (HPV)
  if (paramsCapsomeros) {
    const { quantidade = 72, chave = 'capsideo', cor = cores.secundaria, tamanho = 0.075 } = paramsCapsomeros;
    const malha = new THREE.InstancedMesh(geometriaPentamero(raio * tamanho), new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.45, clearcoat: 0.4 }), quantidade);
    pontosFibonacci(quantidade).forEach((dir, k) => {
      quat.setFromUnitVectors(cima, dir).multiply(giro.setFromAxisAngle(cima, aleatorio() * Math.PI * 2));
      malha.setMatrixAt(k, matriz.compose(dir.clone().multiplyScalar(raio * 0.98), quat, escala.setScalar(1)));
    });
    grupo.add(marcarParte(malha, chave));
  }

  // Interior opcional: cada vírus guarda o genoma de um jeito
  const nucleo = paramsNucleo && criarNucleo(paramsNucleo, raio, aleatorio);
  if (nucleo) grupo.add(nucleo);

  // Camada de proteína logo abaixo do envelope (fora do núcleo: ela não gira)
  if (paramsMatriz) {
    const { quantidade, cor, chave = 'proteina_m1', raioRel = 0.93, tamanho = 0.042 } = paramsMatriz;
    const posicoes = pontosFibonacci(quantidade).map((p) => p.multiplyScalar(raio * raioRel));
    grupo.add(marcarParte(esferasInstanciadas(posicoes, raio * tamanho, cor, aleatorio, 8), chave));
  }

  const maiorEspicula = Math.max(0, ...espiculas.map((e) => (e.deitada ? e.bulbo : e.comprimento + e.bulbo)));
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
