import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { criarAleatorio, deformarComRuido, esferasInstanciadas, marcarParte } from '../utils/geometria.js';
import { criarHalo } from '../shaders/fresnel.js';
import { geometriaEspicula } from './virus.js';

/**
 * Perfil da "bala" (rabdovírus): uma ponta chata e outra arredondada. Eixo em Y;
 * a superfície vem de uma revolução do perfil (LatheGeometry).
 */
function perfilBala(comprimento, raio) {
  const metade = comprimento / 2;
  const pontos = [new THREE.Vector2(0, -metade)];
  // ponta chata com o canto levemente arredondado
  for (let a = -Math.PI / 2; a <= 0; a += Math.PI / 8) {
    pontos.push(new THREE.Vector2(raio * 0.82 + raio * 0.18 * Math.cos(a), -metade + raio * 0.18 + raio * 0.18 * Math.sin(a)));
  }
  // corpo cilíndrico e calota arredondada
  pontos.push(new THREE.Vector2(raio, metade - raio));
  for (let a = Math.PI / 14; a <= Math.PI / 2 + 1e-6; a += Math.PI / 14) {
    pontos.push(new THREE.Vector2(raio * Math.cos(a), metade - raio + raio * Math.sin(a)));
  }
  return pontos;
}

/** Hélice que acompanha o formato da bala: raio constante no corpo e que fecha na calota. */
class HeliceEmBala extends THREE.Curve {
  constructor(comprimento, raio, voltas) {
    super();
    Object.assign(this, { comprimento, raio, voltas });
  }
  getPoint(t, alvo = new THREE.Vector3()) {
    const { comprimento, raio, voltas } = this;
    const y = -comprimento / 2 + raio * 0.3 + t * (comprimento - raio * 0.55);
    const inicioCalota = comprimento / 2 - raio;
    const alcance = y <= inicioCalota ? raio : Math.sqrt(Math.max(raio * raio - (y - inicioCalota) ** 2, 0));
    const angulo = t * voltas * Math.PI * 2;
    return alvo.set(Math.cos(angulo) * alcance, y, Math.sin(angulo) * alcance);
  }
}

/** Vírus em forma de bala (raiva). Eixo longo inclinado na tela. */
export function criarBala(params, cores) {
  const {
    comprimento = 2.4, raio = 0.5, espiculas = 420, voltas = 30, polimerases = 8, semente = 9,
    corMatriz, corNucleocapsideo = '#6a5acd', corPolimerase = '#e0527a',
  } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();
  const corpo = new THREE.Group();
  corpo.rotation.z = -1.15; // deitada em diagonal: a ponta chata fica embaixo, à esquerda
  grupo.add(corpo);

  // Envelope: superfície de revolução levemente irregular
  const geoEnvelope = deformarComRuido(new THREE.LatheGeometry(perfilBala(comprimento, raio), 64), { amplitude: 0.012, frequencia: 2.5, semente });
  const envelope = new THREE.Mesh(
    geoEnvelope,
    new THREE.MeshPhysicalMaterial({ color: cores.primaria, roughness: 0.55, sheen: 1, sheenColor: new THREE.Color(cores.primaria).offsetHSL(0, 0, 0.2), clearcoat: 0.3 })
  );
  corpo.add(marcarParte(envelope, 'envelope'));

  // Glicoproteína G: trímeros por toda a superfície, menos na ponta chata (amostragem da própria malha)
  const amostrador = new MeshSurfaceSampler(envelope).setRandomGenerator(aleatorio).build();
  const malhaG = new THREE.InstancedMesh(
    geometriaEspicula(raio * 0.2, raio * 0.07, 3),
    new THREE.MeshPhysicalMaterial({ color: cores.secundaria, roughness: 0.35, clearcoat: 0.6 }),
    espiculas
  );
  const posicao = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const cima = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  const giro = new THREE.Quaternion();
  const matriz = new THREE.Matrix4();
  const escala = new THREE.Vector3();
  for (let i = 0; i < espiculas; i++) {
    do amostrador.sample(posicao, normal);
    while (normal.y < -0.6); // a ponta chata tem poucas espículas
    quat.setFromUnitVectors(cima, normal).multiply(giro.setFromAxisAngle(cima, aleatorio() * Math.PI * 2));
    const s = 0.85 + aleatorio() * 0.3;
    malhaG.setMatrixAt(i, matriz.compose(posicao, quat, escala.setScalar(s)));
  }
  corpo.add(marcarParte(malhaG, 'glicoproteina_g'));

  // Matriz M: camada logo abaixo do envelope
  const geoMatriz = new THREE.LatheGeometry(perfilBala(comprimento * 0.94, raio * 0.86), 48);
  const corM = corMatriz ?? new THREE.Color(cores.primaria).offsetHSL(0, -0.1, -0.12);
  corpo.add(marcarParte(new THREE.Mesh(geoMatriz, new THREE.MeshStandardMaterial({ color: corM, roughness: 0.7 })), 'matriz_m'));

  // Nucleocapsídeo: RNA + proteína N enrolados em hélice, dando as estrias vistas ao microscópio
  const helice = new HeliceEmBala(comprimento * 0.86, raio * 0.6, voltas);
  const tubo = new THREE.TubeGeometry(helice, voltas * 24, raio * 0.075, 8, false);
  corpo.add(marcarParte(new THREE.Mesh(tubo, new THREE.MeshPhysicalMaterial({ color: corNucleocapsideo, roughness: 0.5, clearcoat: 0.3 })), 'nucleocapsideo'));

  // Polimerase L: presa ao nucleocapsídeo em alguns pontos
  const posicoes = Array.from({ length: polimerases }, () => helice.getPoint(aleatorio()).multiplyScalar(0.8));
  corpo.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.09, corPolimerase, aleatorio), 'polimerase'));

  const halo = criarHalo(1, { cor: cores.secundaria, intensidade: 0.8, potencia: 2.5 });
  halo.scale.set(raio + 0.2, comprimento / 2 + 0.2, raio + 0.2);
  corpo.add(halo);

  function atualizar(t) {
    corpo.rotation.y = t * 0.12; // gira devagar em torno do próprio eixo
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar, foco: envelope };
}
