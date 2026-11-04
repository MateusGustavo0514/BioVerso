import * as THREE from 'three';
import { criarAleatorio, curvaNovelo, esferasInstanciadas, marcarParte } from '../utils/geometria.js';

/**
 * Interior de todas as células, visível com o corte. Como o corte atravessa várias
 * células do cacho, cada uma precisa do seu conteúdo: tudo é instanciado.
 */
function criarInterior({ posicoes, escalas, raio, ribossomos, corMembrana, corDna, corRibossomo, aleatorio }) {
  const interior = new THREE.Group();
  const matriz = new THREE.Matrix4();
  const giro = new THREE.Quaternion();
  const eixo = new THREE.Vector3();
  const escala = new THREE.Vector3();

  // Membrana plasmática: o vão até a superfície representa a parede espessa das Gram-positivas
  const membrana = new THREE.InstancedMesh(
    new THREE.SphereGeometry(raio * 0.82, 32, 24),
    new THREE.MeshPhysicalMaterial({ color: corMembrana, roughness: 0.5 }),
    posicoes.length
  );

  // Nucleoide: um único novelo de DNA circular, reaproveitado em orientações diferentes
  const curvaDna = curvaNovelo({ raioMin: raio * 0.15, raioMax: raio * 0.45, pontos: 44, aleatorio, fechada: true });
  curvaDna.arcLengthDivisions = 800; // o padrão (200) achataria as dobras
  const cromossomo = new THREE.InstancedMesh(
    new THREE.TubeGeometry(curvaDna, 700, raio * 0.022, 6, true),
    new THREE.MeshPhysicalMaterial({ color: corDna, roughness: 0.35, clearcoat: 0.5 }),
    posicoes.length
  );

  posicoes.forEach((p, i) => {
    membrana.setMatrixAt(i, matriz.makeScale(escalas[i], escalas[i], escalas[i]).setPosition(p));
    eixo.set(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
    giro.setFromAxisAngle(eixo, aleatorio() * Math.PI * 2);
    cromossomo.setMatrixAt(i, matriz.compose(p, giro, escala.setScalar(escalas[i])));
  });
  interior.add(marcarParte(membrana, 'membrana_plasmatica'), marcarParte(cromossomo, 'cromossomo'));

  // Ribossomos: no citoplasma de cada célula, entre o nucleoide e a membrana
  const pontos = posicoes.flatMap((p) =>
    Array.from({ length: ribossomos }, () => {
      const distancia = raio * (0.35 + 0.42 * Math.cbrt(aleatorio()));
      const direcao = new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
      return direcao.multiplyScalar(distancia).add(p);
    })
  );
  interior.add(marcarParte(esferasInstanciadas(pontos, raio * 0.04, corRibossomo, aleatorio, 6), 'ribossomos'));
  return interior;
}

/** Cacho de cocos (ex.: Staphylococcus). Empacotamento aleatório sem sobreposição. */
export function criarCoco(params, cores) {
  const { celulas = 20, raio = 0.5, semente = 11, ribossomos = 110, corDna = '#f0c75e', corRibossomo = '#6a5acd' } = params;
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
  grupo.add(criarInterior({
    posicoes, escalas, raio, ribossomos, corDna, corRibossomo, aleatorio,
    corMembrana: new THREE.Color(cores.primaria).offsetHSL(0, -0.1, 0.2),
  }));

  return { objeto: grupo, atualizar: aplicarMatrizes };
}
