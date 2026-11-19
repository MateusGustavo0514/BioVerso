import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deformarComRuido, marcarParte, dividirPorPlano, tuboDeRaioVariavel } from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

const COMPRIMENTO = 1.75; // semieixo em x (o lobo direito do paciente fica à esquerda da tela)
const ALTURA = 0.95;
const PROFUNDIDADE = 0.95;
const X_SULCO = 0.55; // onde o ligamento falciforme divide os dois lobos

/**
 * Fígado: esfera remodelada vértice a vértice (lobo direito grande, lobo esquerdo que afina
 * em cunha, face de baixo achatada e côncava, sulco do ligamento falciforme). Cada vértice
 * ganha uma cor mais clara e quente onde o órgão é fino, uma aproximação barata do
 * espalhamento subsuperficial da luz na carne.
 */
function geometriaFigado(semente) {
  const geo = new THREE.SphereGeometry(1, 128, 96);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let { x, y, z } = v;
    const afinar = suave(0, 1, x); // 0 no lobo direito, 1 na ponta do esquerdo
    y *= 1 - 0.62 * afinar;
    z *= 1 - 0.35 * afinar;
    if (y < 0) y *= 0.5; // face inferior achatada
    x *= COMPRIMENTO;
    y *= ALTURA;
    z *= PROFUNDIDADE;
    y -= 0.12 * afinar; // o lobo esquerdo desce um pouco
    // sulco do ligamento falciforme, na face da frente
    z -= 0.14 * Math.exp(-(((x - X_SULCO) / 0.09) ** 2)) * suave(0.1, 0.5, z);
    // concavidade da face de baixo, onde entram os vasos (hilo hepático)
    if (y < 0) y += 0.14 * Math.exp(-(((x + 0.15) / 0.4) ** 2)) * Math.exp(-((z / 0.5) ** 2));
    pos.setXYZ(i, x, y, z);
  }
  const forma = deformarComRuido(geo, { amplitude: 0.014, frequencia: 1.6, semente });

  // espalhamento subsuperficial falso: mais claro e avermelhado nas bordas finas
  const n = forma.attributes.normal;
  const p = forma.attributes.position;
  const cores = new Float32Array(p.count * 3);
  const escuro = new THREE.Color('#7e2f27');
  const claro = new THREE.Color('#c9694f');
  const cor = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const borda = 1 - Math.abs(n.getY(i)); // normal horizontal = borda do órgão
    const ponta = suave(0.3, 1.6, p.getX(i));
    cor.lerpColors(escuro, claro, Math.min(1, borda * 0.75 + ponta * 0.4));
    cores.set([cor.r, cor.g, cor.b], i * 3);
  }
  forma.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  return forma;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Faixa do ligamento falciforme: deitada na superfície real do fígado, ao longo do sulco entre os lobos,
 * da margem da frente por cima até o alto. É uma grade fina (algumas colunas na largura, muitas linhas ao
 * longo do sulco). Cada vértice é achado por um raio contra a malha do fígado, então a faixa cola na
 * superfície de verdade (com o sulco, com o ruído, com a margem fina) sem deixar vão. A folga mínima é
 * dada na direção do raio, não pela normal do triângulo (que o ruído deixaria irregular).
 */
