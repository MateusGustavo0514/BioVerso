import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deformarComRuido, marcarParte, tuboDeRaioVariavel } from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// semieixos do rim (y é o eixo maior); o hilo, onde entram os vasos, fica voltado para -x
const RX = 0.8;
const RY = 1.5;
const RZ = 0.6;
const SEIO = V(-0.15, 0, 0); // centro do seio renal: as pirâmides se abrem em leque a partir daqui
const PELVE = V(-0.36, 0, 0);

// profundidades, em fração da distância do seio até a superfície
const BASE_PIRAMIDE = 0.78; // a faixa de fora (córtex) fica entre a base das pirâmides e a cápsula
const PAPILA = 0.36;

/** Esfera remodelada em rim: elipsoide com uma reentrância profunda na face medial (o hilo). */
function geometriaRim(semente) {
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const medial = Math.max(0, -v.x);
    const reentrancia = Math.exp(-((v.y / 0.4) ** 2)) * Math.exp(-((v.z / 0.55) ** 2));
    v.x *= 1 - 0.72 * reentrancia * medial;
    pos.setXYZ(i, v.x * RX, v.y * RY, v.z * RZ);
  }
  return deformarComRuido(geo, { amplitude: 0.01, frequencia: 2.2, semente });
}

/** Distância de `origem` até a superfície do elipsoide, na direção `d` (unitária): raiz da equação do segundo grau. */
function ateSuperficie(origem, d) {
  const o = V(origem.x / RX, origem.y / RY, origem.z / RZ);
  const k = V(d.x / RX, d.y / RY, d.z / RZ);
  const a = k.dot(k);
  const b = 2 * o.dot(k);
  const c = o.dot(o) - 1;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/**
 * Pirâmide renal: superfície de revolução com a papila arredondada embaixo (y = 0) e a base abaulada
 * em cima (y = 1). As cores por vértice desenham as estrias (os túbulos coletores correndo até a
 * papila) e clareiam a ponta, como no corte real.
 */
function geometriaPiramide() {
  const perfil = [[0, 0], [0.1, 0.015], [0.17, 0.06], [0.24, 0.16], [0.34, 0.36], [0.45, 0.62], [0.52, 0.84], [0.5, 0.96], [0.36, 1.03], [0.18, 1.06], [0, 1.07]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(perfil, 40);
  const pos = geo.attributes.position;
  const cores = new Float32Array(pos.count * 3);
  const escura = new THREE.Color('#7e2a2c');
  const clara = new THREE.Color('#c98272');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const angulo = Math.atan2(pos.getZ(i), pos.getX(i));
    const estria = 0.8 + 0.2 * (0.5 + 0.5 * Math.cos(angulo * 22));
    c.lerpColors(clara, escura, suave(0.05, 0.6, pos.getY(i))).multiplyScalar(estria);
    cores.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  return geo;
}

/** Cálice menor: taça aberta que abraça a papila e afina num gargalo (y = 0 na ponta da papila). */
function geometriaCalice() {
  const perfil = [[0.16, 0.09], [0.15, 0.03], [0.12, -0.03], [0.07, -0.08], [0.045, -0.12], [0.04, -0.16]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(perfil, 28);
}

/** Tubo liso por uma curva Catmull-Rom (vasos, cálices). */
const tubo = (pontos, raio, segmentos = 24) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos), segmentos, raio, 8);

/** Coloca uma geometria de eixo Y com a origem em `ponto`, apontando para `direcao`. */
function orientar(geo, ponto, direcao, escala = V(1, 1, 1)) {
  const m = new THREE.Matrix4().compose(ponto, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), direcao), escala);
  return geo.clone().applyMatrix4(m);
}

/**
 * Rim em corte coronal: córtex (com interior cheio), pirâmides em leque com estrias, cálices menores
 * em taça que se juntam em três cálices maiores e na pelve, ureter com peristaltismo e a árvore de
 * vasos na ordem anatômica: segmentares → interlobares (entre as pirâmides) → arqueadas (na base das
 * pirâmides) → interlobulares (no córtex), com os glomérulos nas pontas.
 */
