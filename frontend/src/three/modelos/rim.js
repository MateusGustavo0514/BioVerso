import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  criarAleatorio, deformarComRuido, marcarParte, virarParaDentro, cilindroEntre,
  arvoreRamificada, geometriaDosRamos, tuboDeRaioVariavel,
} from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// semieixos do rim (y é o eixo maior); o hilo, onde entram os vasos, fica voltado para -x
const RX = 0.8;
const RY = 1.5;
const RZ = 0.6;
const FORRO = 0.86; // tamanho do revestimento interno do córtex em relação à superfície

/** Distância do centro à superfície do elipsoide, na direção `d` (vetor unitário). */
const raioNaDirecao = (d) => 1 / Math.sqrt((d.x / RX) ** 2 + (d.y / RY) ** 2 + (d.z / RZ) ** 2);

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
  return deformarComRuido(geo, { amplitude: 0.012, frequencia: 2.2, semente });
}

/**
 * Rim em corte anatômico: córtex por fora e por dentro (revestimento virado do avesso), pirâmides
 * da medula distribuídas em hemisfério e apontadas para a pelve, cálices que ligam cada papila à
 * pelve, glomérulos instanciados no córtex, artéria e veia que se ramificam dentro do órgão e um
 * ureter com onda de contração (peristaltismo).
 */
