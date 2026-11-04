import * as THREE from 'three';
import { criarAleatorio, marcarParte } from '../utils/geometria.js';

/** Cacho de cocos (ex.: Staphylococcus). Empacotamento aleatório sem sobreposição. */
export function criarCoco(params, cores) {
  const { celulas = 20, raio = 0.5, semente = 11 } = params;
  const aleatorio = criarAleatorio(semente);

  // cresce o cacho escolhendo, a cada passo, o candidato válido mais próximo do centro (fica compacto)
  const posicoes = [new THREE.Vector3()];
  let tentativas = 0;
  while (posicoes.length < celulas && tentativas++ < 2000) {
    let melhor = null;
    for (let k = 0; k < 16; k++) {
      const base = posicoes[Math.floor(aleatorio() * posicoes.length)];
      const dir = new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
      const candidato = base.clone().addScaledVector(dir, raio * 1.95);
      const livre = posicoes.every((p) => p.distanceTo(candidato) > raio * 1.9);
      if (livre && (!melhor || candidato.length() < melhor.length())) melhor = candidato;
    }
    if (melhor) posicoes.push(melhor);
  }
  const centro = posicoes.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(posicoes.length);
  posicoes.forEach((p) => p.sub(centro));

  const geo = new THREE.SphereGeometry(raio, 48, 32);
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.3 });
  const malha = new THREE.InstancedMesh(geo, mat, posicoes.length);

  const corA = new THREE.Color(cores.primaria);
  const corB = new THREE.Color(cores.secundaria);
  const escalas = posicoes.map(() => 0.92 + aleatorio() * 0.12);
  posicoes.forEach((_, i) => malha.setColorAt(i, corA.clone().lerp(corB, aleatorio() * 0.35)));

  const m = new THREE.Matrix4();
  function aplicarMatrizes(t) {
    posicoes.forEach((p, i) => {
      const s = escalas[i] * (1 + Math.sin(t * 1.8 + i) * 0.015);
      m.makeScale(s, s, s).setPosition(p);
      malha.setMatrixAt(i, m);
    });
    malha.instanceMatrix.needsUpdate = true;
  }
  aplicarMatrizes(0);
  malha.computeBoundingBox();
  malha.computeBoundingSphere();

  const grupo = new THREE.Group();
  grupo.add(marcarParte(malha, 'celula'));

  return { objeto: grupo, atualizar: aplicarMatrizes };
}
