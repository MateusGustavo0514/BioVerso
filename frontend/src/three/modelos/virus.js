import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, pontosFibonacci, marcarParte } from '../utils/geometria.js';
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
 * Vírus envelopado genérico (coronavírus, influenza...).
 * Parâmetros vêm do banco (entidades.modelo_params).
 */
export function criarVirus(params, cores) {
  const {
    raio = 1,
    rugosidade = 0.04,
    saliencias = 0,
    espiculas = [{ chave: 'espicula', quantidade: 60, comprimento: 0.3, bulbo: 0.12 }],
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

  const maiorEspicula = Math.max(...espiculas.map((e) => e.comprimento + e.bulbo));
  const halo = criarHalo(raio + maiorEspicula + 0.08, { cor: cores.secundaria, intensidade: 0.9, potencia: 3 });
  grupo.add(halo);

  function atualizar(t) {
    const respiro = 1 + Math.sin(t * 1.3) * 0.008;
    envelope.scale.setScalar(respiro);
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar };
}
