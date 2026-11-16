import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, marcarParte, curvaNovelo } from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// Bloco de pele visto em corte: a superfície está em y = 0 e as camadas descem em -y
const LARGURA = 3.0;
const PROFUNDIDADE = 1.5;
const ESPESSURA = { epiderme: 0.14, derme: 0.8, hipoderme: 1.0 };
const Y_DERME = -ESPESSURA.epiderme;
const Y_HIPODERME = Y_DERME - ESPESSURA.derme;
const Y_FUNDO = Y_HIPODERME - ESPESSURA.hipoderme;

/** Tubo com as duas pontas fechadas por esferas. */
function tuboFechado(pontos, raio, segmentos = 40, lados = 8) {
  const curva = pontos instanceof THREE.Curve ? pontos : new THREE.CatmullRomCurve3(pontos);
  const ponta = (p) => new THREE.SphereGeometry(raio, lados, Math.ceil(lados / 2)).translate(p.x, p.y, p.z);
  return mergeGeometries([new THREE.TubeGeometry(curva, segmentos, raio, lados), ponta(curva.getPoint(0)), ponta(curva.getPoint(1))]);
}

/**
 * Camada de pele: um bloco translúcido (dá para ver as estruturas por dentro). A epiderme tem o
 * relevo da superfície: sulcos finos por ruído em crista, que somem nas bordas para não abrir
 * fendas entre o topo e as laterais.
 */
function geometriaCamada(topo, altura, relevo, ruido) {
  const geo = new THREE.BoxGeometry(LARGURA, altura, PROFUNDIDADE, relevo ? 72 : 1, 1, relevo ? 36 : 1);
  geo.translate(0, topo - altura / 2, 0);
  if (relevo) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < topo - 1e-5) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const borda = suave(0, 0.18, Math.min(LARGURA / 2 - Math.abs(x), PROFUNDIDADE / 2 - Math.abs(z)));
      const sulco = (1 - Math.abs(ruido(x * 3.2, z * 3.2, 0))) ** 7; // linhas finas, como as dobras da pele
      const ondulado = ruido(x * 1.5, z * 1.5, 4) * 0.012;
      pos.setY(i, topo - 0.028 * sulco * borda + ondulado * borda);
    }
    geo.computeVertexNormals();
  }
  return geo;
}

