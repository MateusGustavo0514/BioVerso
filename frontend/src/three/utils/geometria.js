import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Gerador pseudoaleatório com semente (mulberry32): o mesmo modelo sai igual toda vez. */
export function criarAleatorio(semente = 1) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Desloca cada vértice ao longo da própria normal usando ruído simplex 3D.
 * É o que dá o aspecto orgânico (irregular) às membranas e órgãos.
 */
export function deformarComRuido(geometria, { amplitude = 0.05, frequencia = 2.5, oitavas = 2, semente = 1 } = {}) {
  geometria.deleteAttribute('uv');
  const geo = mergeVertices(geometria); // une vértices duplicados na costura da esfera
  geo.computeVertexNormals();

  const ruido = createNoise3D(criarAleatorio(semente));
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    let deslocamento = 0;
    let amp = 1;
    let freq = frequencia;
    for (let o = 0; o < oitavas; o++) {
      deslocamento += ruido(v.x * freq, v.y * freq, v.z * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    v.addScaledVector(n, deslocamento * amplitude);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  return geo;
}

/** Distribui N pontos quase uniformes numa esfera (espiral de Fibonacci). */
export function pontosFibonacci(quantidade) {
  const pontos = [];
  const anguloDourado = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < quantidade; i++) {
    const y = 1 - (i / Math.max(quantidade - 1, 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = anguloDourado * i;
    pontos.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return pontos;
}

/** Cilindro que liga dois pontos (útil para ramificações). */
export function cilindroEntre(inicio, fim, raioInicio, raioFim, segmentos = 8) {
  const direcao = new THREE.Vector3().subVectors(fim, inicio);
  const comprimento = direcao.length();
  const geo = new THREE.CylinderGeometry(raioFim, raioInicio, comprimento, segmentos, 1, false);
  geo.translate(0, comprimento / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direcao.normalize());
  geo.applyQuaternion(q);
  geo.translate(inicio.x, inicio.y, inicio.z);
  return geo;
}

/** Marca um objeto como "parte" clicável (a chave bate com a tabela `partes` do banco). */
export function marcarParte(objeto, chave) {
  objeto.userData.parte = chave;
  return objeto;
}