export function criarRim(params, cores) {
  const { ondasPorMinuto = 4, semente = 7 } = params;
  const grupo = new THREE.Group();

  // cápsula e córtex: cortado, o lado de dentro aparece cheio, na cor do córtex
  const materialCortex = new THREE.MeshPhysicalMaterial({ color: cores.primaria, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: '#ff9a82' });
  materialCortex.userData.interiorCheio = '#c46f5e';
  grupo.add(marcarParte(new THREE.Mesh(geometriaRim(semente), materialCortex), 'cortex_renal'));

  // pirâmides: sete no plano frontal (um corte de frente passa pelo meio delas) e quatro na frente e atrás
  const leque = [-115, -78, -40, 0, 40, 78, 115].map((g) => ({ angulo: THREE.MathUtils.degToRad(g), z: 0 }));
  const fora = [[-60, 0.62], [60, 0.62], [-60, -0.62], [60, -0.62]].map(([g, z]) => ({ angulo: THREE.MathUtils.degToRad(g), z }));
  const geoPiramide = geometriaPiramide();
  const materialPiramide = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  materialPiramide.userData.interiorCheio = true;
  const geoCalice = geometriaCalice();
  const materialVias = new THREE.MeshPhysicalMaterial({ color: cores.secundaria, roughness: 0.4, clearcoat: 0.5 });
  materialVias.userData.interiorCheio = '#efdcac';

  // os três cálices maiores (superior, médio, inferior) desembocam na pelve
  const maiores = [V(-0.2, 0.46, 0), V(-0.02, 0, 0), V(-0.2, -0.46, 0)];
  const pecasCalices = [];
  const piramides = [...leque, ...fora].map(({ angulo, z }) => {
    const d = V(Math.cos(angulo), Math.sin(angulo), z).normalize();
    const distancia = ateSuperficie(SEIO, d);
    const papila = SEIO.clone().addScaledVector(d, distancia * PAPILA);
    const altura = distancia * (BASE_PIRAMIDE - PAPILA);
    const largura = Math.min(0.62, distancia * 0.42);
    const malha = new THREE.Mesh(orientar(geoPiramide, papila, d, V(largura, altura, largura * 0.8)), materialPiramide);
    grupo.add(marcarParte(malha, 'medula_renal'));

    // cálice menor na papila e o gargalo até o cálice maior mais próximo
    pecasCalices.push(orientar(geoCalice, papila, d));
    const gargalo = papila.clone().addScaledVector(d, -0.15);
    const alvo = angulo > 0.5 ? maiores[0] : angulo < -0.5 ? maiores[2] : maiores[1];
    pecasCalices.push(tubo([gargalo, gargalo.clone().lerp(alvo, 0.5).addScaledVector(d, -0.04), alvo], 0.038, 16));
    return { angulo, d, distancia, z };
  });
  maiores.forEach((ponta) => pecasCalices.push(tubo([ponta, ponta.clone().lerp(PELVE, 0.5).add(V(0, 0, 0)), PELVE], 0.058, 16)));
  const pelve = new THREE.SphereGeometry(1, 32, 24).scale(0.16, 0.26, 0.11).translate(PELVE.x, PELVE.y, PELVE.z);
  pecasCalices.push(pelve);
  grupo.add(marcarParte(new THREE.Mesh(mergeGeometries(pecasCalices.map((g) => g.toNonIndexed())), materialVias), 'calices_e_pelve'));

  // ureter: tubo de raio variável saindo da pelve pelo hilo; a onda de contração desce por ele
  const caminhoUreter = new THREE.CatmullRomCurve3([PELVE.clone().add(V(0, -0.15, 0)), V(-0.46, -0.4, 0.0), V(-0.6, -0.8, 0.04), V(-0.5, -1.3, 0.05), V(-0.3, -1.95, 0.08)]);
  const omega = ondasPorMinuto / 60;
  const ureter = tuboDeRaioVariavel(caminhoUreter, {
    raio: (u, t) => {
      const fase = ((t * omega * 4) % 1.3) - 0.15;
      const aperto = 1 - 0.38 * Math.exp(-((u - fase) ** 2) / (2 * 0.05 ** 2));
      return 0.055 * aperto * (1 - suave(0.97, 1, u));
    },
    segmentos: 90, lados: 16,
  });
  const materialUreter = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(cores.secundaria).offsetHSL(0, 0.05, -0.1), roughness: 0.45, clearcoat: 0.4 });
  materialUreter.userData.interiorCheio = true;
  grupo.add(marcarParte(new THREE.Mesh(ureter.geometria, materialUreter), 'ureter'));

  // vasos no plano frontal, entre as pirâmides do leque. A veia corre ao lado da artéria, um pouco à frente.
  const noLeque = piramides.filter((p) => p.z === 0);
  const pontoA = (angulo, fracao) => {
    const d = V(Math.cos(angulo), Math.sin(angulo), 0);
    return SEIO.clone().addScaledVector(d, ateSuperficie(SEIO, d) * fracao);
  };
  const glomerulos = [];
  const arvore = (dz, comGlomerulos) => {
    const pecas = [];
    const hilo = V(-0.32, 0.1, dz);
    const desloca = (p) => p.setZ(p.z + dz);
    for (let k = 0; k < noLeque.length - 1; k++) {
      const meio = (noLeque[k].angulo + noLeque[k + 1].angulo) / 2;
      // interlobar: do hilo, pela coluna entre duas pirâmides, até a altura da base delas
      const interlobar = [hilo, desloca(pontoA(meio, 0.2)), desloca(pontoA(meio, 0.5)), desloca(pontoA(meio, BASE_PIRAMIDE + 0.02))];
      pecas.push(tubo(interlobar, 0.024));
      // arqueadas: curvam sobre a base das duas pirâmides vizinhas
      for (const vizinha of [noLeque[k].angulo, noLeque[k + 1].angulo]) {
        const arco = Array.from({ length: 6 }, (_, i) => desloca(pontoA(meio + ((vizinha - meio) * i) / 5 * 0.9, BASE_PIRAMIDE + 0.03)));
        pecas.push(tubo(arco, 0.016));
        // interlobulares: sobem pelo córtex e terminam nos glomérulos
        for (const fracao of [0.35, 0.8]) {
          const angulo = meio + (vizinha - meio) * 0.9 * fracao;
          const de = desloca(pontoA(angulo, BASE_PIRAMIDE + 0.03));
          const ate = desloca(pontoA(angulo, 0.95));
          pecas.push(tubo([de, de.clone().lerp(ate, 0.5), ate], 0.008, 8));
          if (comGlomerulos) glomerulos.push(de.clone().lerp(ate, 0.55), ate.clone());
        }
      }
    }
    return mergeGeometries(pecas);
  };
  const vaso = (cor) => {
    const m = new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.4, clearcoat: 0.5 });
    m.userData.interiorCheio = true;
    return m;
  };
  const materialArteria = vaso('#d6403a');
  const materialVeia = vaso('#3a4fa8');
  grupo.add(marcarParte(new THREE.Mesh(arvore(-0.035, true), materialArteria), 'arteria_renal'));
  grupo.add(marcarParte(new THREE.Mesh(arvore(0.045, false), materialVeia), 'veia_renal'));
  // troncos: a artéria vem da aorta, a veia vai para a veia cava (fora do rim, pelo hilo)
  grupo.add(marcarParte(new THREE.Mesh(tubo([V(-1.5, 0.42, -0.06), V(-0.9, 0.24, -0.05), V(-0.32, 0.1, -0.035)], 0.06), materialArteria), 'arteria_renal'));
  grupo.add(marcarParte(new THREE.Mesh(tubo([V(-1.5, 0.3, 0.09), V(-0.9, 0.18, 0.07), V(-0.32, 0.1, 0.045)], 0.08), materialVeia), 'veia_renal'));

  const malhaGlomerulos = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 12, 10), new THREE.MeshStandardMaterial({ color: '#c9374a', roughness: 0.45 }), glomerulos.length);
  const m = new THREE.Matrix4();
  glomerulos.forEach((p, i) => malhaGlomerulos.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  grupo.add(marcarParte(malhaGlomerulos, 'glomerulos'));

  // glândula suprarrenal: "chapéu" sobre o polo superior
  const suprarrenal = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshPhysicalMaterial({ color: '#e0a948', roughness: 0.55, clearcoat: 0.3 }));
  suprarrenal.material.userData.interiorCheio = '#d99a45';
  suprarrenal.scale.set(0.36, 0.11, 0.26);
  suprarrenal.position.set(-0.12, RY * 0.96, 0.0);
  suprarrenal.rotation.z = 0.35;
  grupo.add(marcarParte(suprarrenal, 'suprarrenal'));

  function atualizar(t) {
    ureter.atualizar(t);
  }

  return { objeto: grupo, atualizar };
}