export function criarRim(params, cores) {
  const { piramides = 9, glomerulos = 420, ondasPorMinuto = 4, semente = 7 } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  const geoCortex = geometriaRim(semente);
  const corCortex = new THREE.Color(cores.primaria);
  grupo.add(marcarParte(new THREE.Mesh(geoCortex, new THREE.MeshPhysicalMaterial({ color: corCortex, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: '#ff9a82' })), 'cortex_renal'));

  // revestimento: o córtex visto por dentro
  const forro = virarParaDentro(geoCortex.clone());
  forro.scale(FORRO, FORRO, FORRO);
  const materialForro = new THREE.MeshStandardMaterial({ color: corCortex.clone().offsetHSL(0.01, -0.02, 0.1), roughness: 0.7, side: THREE.FrontSide });
  materialForro.userData.manterLado = true;
  grupo.add(marcarParte(new THREE.Mesh(forro, materialForro), 'cortex_renal'));

  // pirâmides renais: cones com a ponta (papila) voltada para a pelve, em hemisfério lateral
  const centroSeio = new THREE.Vector3(-0.1, 0, 0);
  const pelve = new THREE.Vector3(-0.24, 0, 0);
  const direcoes = Array.from({ length: piramides }, (_, i) => {
    const x = 1 - (i + 0.5) / piramides; // ao longo do eixo do hemisfério (+x = lateral)
    const r = Math.sqrt(1 - x * x);
    const fi = i * Math.PI * (3 - Math.sqrt(5));
    return new THREE.Vector3(x * 0.8 + 0.1, r * Math.cos(fi) * 1.7, r * Math.sin(fi)).normalize();
  });
  const geoPiramide = new THREE.ConeGeometry(1, 1, 7, 1);
  const malhaPiramides = new THREE.InstancedMesh(geoPiramide, new THREE.MeshStandardMaterial({ color: '#8c2f2c', roughness: 0.6 }), piramides);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const calices = [];
  direcoes.forEach((d, i) => {
    const L = raioNaDirecao(d);
    const base = L * 0.8; // a base encosta no córtex
    const ponta = L * 0.3;
    const altura = base - ponta;
    const largura = Math.min(0.22, 0.1 + 0.4 * altura * 0.25);
    const centro = centroSeio.clone().addScaledVector(d, (base + ponta) / 2);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate());
    m.compose(centro, q, new THREE.Vector3(largura * 1.2, altura, largura * 1.2));
    malhaPiramides.setMatrixAt(i, m);
    // cálice menor: da papila até a pelve
    calices.push(cilindroEntre(centroSeio.clone().addScaledVector(d, ponta), pelve, 0.04, 0.03, 8));
  });
  grupo.add(marcarParte(malhaPiramides, 'medula_renal'));

  const materialVia = new THREE.MeshPhysicalMaterial({ color: cores.secundaria, roughness: 0.4, clearcoat: 0.5 });
  grupo.add(marcarParte(new THREE.Mesh(mergeGeometries(calices), materialVia), 'calices_e_pelve'));
  const pelveMalha = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), materialVia);
  pelveMalha.scale.set(0.12, 0.2, 0.11);
  pelveMalha.position.copy(pelve);
  grupo.add(marcarParte(pelveMalha, 'calices_e_pelve'));

  // glomérulos: esferas no córtex (entre o revestimento e a superfície), fora da reentrância do hilo
  const pontos = [];
  while (pontos.length < glomerulos) {
    const d = new THREE.Vector3(aleatorio() * 2 - 1, aleatorio() * 2 - 1, aleatorio() * 2 - 1);
    if (d.lengthSq() > 1 || d.lengthSq() < 0.05) continue;
    d.normalize();
    if (d.x < -0.3) continue;
    pontos.push(d.multiplyScalar(raioNaDirecao(d) * (FORRO + 0.02 + aleatorio() * (0.94 - FORRO - 0.02))));
  }
  const malhaGlomerulos = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.028, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#c9374a', roughness: 0.45 }),
    pontos.length
  );
  pontos.forEach((p, i) => malhaGlomerulos.setMatrixAt(i, m.makeScale(1, 1, 1).setPosition(p)));
  grupo.add(marcarParte(malhaGlomerulos, 'glomerulos'));

  // ureter: tubo de raio variável saindo da pelve pelo hilo; a onda de contração desce por ele
  const caminhoUreter = new THREE.CatmullRomCurve3([
    pelve.clone(),
    new THREE.Vector3(-0.38, -0.28, 0.0),
    new THREE.Vector3(-0.58, -0.75, 0.04),
    new THREE.Vector3(-0.5, -1.3, 0.05),
    new THREE.Vector3(-0.3, -1.95, 0.08),
  ]);
  const omega = ondasPorMinuto / 60;
  const ureter = tuboDeRaioVariavel(caminhoUreter, {
    raio: (u, t) => {
      const fase = ((t * omega * 4) % 1.3) - 0.15;
      const aperto = 1 - 0.38 * Math.exp(-((u - fase) ** 2) / (2 * 0.05 ** 2));
      return 0.05 * aperto * (1 - suave(0.97, 1, u));
    },
    segmentos: 90, lados: 16,
  });
  grupo.add(marcarParte(new THREE.Mesh(ureter.geometria, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(cores.secundaria).offsetHSL(0, 0.05, -0.1), roughness: 0.45, clearcoat: 0.4 })), 'ureter'));

  // vasos: tronco fora do rim e árvore recursiva dentro dele. Veia à frente, artéria atrás.
  const dentro = (p) => (p.x / (RX * FORRO * 0.95)) ** 2 + (p.y / (RY * FORRO * 0.95)) ** 2 + (p.z / (RZ * FORRO * 0.95)) ** 2 < 1;
  const materialVaso = (cor) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.4, clearcoat: 0.5 });
  const frente = new THREE.Vector3(0, 0, 1);
  const vasos = [
    ['veia_renal', '#33449a', 0.12, 0.085, 1],
    ['arteria_renal', '#d6403a', -0.1, 0.065, -1],
  ];
  for (const [chave, cor, zHilo, raio, sinal] of vasos) {
    const hilo = new THREE.Vector3(-0.3, 0.22, zHilo);
    const tronco = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.5, 0.45, zHilo * 1.4), new THREE.Vector3(-0.85, 0.3, zHilo * 1.1), hilo]);
    grupo.add(marcarParte(new THREE.Mesh(new THREE.TubeGeometry(tronco, 32, raio, 12), materialVaso(cor)), chave));
    const ramos = [];
    for (const direcao of [new THREE.Vector3(1, 0.7, 0.2 * sinal), new THREE.Vector3(1, -0.2, 0.25 * sinal)]) {
      arvoreRamificada({ inicio: hilo, direcao: direcao.normalize(), comprimento: 0.38, raio: raio * 0.62, profundidade: 3, dentro, aleatorio, ramos, abertura: 0.6, reducaoComprimento: 0.8 });
    }
    if (ramos.length) {
      const deslocamento = (ramo) => {
        const d = ramo.fim.clone().sub(ramo.inicio).normalize();
        return frente.clone().addScaledVector(d, -frente.dot(d)).normalize().multiplyScalar(sinal * 0.03);
      };
      grupo.add(marcarParte(new THREE.Mesh(geometriaDosRamos(ramos, { lados: 8, deslocamento }), materialVaso(cor)), chave));
    }
  }

  // glândula suprarrenal: "chapéu" sobre o polo superior
  const suprarrenal = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.MeshPhysicalMaterial({ color: '#e0a948', roughness: 0.55, clearcoat: 0.3 })
  );
  suprarrenal.scale.set(0.36, 0.11, 0.26);
  suprarrenal.position.set(-0.12, RY * 0.96, 0.0);
  suprarrenal.rotation.z = 0.35;
  grupo.add(marcarParte(suprarrenal, 'suprarrenal'));

  function atualizar(t) {
    ureter.atualizar(t);
  }

  return { objeto: grupo, atualizar };
}
