import * as THREE from 'three';
import { criarAleatorio, marcarParte, tuboDeRaioVariavel, fatiarTubo } from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// cores do corte: osso compacto (marfim), osso esponjoso com medula vermelha e medula amarela
const COMPACTO = '#e9dcc0';
const ESPONJOSO = '#c98676';

/** Material de osso; cortado, o interior aparece cheio na cor do tecido daquela região. */
const materialOsso = (cor, interior) => {
  const m = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.72 });
  m.userData.interiorCheio = interior;
  return m;
};

/**
 * Fêmur: a haste (diáfise) é um tubo de raio variável sobre um eixo levemente arqueado, com as duas
 * pontas alargadas (metáfises). Cabeça, colo, trocânter e côndilos são peças separadas, cada uma clicável.
 * Cortado, mostra o que um atlas mostra: a parede de osso compacto em anel em volta do canal medular
 * (medula amarela) e, nas extremidades, o osso esponjoso: uma treliça de trabéculas sobre a medula
 * vermelha, separada pela linha epifisária.
 */
export function criarOsso(params, cores) {
  const { semente = 5 } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  // eixo da haste, de baixo (distal, joelho) para cima (proximal, quadril)
  const eixo = new THREE.CatmullRomCurve3([V(0.1, -2.0, 0), V(0.06, -1.0, 0.06), V(0.0, 0.0, 0.1), V(-0.06, 1.0, 0.06), V(-0.1, 1.65, 0)]);
  const RAIO_HASTE = 0.2;
  const raioHaste = (u) => {
    const aberto = RAIO_HASTE + 0.3 * (1 - suave(0, 0.22, u)) + 0.07 * suave(0.78, 0.95, u);
    if (u < 0.03) return aberto * Math.sqrt(Math.max(0, 1 - ((0.03 - u) / 0.03) ** 2));
    if (u > 0.94) return aberto * Math.sqrt(Math.max(0, 1 - ((u - 0.94) / 0.06) ** 2));
    return aberto;
  };
  // linha áspera: uma crista na face de trás da haste
  const crista = (u, a) => 1 + 0.07 * Math.exp(-(((a - Math.PI) / 0.45) ** 2)) * suave(0.25, 0.4, u) * (1 - suave(0.7, 0.85, u));
  const haste = tuboDeRaioVariavel(eixo, { raio: raioHaste, modulacao: crista, segmentos: 120, lados: 40 });
  // três trechos da mesma superfície: metáfise de baixo, diáfise e metáfise de cima, cada um com o seu interior
  const [geoDistal, geoMeio, geoProximal] = fatiarTubo(haste, [0, 0.2, 0.84, 1]);
  grupo.add(
    marcarParte(new THREE.Mesh(geoDistal, materialOsso(cores.primaria, ESPONJOSO)), 'diafise'),
    marcarParte(new THREE.Mesh(geoMeio, materialOsso(cores.primaria, COMPACTO)), 'diafise'),
    marcarParte(new THREE.Mesh(geoProximal, materialOsso(cores.primaria, ESPONJOSO)), 'diafise')
  );

  // canal medular: cilindro maciço de medula amarela no meio da haste (fecha nas duas pontas)
  const medula = tuboDeRaioVariavel(eixo, {
    raio: (u) => RAIO_HASTE * 0.55 * suave(0.2, 0.27, u) * (1 - suave(0.76, 0.83, u)),
    segmentos: 120, lados: 24,
  });
  const materialMedula = new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.65 });
  materialMedula.userData.interiorCheio = true;
  grupo.add(marcarParte(new THREE.Mesh(medula.geometria, materialMedula), 'canal_medular'));

  // cabeça, colo e trocânter maior (o quadril fica à esquerda da tela)
  const base = V(-0.18, 1.5, 0.02);
  const centroCabeca = V(-0.82, 1.98, 0.02);
  const eixoColo = centroCabeca.clone().sub(base).normalize();
  const RAIO_CABECA = 0.37;
  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(RAIO_CABECA, 48, 36), materialOsso(cores.primaria, ESPONJOSO));
  cabeca.position.copy(centroCabeca);
  grupo.add(marcarParte(cabeca, 'cabeca_femoral'));

  const colo = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([base, V(-0.45, 1.75, 0.02), centroCabeca.clone().lerp(base, 0.12)]), 24, 0.17, 20),
    materialOsso(cores.primaria, ESPONJOSO)
  );
  grupo.add(marcarParte(colo, 'colo_femoral'));

  const trocanter = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), materialOsso(cores.primaria, ESPONJOSO));
  trocanter.scale.set(0.2, 0.34, 0.24);
  trocanter.position.set(0.1, 1.72, -0.02);
  grupo.add(marcarParte(trocanter, 'trocanter_maior'));

  // côndilos medial e lateral
  const condilos = [[-0.17, -2.05, 0.04], [0.37, -2.05, 0.04]].map(([x, y, z]) => {
    const malha = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), materialOsso(cores.primaria, ESPONJOSO));
    malha.scale.set(0.28, 0.33, 0.4);
    malha.position.set(x, y, z);
    grupo.add(marcarParte(malha, 'condilos'));
    return malha;
  });

  // cartilagem articular: calotas finas e translúcidas sobre a cabeça e na base dos côndilos
  const materialCartilagem = new THREE.MeshPhysicalMaterial({ color: '#cfe6ee', roughness: 0.2, clearcoat: 0.8, transparent: true, opacity: 0.82 });
  const calotaCabeca = new THREE.Mesh(new THREE.SphereGeometry(RAIO_CABECA * 1.025, 48, 24, 0, Math.PI * 2, 0, 1.9), materialCartilagem);
  calotaCabeca.position.copy(centroCabeca);
  calotaCabeca.quaternion.setFromUnitVectors(V(0, 1, 0), eixoColo);
  grupo.add(marcarParte(calotaCabeca, 'cartilagem_articular'));
  for (const c of condilos) {
    const cal = new THREE.Mesh(new THREE.SphereGeometry(1.03, 36, 20, 0, Math.PI * 2, Math.PI - 1.9, 1.9), materialCartilagem);
    cal.scale.copy(c.scale);
    cal.position.copy(c.position);
    grupo.add(marcarParte(cal, 'cartilagem_articular'));
  }

  // linhas epifisárias: discos finos e claros onde ficava a cartilagem de crescimento
  const materialLinha = new THREE.MeshStandardMaterial({ color: '#f6f1e6', roughness: 0.5 });
  materialLinha.userData.interiorCheio = true;
  const disco = (centro, normal, raio) => {
    const malha = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio, 0.016, 40), materialLinha);
    malha.position.copy(centro);
    malha.quaternion.setFromUnitVectors(V(0, 1, 0), normal);
    grupo.add(marcarParte(malha, 'linha_epifisaria'));
  };
  disco(eixo.getPointAt(0.12), eixo.getTangentAt(0.12), raioHaste(0.12) * 0.95);
  disco(centroCabeca.clone().addScaledVector(eixoColo, -0.2), eixoColo, 0.3);

  // osso esponjoso: treliça de trabéculas. Pontos de uma grade, deslocados ao acaso, ligados aos vizinhos;
  // só nas regiões de osso esponjoso (cabeça, colo, trocânter, côndilos e metáfises)
  const dentroDoElipsoide = (p, centro, escala, folga) =>
    ((p.x - centro.x) / escala.x) ** 2 + ((p.y - centro.y) / escala.y) ** 2 + ((p.z - centro.z) / escala.z) ** 2 < folga * folga;
  const ateColo = (p) => {
    const t = Math.min(Math.max(p.clone().sub(base).dot(eixoColo) / centroCabeca.distanceTo(base), 0), 1);
    return p.distanceTo(base.clone().lerp(centroCabeca, t));
  };
  const centroDaHaste = new THREE.Vector3();
  const esponjoso = (p) => {
    if (p.distanceTo(centroCabeca) < RAIO_CABECA * 0.84) return true;
    if (ateColo(p) < 0.12) return true;
    if (dentroDoElipsoide(p, trocanter.position, trocanter.scale, 0.8)) return true;
    if (condilos.some((c) => dentroDoElipsoide(p, c.position, c.scale, 0.84))) return true;
    const u = (p.y + 2) / 3.65;
    if (u < 0 || u > 1 || (u > 0.2 && u < 0.84)) return false;
    eixo.getPointAt(u, centroDaHaste);
    return Math.hypot(p.x - centroDaHaste.x, p.z - centroDaHaste.z) < raioHaste(u) * 0.82;
  };
  const PASSO = 0.075;
  const grade = new Map();
  const chave = (i, j, k) => `${i},${j},${k}`;
  for (let i = 0; i < 27; i++) {
    for (let j = 0; j < 66; j++) {
      for (let k = 0; k < 14; k++) {
        const p = V(-1.25 + i * PASSO, -2.45 + j * PASSO, -0.5 + k * PASSO).add(V(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).multiplyScalar(PASSO * 0.55));
        if (esponjoso(p)) grade.set(chave(i, j, k), p);
      }
    }
  }
  const barras = [];
  for (const [nome, p] of grade) {
    const [i, j, k] = nome.split(',').map(Number);
    for (const [di, dj, dk] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const vizinho = grade.get(chave(i + di, j + dj, k + dk));
      if (vizinho && aleatorio() < 0.72) barras.push([p, vizinho]); // algumas ligações faltam: fica com cara de esponja
    }
  }
  const trabeculas = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.011, 0.011, 1, 5),
    new THREE.MeshStandardMaterial({ color: '#efe4cc', roughness: 0.75 }),
    barras.length
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const meio = new THREE.Vector3();
  const direcao = new THREE.Vector3();
  barras.forEach(([a, b], i) => {
    direcao.subVectors(b, a);
    q.setFromUnitVectors(V(0, 1, 0), direcao.clone().normalize());
    trabeculas.setMatrixAt(i, m.compose(meio.addVectors(a, b).multiplyScalar(0.5), q, V(1, direcao.length(), 1)));
  });
  grupo.add(marcarParte(trabeculas, 'osso_esponjoso'));

  return { objeto: grupo, atualizar() {} };
}