function geometriaLigamento(figadoGeo) {
  const malha = new THREE.Mesh(figadoGeo, new THREE.MeshBasicMaterial());
  const raio = new THREE.Raycaster();
  const LARGURA = 4; // colunas na largura da faixa
  const [G0, G1] = [-15, 95]; // da margem da frente, por cima, até o alto (sem passar para as costas)
  const colunas = [];
  for (let g = G0; g <= G1; g += 3) {
    const a = THREE.MathUtils.degToRad(g);
    const dir = V(0, Math.sin(a), Math.cos(a)); // fora → dentro: da frente (0°) ao alto (90°)
    const meiaLargura = 0.05 * (0.45 + 0.55 * Math.sin(Math.PI * ((g - G0) / (G1 - G0)))); // afina nas pontas
    const linha = [];
    let completa = true;
    for (let i = 0; i <= LARGURA; i++) {
      const x = X_SULCO + (i / LARGURA - 0.5) * 2 * meiaLargura;
      raio.set(V(x, 0, 0).addScaledVector(dir, 4), dir.clone().negate());
      const acerto = raio.intersectObject(malha)[0];
      if (!acerto) { completa = false; break; }
      linha.push(acerto.point.addScaledVector(dir, 0.012)); // encostada na superfície, com uma folga mínima
    }
    if (completa) colunas.push(linha);
  }
  const vertices = [];
  for (let c = 0; c < colunas.length - 1; c++) {
    for (let i = 0; i < LARGURA; i++) {
      const [a0, a1, b0, b1] = [colunas[c][i], colunas[c][i + 1], colunas[c + 1][i], colunas[c + 1][i + 1]];
      vertices.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints(vertices);
  geo.computeVertexNormals();
  return geo;
}

/** Vaso que afina ao longo de uma curva suave, com uma esfera na origem para a junção com o ramo de onde sai. */
function tuboAfinado(pontos, r0, r1) {
  const curva = new THREE.CatmullRomCurve3(pontos);
  const { geometria } = tuboDeRaioVariavel(curva, { raio: (u) => r0 + (r1 - r0) * u, segmentos: 6 * pontos.length, lados: 10 });
  const junta = new THREE.SphereGeometry(r0 * 1.02, 10, 8).translate(pontos[0].x, pontos[0].y, pontos[0].z);
  junta.deleteAttribute('uv');
  return [geometria, junta];
}

/** Um sistema de vasos: lista de ramos { pontos, r0, r1 }, deslocados e afinados por igual (para a tríade portal). */
function sistemaDeVasos(ramos, { deslocamento = V(0, 0, 0), escala = 1 } = {}) {
  const pecas = ramos.flatMap(({ pontos, r0, r1 }) => tuboAfinado(pontos.map((p) => p.clone().add(deslocamento)), r0 * escala, r1 * escala));
  return mergeGeometries(pecas.map((g) => g.toNonIndexed()));
}

// Veia porta: entra pelo hilo, na face de baixo, e se divide em ramo direito e esquerdo, cada um com
// os seus ramos segmentares. Fica quase toda no plano frontal: um corte de frente mostra a árvore.
const HILO = V(-0.1, -0.32, 0.12);
const PORTA_DIREITA = V(-0.55, -0.12, 0.05);
const PORTA_ESQUERDA = V(0.45, -0.12, 0.05);
const RAMOS_PORTA = [
  { pontos: [HILO, V(-0.32, -0.25, 0.08), PORTA_DIREITA], r0: 0.085, r1: 0.075 },
  { pontos: [HILO, V(0.18, -0.24, 0.08), PORTA_ESQUERDA], r0: 0.075, r1: 0.065 },
  // ramo direito anterior e posterior, com dois ramos cada
  { pontos: [PORTA_DIREITA, V(-0.8, 0.0, 0.14), V(-1.0, 0.15, 0.22)], r0: 0.06, r1: 0.045 },
  { pontos: [V(-1.0, 0.15, 0.22), V(-1.15, 0.27, 0.27), V(-1.3, 0.36, 0.3)], r0: 0.04, r1: 0.022 },
  { pontos: [V(-1.0, 0.15, 0.22), V(-1.2, 0.05, 0.3), V(-1.38, -0.04, 0.33)], r0: 0.04, r1: 0.022 },
  { pontos: [PORTA_DIREITA, V(-0.82, -0.1, -0.12), V(-1.05, -0.05, -0.25)], r0: 0.06, r1: 0.045 },
  { pontos: [V(-1.05, -0.05, -0.25), V(-1.25, 0.06, -0.28), V(-1.45, 0.14, -0.3)], r0: 0.04, r1: 0.022 },
  { pontos: [V(-1.05, -0.05, -0.25), V(-1.2, -0.13, -0.2), V(-1.32, -0.2, -0.14)], r0: 0.04, r1: 0.022 },
  { pontos: [PORTA_DIREITA, V(-0.6, 0.12, 0.02), V(-0.6, 0.3, 0.0)], r0: 0.045, r1: 0.028 },
  // ramo esquerdo: segue para o lobo esquerdo e manda um ramo para cima (segmento IV)
  { pontos: [PORTA_ESQUERDA, V(0.72, -0.06, 0.05), V(0.95, 0.0, 0.05)], r0: 0.055, r1: 0.042 },
  { pontos: [V(0.95, 0.0, 0.05), V(1.15, 0.01, 0.05), V(1.35, 0.02, 0.05)], r0: 0.035, r1: 0.02 },
  { pontos: [V(0.95, 0.0, 0.05), V(1.0, 0.1, 0.0), V(1.05, 0.18, -0.05)], r0: 0.032, r1: 0.02 },
  { pontos: [PORTA_ESQUERDA, V(0.52, 0.12, 0.08), V(0.58, 0.32, 0.1)], r0: 0.04, r1: 0.025 },
];

// Veias hepáticas: três troncos (direita, média e esquerda) que descem da veia cava, atrás e no alto
const CAVA = V(0, 0.62, -0.8);
const RAMOS_HEPATICAS = [
  { pontos: [CAVA, V(-0.7, 0.42, -0.45), V(-1.3, 0.15, -0.15)], r0: 0.07, r1: 0.03 },
  { pontos: [V(-0.7, 0.42, -0.45), V(-0.85, 0.52, -0.35), V(-1.0, 0.55, -0.3)], r0: 0.035, r1: 0.02 },
  { pontos: [CAVA, V(-0.1, 0.35, -0.25), V(-0.2, 0.05, 0.3)], r0: 0.06, r1: 0.025 },
  { pontos: [V(-0.1, 0.35, -0.25), V(0.08, 0.33, -0.05), V(0.25, 0.3, 0.15)], r0: 0.032, r1: 0.018 },
  { pontos: [CAVA, V(0.55, 0.4, -0.4), V(1.1, 0.12, -0.1)], r0: 0.055, r1: 0.025 },
];

/**
 * Lóbulos hepáticos em favo: até 19 prismas hexagonais encaixados (dois anéis em volta de um central),
 * com a veia central no meio de cada um e as tríades portais (artéria, veia porta e ducto biliar) nos
 * cantos. Os prismas correm na profundidade (eixo Z): um corte de frente mostra os hexágonos.
 * `cabe(ponto)` diz se um ponto está dentro do fígado: lóbulo que encostaria na superfície fica de fora.
 */
function criarFavoDeLobulos(centro, cabe) {
  const grupo = new THREE.Group();
  const R = 0.085; // raio do hexágono
  const PROFUNDIDADE_FAVO = 0.3;
  const forma = new THREE.Shape();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3; // hexágono com ponta para cima
    const x = Math.cos(a) * R * 0.95;
    const y = Math.sin(a) * R * 0.95;
    if (k === 0) forma.moveTo(x, y);
    else forma.lineTo(x, y);
  }
  const prisma = new THREE.ExtrudeGeometry(forma, { depth: PROFUNDIDADE_FAVO, bevelEnabled: false }).translate(0, 0, -PROFUNDIDADE_FAVO / 2);
  // cantos do prisma (nas duas faces): todos precisam caber dentro do órgão
  const cantosDoPrisma = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    for (const z of [-PROFUNDIDADE_FAVO / 2, PROFUNDIDADE_FAVO / 2]) cantosDoPrisma.push(V(Math.cos(a) * R, Math.sin(a) * R, z));
  }
  const celulas = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue;
      const c = V(R * Math.sqrt(3) * (q + r / 2), R * 1.5 * r, 0).add(centro);
      if (cantosDoPrisma.every((canto) => cabe(canto.clone().add(c)))) celulas.push(c);
    }
  }
  const materialPrisma = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
  materialPrisma.userData.interiorCheio = true;
  const prismas = new THREE.InstancedMesh(prisma, materialPrisma, celulas.length);
  const tons = ['#d68a6b', '#cf7f61', '#dc977a'];
  const m = new THREE.Matrix4();
  celulas.forEach((c, i) => {
    prismas.setMatrixAt(i, m.makeTranslation(c.x, c.y, c.z));
    prismas.setColorAt(i, new THREE.Color(tons[i % 3]));
  });
  grupo.add(marcarParte(prismas, 'lobulos'));

  // cilindros na profundidade: a veia central e os três vasos de cada tríade
  const cilindro = (raio) => new THREE.CylinderGeometry(raio, raio, PROFUNDIDADE_FAVO + 0.03, 8).rotateX(Math.PI / 2);
  const instancias = (geometria, cor, pontos) => {
    const material = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.45 });
    material.userData.interiorCheio = true;
    const malha = new THREE.InstancedMesh(geometria, material, pontos.length);
    pontos.forEach((p, i) => malha.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    return marcarParte(malha, 'lobulos');
  };
  grupo.add(instancias(cilindro(0.02), '#3a4fa8', celulas));

  // tríades nos cantos, sem repetir os cantos que dois ou três hexágonos vizinhos compartilham
  const cantos = new Map();
  for (const c of celulas) {
    for (const k of [0, 2, 4]) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      const p = V(c.x + Math.cos(a) * R, c.y + Math.sin(a) * R, c.z);
      cantos.set(`${p.x.toFixed(3)},${p.y.toFixed(3)}`, p);
    }
  }
  const pontos = [...cantos.values()];
  grupo.add(
    instancias(cilindro(0.014), '#8a63c9', pontos.map((p) => p.clone().add(V(-0.016, -0.008, 0)))),
    instancias(cilindro(0.009), '#d6403a', pontos.map((p) => p.clone().add(V(0.016, -0.008, 0)))),
    instancias(cilindro(0.009), '#7ea34a', pontos.map((p) => p.clone().add(V(0, 0.017, 0))))
  );
  return grupo;
}