export function criarPele(params, cores) {
  const { semente = 3, adipocitos = 70 } = params;
  const aleatorio = criarAleatorio(semente);
  const ruido = createNoise3D(criarAleatorio(semente + 9));
  const grupo = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  const base = new THREE.Color(cores.primaria);
  const camada = (cor, opacidade) =>
    new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.45, clearcoat: 0.25, transparent: true, opacity: opacidade, depthWrite: false });
  grupo.add(marcarParte(new THREE.Mesh(geometriaCamada(0, ESPESSURA.epiderme, true, ruido), camada(base, 0.92)), 'epiderme'));
  grupo.add(marcarParte(new THREE.Mesh(geometriaCamada(Y_DERME, ESPESSURA.derme, false, ruido), camada(base.clone().offsetHSL(-0.015, 0.22, -0.02), 0.58)), 'derme'));
  grupo.add(marcarParte(new THREE.Mesh(geometriaCamada(Y_HIPODERME, ESPESSURA.hipoderme, false, ruido), camada('#f6d45e', 0.5)), 'hipoderme'));

  const solido = (cor, rugosidade = 0.5) => new THREE.MeshStandardMaterial({ color: cor, roughness: rugosidade });
  const malha = (geometria, cor, chave, rugosidade) => grupo.add(marcarParte(new THREE.Mesh(geometria, solido(cor, rugosidade)), chave));

  // pelos: haste fora da pele, bainha do folículo e bulbo na base, com glândula sebácea e músculo eretor
  const foliculos = [{ x: -0.75, z: 0.05, inclina: 0.14 }, { x: 0.95, z: 0.0, inclina: -0.12 }];
  for (const { x, z, inclina } of foliculos) {
    const ponto = (s) => V(x + inclina * s, -s * 1.05, z); // s = 0 na superfície, 1 no bulbo
    malha(tuboFechado([ponto(0), ponto(0.5), ponto(1)], 0.05, 24, 10), '#d8c49a', 'foliculo_piloso', 0.6);
    malha(tuboFechado([ponto(1), ponto(0.5), ponto(0), V(x - inclina * 1.2, 0.35, z), V(x - inclina * 3.5, 0.78, z)], 0.02, 40, 6), '#3b2a20', 'foliculo_piloso', 0.4);
    const bulbo = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 14), solido('#d8c49a', 0.6));
    bulbo.position.copy(ponto(1)).add(V(0, -0.04, 0));
    grupo.add(marcarParte(bulbo, 'foliculo_piloso'));
    const papila = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), solido('#c0392b'));
    papila.position.copy(ponto(1)).add(V(0, 0.01, 0));
    grupo.add(marcarParte(papila, 'foliculo_piloso'));

    // glândula sebácea: cacho de lóbulos ao lado do folículo, com um ducto até ele
    const centroSebacea = ponto(0.3).add(V(0.2, 0, 0.02));
    const lobulos = [[0, 0, 0, 0.08], [0.09, 0.07, 0.03, 0.065], [0.08, -0.08, -0.03, 0.065], [-0.02, 0.1, -0.05, 0.055]].map(([dx, dy, dz, r]) =>
      new THREE.SphereGeometry(r, 14, 10).translate(centroSebacea.x + dx, centroSebacea.y + dy, centroSebacea.z + dz));
    malha(mergeGeometries([...lobulos, tuboFechado([centroSebacea, ponto(0.25)], 0.016, 8, 6)]), '#f1d56a', 'glandula_sebacea', 0.5);

    // músculo eretor: do folículo até a derme superficial, do lado oposto à sebácea
    malha(tuboFechado([ponto(0.55), ponto(0.35).add(V(-0.28, 0, 0.02)), V(x - 0.62, -0.2, z)], 0.028, 24, 8), '#b4504a', 'musculo_eretor', 0.55);
  }

  // glândula sudorípara: novelo de tubo na derme profunda e um ducto que sobe em espiral até o poro
  const xs = 0.15;
  const zs = -0.2;
  const novelo = curvaNovelo({ raioMin: 0.04, raioMax: 0.16, pontos: 16, aleatorio, escala: V(1, 0.9, 1) });
  novelo.points.forEach((p) => p.add(V(xs, Y_HIPODERME - 0.12, zs)));
  malha(tuboFechado(novelo, 0.028, 120, 8), '#9cc7d6', 'glandula_sudoripara', 0.4);
  const ducto = [];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    const fase = Math.PI * 2 * (1.2 * s + 4 * Math.max(0, s - 0.85)); // dá voltas dentro da epiderme
    ducto.push(V(xs + 0.05 * Math.sin(fase), (Y_HIPODERME - 0.05) * (1 - s), zs + 0.05 * Math.cos(fase)));
  }
  ducto[ducto.length - 1].set(xs, 0.005, zs);
  malha(tuboFechado(ducto, 0.02, 80, 6), '#9cc7d6', 'glandula_sudoripara', 0.4);

  // vasos: troncos na hipoderme, plexo na derme profunda e alças capilares até perto da epiderme
  const circuitos = []; // curvas por onde as hemácias andam: { curva, cor }
  const vaso = (pontos, raio, cor, fluxo = 0) => {
    const curva = new THREE.CatmullRomCurve3(pontos);
    malha(tuboFechado(curva, raio, 60, 8), cor, 'vasos_sanguineos', 0.4);
    if (fluxo) circuitos.push({ curva, quantidade: fluxo, raio: Math.max(raio * 0.7, 0.01) });
    return curva;
  };
  const ARTERIA = '#d6403a';
  const VEIA = '#33449a';
  vaso([V(-1.55, -1.5, 0.35), V(0, -1.56, 0.3), V(1.55, -1.5, 0.35)], 0.055, ARTERIA, 12);
  vaso([V(1.55, -1.65, 0.1), V(0, -1.62, 0.12), V(-1.55, -1.66, 0.08)], 0.07, VEIA, 12);
  vaso([V(0.5, -1.53, 0.33), V(0.52, -1.2, 0.32), V(0.5, -0.9, 0.3)], 0.032, ARTERIA, 4);
  vaso([V(-0.55, -0.9, 0.3), V(-0.55, -1.2, 0.1), V(-0.55, -1.62, 0.12)], 0.036, VEIA, 4);
  vaso([V(-1.55, -0.88, 0.3), V(0, -0.85, 0.3), V(1.55, -0.88, 0.3)], 0.026, ARTERIA, 8);
  vaso([V(1.55, -0.78, -0.15), V(0, -0.8, -0.15), V(-1.55, -0.78, -0.15)], 0.03, VEIA, 8);
  for (let k = 0; k < 9; k++) {
    const x = -1.25 + k * 0.31 + (aleatorio() - 0.5) * 0.08;
    const z = -0.1 + aleatorio() * 0.35;
    vaso([V(x, -0.86, 0.3), V(x, -0.5, z), V(x + 0.02, -0.2, z), V(x + 0.07, -0.19, z), V(x + 0.09, -0.5, z), V(x + 0.09, -0.79, -0.15)], 0.011, k % 2 ? '#c4423c' : '#5a4aa0', 3);
  }

  // hemácias: esferas instanciadas que andam pelas curvas dos vasos (o fluxo de sangue)
  const total = circuitos.reduce((n, c) => n + c.quantidade, 0);
  const hemacias = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), solido('#c0222e', 0.35), total);
  grupo.add(marcarParte(hemacias, 'vasos_sanguineos'));
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  function moverHemacias(t) {
    let i = 0;
    circuitos.forEach(({ curva, quantidade, raio }, c) => {
      for (let k = 0; k < quantidade; k++) {
        curva.getPointAt((k / quantidade + t * 0.05 * (1 + (c % 3) * 0.2)) % 1, p);
        hemacias.setMatrixAt(i++, m.makeScale(raio, raio, raio).setPosition(p));
      }
    });
    hemacias.instanceMatrix.needsUpdate = true;
  }
  moverHemacias(0);

  // nervo na hipoderme com ramos que sobem até os receptores: Meissner (toque leve, perto da
  // superfície), Pacini (pressão, fundo, em "casca de cebola") e terminações livres na epiderme
  const nervo = (pontos, raio) => malha(tuboFechado(pontos, raio, 40, 6), '#f1d46a', 'nervos_e_receptores', 0.5);
  nervo([V(-1.55, -1.3, -0.45), V(0, -1.32, -0.42), V(1.55, -1.3, -0.45)], 0.032);
  for (const x of [-0.4, 0.55]) {
    nervo([V(x, -1.31, -0.42), V(x + 0.05, -0.8, -0.35), V(x, -0.28, -0.2)], 0.016);
    const meissner = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), solido('#f3a14f', 0.5));
    meissner.scale.set(0.05, 0.085, 0.05);
    meissner.position.set(x, -0.2, -0.2);
    grupo.add(marcarParte(meissner, 'nervos_e_receptores'));
  }
  nervo([V(-0.1, -1.31, -0.42), V(-0.12, -0.7, -0.3), V(-0.1, -0.12, -0.28), V(-0.1, -0.02, -0.28)], 0.008);
  nervo([V(1.3, -1.3, -0.45), V(1.28, -0.7, -0.3), V(1.3, -0.1, -0.3), V(1.3, -0.02, -0.3)], 0.008);
  nervo([V(0.95, -1.31, -0.42), V(0.9, -1.38, -0.38)], 0.016);
  const pacini = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const camadaPacini = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshPhysicalMaterial({ color: '#e8c27a', roughness: 0.4, transparent: true, opacity: 0.35 + k * 0.15, depthWrite: false })
    );
    camadaPacini.scale.set(0.075 - k * 0.015, 0.14 - k * 0.028, 0.075 - k * 0.015);
    pacini.add(camadaPacini);
  }
  pacini.position.set(0.9, -1.42, -0.37);
  pacini.children.forEach((c) => marcarParte(c, 'nervos_e_receptores'));
  grupo.add(pacini);

  // adipócitos: esferas translúcidas na hipoderme, sem se sobreporem
  const gordura = [];
  for (let tentativas = 0; gordura.length < adipocitos && tentativas < adipocitos * 60; tentativas++) {
    const ponto = V((aleatorio() * 2 - 1) * (LARGURA / 2 - 0.15), Y_FUNDO + 0.13 + aleatorio() * (Y_HIPODERME - Y_FUNDO - 0.26), (aleatorio() * 2 - 1) * (PROFUNDIDADE / 2 - 0.15));
    if (gordura.some((o) => o.distanceToSquared(ponto) < 0.17 * 0.17)) continue;
    if (ponto.y > -1.3 && ponto.y < -1.0 && Math.abs(ponto.z + 0.4) < 0.15) continue; // deixa livre o caminho do nervo
    gordura.push(ponto);
  }
  const celulasGordura = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.075, 16, 12),
    new THREE.MeshPhysicalMaterial({ color: '#f7e08a', roughness: 0.3, clearcoat: 0.6, transparent: true, opacity: 0.6, depthWrite: false }),
    gordura.length
  );
  gordura.forEach((g, i) => celulasGordura.setMatrixAt(i, m.makeScale(1, 1, 1).setPosition(g)));
  grupo.add(marcarParte(celulasGordura, 'adipocitos'));

  function atualizar(t) {
    moverHemacias(t);
  }

  return { objeto: grupo, atualizar };
}
