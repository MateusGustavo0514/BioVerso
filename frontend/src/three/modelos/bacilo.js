import * as THREE from 'three';
import { criarAleatorio, deformarComRuido, marcarParte } from '../utils/geometria.js';
import { criarHalo } from '../shaders/fresnel.js';

/** Curva helicoidal paramétrica: o formato de um flagelo bacteriano. */
class Helice extends THREE.Curve {
  constructor(comprimento, amplitude, voltas) {
    super();
    Object.assign(this, { comprimento, amplitude, voltas });
  }
  getPoint(t, alvo = new THREE.Vector3()) {
    const a = this.amplitude * Math.min(t * 4, 1); // começa fino na base
    const angulo = t * this.voltas * Math.PI * 2;
    return alvo.set(-t * this.comprimento, Math.cos(angulo) * a, Math.sin(angulo) * a);
  }
}

/** Bactéria em bastão (bacilo), como a E. coli. Eixo longo no X. */
export function criarBacilo(params, cores) {
  const { comprimento = 2, raio = 0.5, flagelos = 6, pili = 80, semente = 3 } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  // Corpo: cápsula com leve deformação
  const geoCorpo = new THREE.CapsuleGeometry(raio, comprimento, 24, 64);
  geoCorpo.rotateZ(Math.PI / 2);
  const corpo = new THREE.Mesh(
    deformarComRuido(geoCorpo, { amplitude: 0.02, frequencia: 2, semente }),
    new THREE.MeshPhysicalMaterial({
      color: cores.primaria,
      roughness: 0.4,
      clearcoat: 1,
      clearcoatRoughness: 0.25,
      sheen: 0.6,
      sheenColor: new THREE.Color('#ffffff'),
    })
  );
  grupo.add(marcarParte(corpo, 'membrana'));

  // Ponto aleatório na parte cilíndrica da superfície + normal
  const pontoSuperficie = () => {
    const x = (aleatorio() - 0.5) * comprimento;
    const phi = aleatorio() * Math.PI * 2;
    return { x, phi, normal: new THREE.Vector3(0, Math.cos(phi), Math.sin(phi)) };
  };

  // Fímbrias (pili): cilindros finos instanciados, orientados pela normal
  const geoPilus = new THREE.CylinderGeometry(0.006, 0.01, 0.16, 5);
  geoPilus.translate(0, 0.08, 0);
  const matPili = new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.6 });
  const malhaPili = new THREE.InstancedMesh(geoPilus, matPili, pili);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < pili; i++) {
    const { x, normal } = pontoSuperficie();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    m.compose(new THREE.Vector3(x, normal.y * raio, normal.z * raio), q, new THREE.Vector3(1, 0.6 + aleatorio(), 1));
    malhaPili.setMatrixAt(i, m);
  }
  grupo.add(marcarParte(malhaPili, 'pili'));

  // Flagelos: tubo ao longo de uma hélice; o giro no próprio eixo simula a propulsão
  const matFlagelo = new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.5 });
  const giros = [];
  for (let i = 0; i < flagelos; i++) {
    const { x, phi } = pontoSuperficie();
    const pivo = new THREE.Group();
    pivo.position.set(x, 0, 0);
    pivo.rotation.x = phi; // Y local passa a apontar para fora da superfície

    const inclinacao = new THREE.Group();
    inclinacao.position.y = raio * 0.95;
    inclinacao.rotation.z = -0.35 - aleatorio() * 0.3; // aponta para trás e para fora

    const giro = new THREE.Group();
    const curva = new Helice(1.6 + aleatorio() * 0.8, 0.08, 3 + aleatorio() * 1.5);
    const flagelo = new THREE.Mesh(new THREE.TubeGeometry(curva, 160, 0.018, 6), matFlagelo);
    giro.add(marcarParte(flagelo, 'flagelo'));
    giro.userData.velocidade = 8 + aleatorio() * 4;

    inclinacao.add(giro);
    pivo.add(inclinacao);
    grupo.add(pivo);
    giros.push(giro);
  }

  const halo = criarHalo(1, { cor: cores.primaria, intensidade: 0.8, potencia: 2.5 });
  halo.scale.set((comprimento / 2 + raio) + 0.12, raio + 0.12, raio + 0.12);
  grupo.add(halo);

  function atualizar(t) {
    giros.forEach((g) => (g.rotation.x = t * g.userData.velocidade));
    corpo.rotation.x = Math.sin(t * 0.7) * 0.05;
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar };
}
