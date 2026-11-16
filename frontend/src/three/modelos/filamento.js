import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, marcarParte } from '../utils/geometria.js';
import { criarHalo } from '../shaders/fresnel.js';
import { geometriaEspicula } from './virus.js';
import { helicePelaCurva } from './genomas.js';

/** Trajeto em "cajado": sobe, faz a volta e enrola, como as partículas de Ebola ao microscópio. */
function trajetoCajado(escala) {
  const pontos = [
    [-1.35, -1.25, 0.05], [-1.05, -0.55, 0.0], [-0.7, 0.1, -0.05], [-0.3, 0.7, 0.0], [0.2, 1.1, 0.08],
    [0.75, 1.15, 0.05], [1.15, 0.8, -0.05], [1.15, 0.25, -0.1], [0.8, -0.1, -0.05], [0.4, 0.0, 0.05], [0.25, 0.35, 0.1],
  ].map(([x, y, z]) => new THREE.Vector3(x * escala, y * escala, z * escala));
  return new THREE.CatmullRomCurve3(pontos, false, 'centripetal');
}

/** Vírus filamentoso (Ebola): tubo longo e flexível com o nucleocapsídeo helicoidal no centro. */
export function criarFilamento(params, cores) {
  const {
    raio = 0.2, escala = 1, espiculas = 520, voltas = 110, polimerases = 12, semente = 13,
    corMatriz, corNucleocapsideo = '#6a5acd', corRna = '#f0c75e', corPolimerase = '#e0527a',
  } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();
  const trajeto = trajetoCajado(escala);
  const segmentos = 260;

  // Envelope: tubo ao longo do trajeto, com as pontas fechadas por esferas
  const fecharPontas = (geo, r) => {
    const inicio = trajeto.getPointAt(0);
    const fim = trajeto.getPointAt(1);
    return mergeGeometries([
      geo,
      new THREE.SphereGeometry(r, 24, 16).translate(inicio.x, inicio.y, inicio.z),
      new THREE.SphereGeometry(r, 24, 16).translate(fim.x, fim.y, fim.z),
    ]);
  };
  const envelope = new THREE.Mesh(
    fecharPontas(new THREE.TubeGeometry(trajeto, segmentos, raio, 24, false), raio),
    new THREE.MeshPhysicalMaterial({ color: cores.primaria, roughness: 0.55, sheen: 1, sheenColor: new THREE.Color(cores.primaria).offsetHSL(0, 0, 0.2), clearcoat: 0.3 })
  );
  grupo.add(marcarParte(envelope, 'envelope'));

  // Glicoproteína GP: trímeros em volta do tubo, posicionados pelos referenciais de Frenet do trajeto
  const { normals, binormals } = trajeto.computeFrenetFrames(segmentos, false);
  const malhaGP = new THREE.InstancedMesh(
    geometriaEspicula(raio * 0.42, raio * 0.17, 3),
    new THREE.MeshPhysicalMaterial({ color: cores.secundaria, roughness: 0.35, clearcoat: 0.6 }),
    espiculas
  );
  const cima = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  const giro = new THREE.Quaternion();
  const matriz = new THREE.Matrix4();
  const escalaInst = new THREE.Vector3();
  const radial = new THREE.Vector3();
  for (let i = 0; i < espiculas; i++) {
    const u = aleatorio();
    const k = Math.min(Math.floor(u * segmentos), segmentos - 1);
    const a = aleatorio() * Math.PI * 2;
    radial.copy(normals[k]).multiplyScalar(Math.cos(a)).addScaledVector(binormals[k], Math.sin(a));
    const posicao = trajeto.getPointAt(u).addScaledVector(radial, raio * 0.97);
    quat.setFromUnitVectors(cima, radial).multiply(giro.setFromAxisAngle(cima, aleatorio() * Math.PI * 2));
    malhaGP.setMatrixAt(i, matriz.compose(posicao, quat, escalaInst.setScalar(0.85 + aleatorio() * 0.3)));
  }
  grupo.add(marcarParte(malhaGP, 'glicoproteina_gp'));

  // Matriz VP40: tubo mais fino, logo abaixo do envelope
  const corM = corMatriz ?? new THREE.Color(cores.primaria).offsetHSL(0, -0.1, -0.12);
  grupo.add(marcarParte(
    new THREE.Mesh(fecharPontas(new THREE.TubeGeometry(trajeto, segmentos, raio * 0.82, 20, false), raio * 0.82), new THREE.MeshStandardMaterial({ color: corM, roughness: 0.7 })),
    'matriz_vp40'
  ));

  // Nucleocapsídeo helicoidal (NP + RNA) e polimerase L, no eixo do filamento
  grupo.add(helicePelaCurva(trajeto, raio, {
    voltas, amplitude: 0.42, espessura: 0.09, polimerases,
    cor: corNucleocapsideo, corRna, corPolimerase,
    chave: 'nucleocapsideo', chaveRna: 'rna', chavePolimerase: 'polimerase',
  }, aleatorio));

  const caixa = new THREE.Box3().setFromObject(envelope);
  const centro = caixa.getCenter(new THREE.Vector3());
  const tamanho = caixa.getSize(new THREE.Vector3());
  const halo = criarHalo(1, { cor: cores.secundaria, intensidade: 0.7, potencia: 2.5 });
  halo.position.copy(centro);
  halo.scale.set(tamanho.x / 2 + 0.15, tamanho.y / 2 + 0.15, Math.max(tamanho.z / 2, raio) + 0.35);
  grupo.add(halo);

  function atualizar(t) {
    grupo.rotation.z = Math.sin(t * 0.4) * 0.05; // balanço lento
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar };
}
