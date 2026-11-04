import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, curvaNovelo, esferasInstanciadas, marcarParte } from '../utils/geometria.js';
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

/** Anel de DNA levemente irregular, numa orientação sorteada. */
function geometriaPlasmideo(raio, centro, aleatorio) {
  const pontos = Array.from({ length: 12 }, (_, i) => {
    const angulo = (i / 12) * Math.PI * 2;
    const r = raio * (0.85 + aleatorio() * 0.3);
    return new THREE.Vector3(Math.cos(angulo) * r, Math.sin(angulo) * r, (aleatorio() - 0.5) * raio * 0.5);
  });
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos, true), 80, raio * 0.13, 6, true);
  geo.rotateX((aleatorio() - 0.5) * 0.9); // inclinação leve: o anel continua legível de frente
  geo.rotateY((aleatorio() - 0.5) * 0.9);
  return geo.translate(centro.x, centro.y, centro.z);
}

/** Interior da célula, visível com o corte: membrana plasmática, nucleoide, plasmídeos e ribossomos. */
function criarInterior({ comprimento, raio, ribossomos, plasmideos, corMembrana, corDna, corRibossomo, corPlasmideo, aleatorio }) {
  const interior = new THREE.Group();
  const raioMembrana = raio * 0.88;

  const geoMembrana = new THREE.CapsuleGeometry(raioMembrana, comprimento, 16, 48);
  geoMembrana.rotateZ(Math.PI / 2);
  const membrana = new THREE.Mesh(geoMembrana, new THREE.MeshPhysicalMaterial({ color: corMembrana, roughness: 0.5 }));
  interior.add(marcarParte(membrana, 'membrana_plasmatica'));

  // Nucleoide: cromossomo circular, compactado e esticado ao longo do eixo da célula
  const raioNucleoide = raio * 0.6;
  const escala = new THREE.Vector3((comprimento / 2 + raio * 0.4) / raioNucleoide, 1, 1);
  const curvaDna = curvaNovelo({ raioMin: raio * 0.2, raioMax: raioNucleoide, pontos: 140, aleatorio, escala, fechada: true });
  curvaDna.arcLengthDivisions = 2000; // o padrão (200) achataria as dobras
  const cromossomo = new THREE.Mesh(
    new THREE.TubeGeometry(curvaDna, 2200, raio * 0.03, 6, true),
    new THREE.MeshPhysicalMaterial({ color: corDna, roughness: 0.35, clearcoat: 0.5 })
  );
  interior.add(marcarParte(cromossomo, 'cromossomo'));

  // Ponto sorteado no citoplasma: dentro da cápsula e fora do miolo do nucleoide
  const limite = raioMembrana * 0.92;
  const pontoCitoplasma = () => {
    for (;;) {
      const x = (aleatorio() - 0.5) * (comprimento + limite * 2);
      const y = (aleatorio() - 0.5) * limite * 2;
      const z = (aleatorio() - 0.5) * limite * 2;
      const dentroDaCapsula = Math.hypot(Math.max(Math.abs(x) - comprimento / 2, 0), y, z) < limite;
      const noNucleoide = (x / (comprimento / 2)) ** 2 + (y * y + z * z) / (raio * 0.3) ** 2 < 1;
      if (dentroDaCapsula && !noNucleoide) return new THREE.Vector3(x, y, z);
    }
  };

  // Plasmídeos alternados nos dois lados do nucleoide, no plano do eixo: o corte central os alcança
  const aneis = Array.from({ length: plasmideos }, (_, i) => {
    const x = (((i + 0.5) / plasmideos) * 2 - 1) * comprimento * 0.55;
    const y = (i % 2 ? 1 : -1) * raioMembrana * 0.62;
    return geometriaPlasmideo(raio * 0.22, new THREE.Vector3(x, y, 0), aleatorio);
  });
  const plasmideo = new THREE.Mesh(
    mergeGeometries(aneis),
    new THREE.MeshPhysicalMaterial({ color: corPlasmideo, roughness: 0.35, clearcoat: 0.5 })
  );
  interior.add(marcarParte(plasmideo, 'plasmideo'));

  const posicoes = Array.from({ length: ribossomos }, pontoCitoplasma);
  interior.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.04, corRibossomo, aleatorio, 8), 'ribossomos'));
  return interior;
}

/** Bactéria em bastão (bacilo), como a E. coli. Eixo longo no X. */
export function criarBacilo(params, cores) {
  const {
    comprimento = 2, raio = 0.5, flagelos = 6, pili = 80, semente = 3,
    ribossomos = 900, plasmideos = 3, corDna = '#f0c75e', corRibossomo = '#6a5acd', corPlasmideo = '#ff9d5c',
  } = params;
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

  const interior = criarInterior({
    comprimento, raio, ribossomos, plasmideos, corDna, corRibossomo, corPlasmideo, aleatorio,
    corMembrana: new THREE.Color(cores.primaria).offsetHSL(0, -0.1, 0.2),
  });
  grupo.add(interior);

  const halo = criarHalo(1, { cor: cores.primaria, intensidade: 0.8, potencia: 2.5 });
  halo.scale.set((comprimento / 2 + raio) + 0.12, raio + 0.12, raio + 0.12);
  grupo.add(halo);

  function atualizar(t) {
    giros.forEach((g) => (g.rotation.x = t * g.userData.velocidade));
    corpo.rotation.x = Math.sin(t * 0.7) * 0.05;
    interior.rotation.x = corpo.rotation.x; // o conteúdo acompanha o envoltório
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar, foco: corpo };
}
