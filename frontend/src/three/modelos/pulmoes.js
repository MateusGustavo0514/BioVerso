import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, cilindroEntre, marcarParte } from '../utils/geometria.js';

/**
 * Formata uma esfera unitária no formato de um pulmão.
 * lado = -1 (pulmão direito do paciente, à esquerda da tela) ou +1 (esquerdo).
 */
function geometriaPulmao(lado, semente) {
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const medial = v.x * -lado > 0; // face voltada para o centro do tórax

    if (medial) v.x *= 0.45; // face medial achatada (onde fica o coração)
    if (lado > 0 && medial && v.y > -0.7 && v.y < 0.15) v.x *= 0.35; // incisura cardíaca
    if (v.y < -0.55) v.y = -0.55 + (v.y + 0.55) * 0.3; // base apoiada no diafragma
    const afinar = 1 - 0.4 * Math.max(v.y, 0); // ápice mais estreito
    v.x *= afinar;
    v.z *= afinar;

    v.x *= 0.8;
    v.y *= 1.35;
    v.z *= 0.7;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return deformarComRuido(geo, { amplitude: 0.035, frequencia: 1.8, semente });
}

/** Árvore brônquica recursiva: cada ramo se divide em dois, menor e mais fino. */
function geometriaArvore({ inicio, direcao, comprimento, raio, profundidade, centro, limites, aleatorio, saida }) {
  const fim = inicio.clone().addScaledVector(direcao, comprimento);
  const rel = fim.clone().sub(centro);
  const dentro = (rel.x / limites.x) ** 2 + (rel.y / limites.y) ** 2 + (rel.z / limites.z) ** 2 < 1;
  if (!dentro) return;

  saida.push(cilindroEntre(inicio, fim, raio, raio * 0.75, 8));
  if (profundidade === 0) return;

  for (const sinal of [-1, 1]) {
    const eixo = new THREE.Vector3().crossVectors(direcao, new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5)).normalize();
    const novaDirecao = direcao.clone().applyAxisAngle(eixo, sinal * (0.3 + aleatorio() * 0.3)).normalize();
    geometriaArvore({
      inicio: fim, direcao: novaDirecao, comprimento: comprimento * (0.7 + aleatorio() * 0.12),
      raio: raio * 0.72, profundidade: profundidade - 1, centro, limites, aleatorio, saida,
    });
  }
}

export function criarPulmoes(params, cores) {
  const { respiracoesPorMinuto = 14, ramificacoes = 5, semente = 5 } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  const corPulmao = new THREE.Color(cores.primaria);
  const corCartilagem = new THREE.Color(cores.secundaria);

  // Material semitransparente: permite ver a árvore brônquica por dentro
  const materialPulmao = () =>
    new THREE.MeshPhysicalMaterial({
      color: corPulmao, roughness: 0.55, sheen: 1, sheenColor: '#ffd6dc',
      transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
    });
  const materialVia = new THREE.MeshPhysicalMaterial({ color: corCartilagem, roughness: 0.4, clearcoat: 0.6 });

  // Traqueia com anéis de cartilagem em "C" (TorusGeometry com arco incompleto)
  const traqueia = new THREE.Group();
  const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 1.1, 32, 1, true), materialVia);
  tubo.position.y = 1.55;
  traqueia.add(marcarParte(tubo, 'traqueia'));
  const aneis = new THREE.InstancedMesh(new THREE.TorusGeometry(0.135, 0.025, 8, 32, Math.PI * 1.6), materialVia, 14);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 14; i++) {
    m.makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationY(Math.PI * 0.7)).setPosition(0, 1.08 + i * 0.07, 0);
    aneis.setMatrixAt(i, m);
  }
  traqueia.add(marcarParte(aneis, 'traqueia'));
  grupo.add(traqueia);

  const carina = new THREE.Vector3(0, 1.0, 0);
  const lados = [];

  for (const [lado, chave] of [[-1, 'pulmao_direito'], [1, 'pulmao_esquerdo']]) {
    const conjunto = new THREE.Group();
    const centro = new THREE.Vector3(lado * 0.78, 0, 0);
    const escalaLado = lado < 0 ? 1.05 : 1; // o direito é um pouco maior

    const pulmao = new THREE.Mesh(geometriaPulmao(lado, semente + lado), materialPulmao());
    pulmao.position.copy(centro);
    pulmao.scale.setScalar(escalaLado);
    pulmao.renderOrder = 2;
    conjunto.add(marcarParte(pulmao, chave));

    // Brônquio principal + árvore dentro do pulmão
    const hilo = new THREE.Vector3(lado * 0.4, 0.4, 0);
    const pedacos = [cilindroEntre(carina, hilo, 0.09, 0.075, 12)];
    geometriaArvore({
      inicio: hilo,
      direcao: new THREE.Vector3(lado * 0.6, -1, 0).normalize(),
      comprimento: 0.36,
      raio: 0.065,
      profundidade: ramificacoes,
      centro,
      limites: new THREE.Vector3(0.68, 1.1, 0.56).multiplyScalar(escalaLado),
      aleatorio,
      saida: pedacos,
    });
    const arvore = new THREE.Mesh(mergeGeometries(pedacos), materialVia);
    conjunto.add(marcarParte(arvore, 'bronquios'));

    grupo.add(conjunto);
    lados.push(conjunto);
  }

  const omega = (respiracoesPorMinuto / 60) * Math.PI * 2;
  function atualizar(t) {
    const r = (Math.sin(t * omega) + 1) / 2; // 0 = expiração, 1 = inspiração
    for (const conjunto of lados) conjunto.scale.set(1 + 0.04 * r, 1 + 0.025 * r, 1 + 0.05 * r);
  }

  return { objeto: grupo, atualizar };
}