export function criarFigado(params, cores) {
  const { semente = 11, respiracoesPorMinuto = 14 } = params;
  const grupo = new THREE.Group();

  // lobos: cortado, o fígado mostra o parênquima cheio (é um órgão maciço), não uma casca
  const figado = geometriaFigado(semente);
  const material = () => {
    const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: '#ff9a82' });
    m.userData.interiorCheio = '#b2563f';
    return m;
  };
  const [geoEsquerdo, geoDireito] = dividirPorPlano(figado, new THREE.Vector3(1, 0, 0), X_SULCO);
  grupo.add(marcarParte(new THREE.Mesh(geoDireito, material()), 'lobo_direito'));
  grupo.add(marcarParte(new THREE.Mesh(geoEsquerdo, material()), 'lobo_esquerdo'));

  // favo de lóbulos no lobo direito, no alto e para o lado, longe dos vasos
  // (dentro do lobo direito, com folga da superfície; os lóbulos que não couberem inteiros são descartados)
  const cabe = (p) => {
    const x = p.x / COMPRIMENTO;
    const e = suave(0, 1, x);
    const ay = ALTURA * (1 - 0.62 * e) * (p.y > 0 ? 1 : 0.5);
    const az = PROFUNDIDADE * (1 - 0.35 * e);
    return x * x + (p.y / ay) ** 2 + (p.z / az) ** 2 < 0.78;
  };
  grupo.add(criarFavoDeLobulos(V(-1.0, 0.16, 0), cabe));

  // vasos. Porta, artéria e ducto correm juntos (tríade portal); as veias hepáticas vêm de cima, atrás.
  const materialVaso = (cor) => {
    const m = new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.4, clearcoat: 0.5 });
    m.userData.interiorCheio = true;
    return m;
  };
  grupo.add(marcarParte(new THREE.Mesh(sistemaDeVasos(RAMOS_PORTA), materialVaso('#8a63c9')), 'veia_porta'));
  grupo.add(marcarParte(new THREE.Mesh(sistemaDeVasos(RAMOS_PORTA, { deslocamento: V(0, 0.05, 0.045), escala: 0.38 }), materialVaso('#d6403a')), 'arteria_hepatica'));
  grupo.add(marcarParte(new THREE.Mesh(sistemaDeVasos(RAMOS_PORTA, { deslocamento: V(0, -0.05, 0.045), escala: 0.42 }), materialVaso('#7ea34a')), 'ductos_biliares'));
  grupo.add(marcarParte(new THREE.Mesh(sistemaDeVasos(RAMOS_HEPATICAS), materialVaso('#2f3f8f')), 'veias_hepaticas'));

  // fora do órgão: veia cava inferior (atrás), tronco da veia porta, artéria e colédoco
  const tubo = (pontos, raio, cor, chave) => {
    const malha = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos), 40, raio, 12), materialVaso(cor));
    grupo.add(marcarParte(malha, chave));
    return malha;
  };
  tubo([V(0.0, 1.25, -0.88), V(0.0, 0.62, -0.84), V(0.0, -0.2, -0.88), V(0.0, -0.8, -0.8)], 0.09, '#2f3f8f', 'veias_hepaticas');
  const junta = V(-0.05, -0.65, 0.3);
  tubo([V(0.45, -1.25, 0.55), V(0.2, -0.85, 0.35), HILO], 0.085, '#8a63c9', 'veia_porta');
  tubo([V(0.6, -1.2, 0.35), V(0.3, -0.8, 0.25), HILO.clone().add(V(0, 0.05, 0.045))], 0.032, '#d6403a', 'arteria_hepatica');
  tubo([HILO.clone().add(V(0, -0.05, 0.045)), junta, V(0.15, -1.0, 0.3), V(0.3, -1.3, 0.35)], 0.036, '#7ea34a', 'ductos_biliares');

  // vesícula biliar (pera) sob o lobo direito, cheia de bile, e o ducto cístico até o colédoco
  const materialVesicula = new THREE.MeshPhysicalMaterial({ color: cores.secundaria, roughness: 0.35, clearcoat: 0.7 });
  materialVesicula.userData.interiorCheio = '#4f7a30';
  const vesicula = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), materialVesicula);
  vesicula.scale.set(0.17, 0.4, 0.17);
  vesicula.position.set(-0.7, -0.5, 0.42);
  vesicula.rotation.z = -1.0;
  grupo.add(marcarParte(vesicula, 'vesicula_biliar'));
  tubo([V(-0.58, -0.68, 0.42), V(-0.35, -0.7, 0.38), junta], 0.03, '#7ea34a', 'ductos_biliares');

  // ligamento falciforme: crista fina que acompanha a superfície do fígado no sulco entre os lobos.
  // A base de cada ponto fica sobre a própria malha (achada por raio), e a borda livre sobe um pouco
  // pela normal: assim a membrana nunca atravessa nem fura a superfície curva.
  grupo.add(marcarParte(new THREE.Mesh(geometriaLigamento(figado), new THREE.MeshStandardMaterial({ color: '#e4c7a6', roughness: 0.7, side: THREE.DoubleSide })), 'ligamento_falciforme'));

  // o diafragma sobe e desce com a respiração e leva o fígado junto
  const omega = (respiracoesPorMinuto / 60) * Math.PI * 2;
  function atualizar(t) {
    const r = (Math.sin(t * omega) + 1) / 2;
    grupo.scale.set(1, 1 + 0.025 * r, 1);
    grupo.position.y = -0.03 * r;
  }

  // o Visualizador reposiciona o objeto raiz ao centralizar o modelo: a animação fica no grupo de dentro
  return { objeto: new THREE.Group().add(grupo), atualizar };
}
