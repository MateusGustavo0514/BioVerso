import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { criarAleatorio, marcarParte, virarParaDentro, dividirPorRegiao, tuboDeRaioVariavel } from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A frente do encéfalo aponta para -x, o alto para +y, e os hemisférios ficam em z = ±
const RX = 1.35;
const RY = 0.95;
const RZ = 0.62;
const MEDIAL = 0.06; // metade da fissura entre os hemisférios
const INSET = 0.17; // espessura do córtex (cinzenta) acima da substância branca

/** Esfera remodelada em hemisfério: base achatada, polo frontal estreito, lobo temporal abaulado e face medial plana. */
function formaDoHemisferio(lado) {
  const geo = new THREE.SphereGeometry(1, 160, 120);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let { x, y } = v;
    let lateral = v.z * lado; // > 0 do lado de fora, < 0 do lado da fissura
    if (lateral < 0) lateral *= 0.08;
    const temporal = Math.exp(-(((x - 0.05) / 0.5) ** 2) - (((y + 0.6) / 0.3) ** 2));
    if (y < 0) y *= 0.62;
    y *= 1 - 0.1 * suave(0, 1, -x); // frontal um pouco mais baixo
    lateral *= (1 - 0.2 * suave(0, 1, -x) - 0.12 * suave(0.3, 1, x)) * (1 + 0.14 * temporal);
    pos.setXYZ(i, x * RX, y * RY - 0.05 * temporal, lado * (MEDIAL + lateral * RZ));
  }
  geo.deleteAttribute('uv');
  const liso = mergeVertices(geo);
  liso.computeVertexNormals();
  return liso;
}

/**
 * Cada hemisfério tem três superfícies: o córtex (por fora), com os sulcos, e a substância branca, uma
 * cópia encolhida e virada do avesso. Os sulcos vêm de ruído em crista, (1 - |ruído|)^7, que dá
 * linhas estreitas e fundas em volta de giros largos; a fissura lateral e o sulco central são
 * fendas explícitas.
 */
function criarHemisferio(lado, semente) {
  const geo = formaDoHemisferio(lado);
  const miolo = geo.clone();
  {
    const pos = miolo.attributes.position;
    const nor = miolo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) - nor.getX(i) * INSET, pos.getY(i) - nor.getY(i) * INSET, pos.getZ(i) - nor.getZ(i) * INSET);
    }
    miolo.computeVertexNormals();
    virarParaDentro(miolo);
  }

  const ruido = createNoise3D(criarAleatorio(semente));
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const profundidades = new Float32Array(pos.count); // quanto cada vértice afundou: serve para escurecer as fendas
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const n1 = ruido(p.x * 2.1, p.y * 2.1, p.z * 2.1);
    const n2 = ruido(p.x * 4.6 + 11, p.y * 4.6, p.z * 4.6);
    const afastamento = Math.abs(p.z) - MEDIAL; // distância ao plano da fissura: a face medial fica lisa
    let fundura = (0.09 * (1 - Math.abs(n1)) ** 7 + 0.045 * (1 - Math.abs(n2)) ** 7) * suave(0.04, 0.3, afastamento);
    const lateral = suave(0.15, 0.45, afastamento);
    const yLateral = -0.05 + 0.12 * (p.x + 0.2); // a fissura lateral sobe um pouco para trás
    fundura += 0.15 * Math.exp(-((p.y - yLateral) ** 2) / (2 * 0.03 ** 2)) * lateral * suave(-0.75, -0.4, p.x) * (1 - suave(0.55, 0.8, p.x));
    const xCentral = -0.05 + 0.18 * p.y; // o sulco central desce inclinado pelo alto
    fundura += 0.11 * Math.exp(-((p.x - xCentral) ** 2) / (2 * 0.025 ** 2)) * suave(0.1, 0.5, p.y) * suave(0.02, 0.2, afastamento);
    fundura = Math.min(fundura, INSET * 0.7); // nunca chega à substância branca
    profundidades[i] = fundura;
    p.addScaledVector(n, -fundura);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  // a face medial do córtex é aberta: o corte pelo meio mostra o interior (corpo caloso, tálamo, ventrículos)
  const aberto = dividirPorRegiao(geo, 2, (c) => (Math.abs(c.z) > MEDIAL + 0.02 ? 0 : 1))[0];
  return { geo: aberto, miolo, profundidades };
}

/** Os quatro lobos pela posição: temporal (abaixo da fissura lateral), occipital, frontal e parietal. */
function lobo(c) {
  const abaixo = c.y < -0.12 + 0.12 * (c.x + 0.2);
  if (abaixo && c.x > -0.55 && c.x < 0.65) return 2;
  if (c.x > 0.7) return 3;
  return c.x < 0 ? 0 : 1;
}

/**
 * Cor por vértice: cada vértice recebe o tom do seu lobo (com as divisas entortadas por ruído, para
 * não ficarem retas) e depois a cor é suavizada várias vezes pela média dos vizinhos da malha,
 * o que borra as divisas em vez de deixar blocos de cor.
 */
function colorirLobos(geo, tons, classificar, profundidades) {
  const pos = geo.attributes.position;
  const total = pos.count;
  let cor = new Float32Array(total * 3);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < total; i++) {
    c.set(tons[classificar(p.fromBufferAttribute(pos, i))]);
    cor.set([c.r, c.g, c.b], i * 3);
  }
  const vizinhos = Array.from({ length: total }, () => new Set());
  const indices = geo.index.array;
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      vizinhos[indices[t + k]].add(indices[t + (k + 1) % 3]);
      vizinhos[indices[t + k]].add(indices[t + (k + 2) % 3]);
    }
  }
  const lista = vizinhos.map((v) => Array.from(v));
  for (let passo = 0; passo < 22; passo++) {
    const novo = new Float32Array(cor.length);
    for (let i = 0; i < total; i++) {
      let r = cor[i * 3], g = cor[i * 3 + 1], b = cor[i * 3 + 2];
      for (const j of lista[i]) { r += cor[j * 3]; g += cor[j * 3 + 1]; b += cor[j * 3 + 2]; }
      const n = lista[i].length + 1;
      novo.set([r / n, g / n, b / n], i * 3);
    }
    cor = novo;
  }
  // fendas mais escuras (oclusão ambiente falsa): os sulcos aparecem mesmo com luz difusa
  for (let i = 0; i < total; i++) {
    const f = 1 - 0.55 * Math.min(1, profundidades[i] / 0.07);
    cor[i * 3] *= f;
    cor[i * 3 + 1] *= f;
    cor[i * 3 + 2] *= f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cor, 3));
}

/** Cerebelo: elipsoide com lâminas horizontais (folhas) por seno em y, perturbado por ruído. */
function criarCerebelo(ruido) {
  const geo = new THREE.SphereGeometry(1, 120, 80);
  geo.scale(0.55, 0.3, 0.7);
  geo.deleteAttribute('uv');
  const liso = mergeVertices(geo);
  liso.computeVertexNormals();
  const pos = liso.attributes.position;
  const nor = liso.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const folha = 0.5 + 0.5 * Math.sin(pos.getY(i) * 75 + 2.2 * ruido(pos.getX(i) * 2, pos.getZ(i) * 2, 1));
    const d = 0.022 * folha;
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * d, pos.getY(i) + nor.getY(i) * d, pos.getZ(i) + nor.getZ(i) * d);
  }
  liso.computeVertexNormals();
  liso.translate(0.82, -0.62, 0);
  return liso;
}

/** Pontos com shader próprio: cada sinapse pisca no seu ritmo. Aceita o corte (inclui os trechos de clipping do Three.js). */
function materialSinapses(cor) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTempo: { value: 0 }, uCor: { value: new THREE.Color(cor) }, uDestaque: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aFase;
      attribute float aTamanho;
      uniform float uTempo;
      uniform float uDestaque;
      varying float vBrilho;
      #include <clipping_planes_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float pisca = 0.5 + 0.5 * sin(uTempo * (1.2 + aFase * 0.9) + aFase * 6.2831);
        vBrilho = pisca * pisca * pisca;
        gl_PointSize = aTamanho * (1.0 + 0.8 * uDestaque) * 26.0 / -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCor;
      uniform float uDestaque;
      varying float vBrilho;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float alfa = smoothstep(0.5, 0.0, d) * (0.12 + 0.88 * max(vBrilho, uDestaque));
        gl_FragColor = vec4(uCor, alfa);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    clipping: true,
  });
  material.userData.recortavel = true;
  return material;
}

export function criarCerebro(params, cores) {
  const { semente = 21, sinapses = 1800 } = params;
  const aleatorio = criarAleatorio(semente);
  const ruido = createNoise3D(criarAleatorio(semente + 5));
  const grupo = new THREE.Group();
  const standard = (cor, rugosidade = 0.6) => new THREE.MeshStandardMaterial({ color: cor, roughness: rugosidade });
  const translucido = (cor, opacidade) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.2, clearcoat: 0.7, transparent: true, opacity: opacidade, depthWrite: false });

  // lobos: cada um com um tom suave, para dar para distingui-los
  const coresLobos = ['#e3a9a9', '#e2bf93', '#c9a9cb', '#aec7b4'];
  const divisas = createNoise3D(criarAleatorio(semente + 2));
  const classificar = (p) => lobo(V(p.x + 0.12 * divisas(p.y * 2, p.z * 2, 3), p.y + 0.08 * divisas(p.x * 2, p.z * 2, 7), p.z));
  const chavesLobos = ['lobo_frontal', 'lobo_parietal', 'lobo_temporal', 'lobo_occipital'];
  const superficies = []; // para raycast e amostragem
  const materialMiolo = standard(cores.secundaria, 0.7);
  materialMiolo.side = THREE.FrontSide;
  materialMiolo.userData.manterLado = true;
  for (const lado of [-1, 1]) {
    const { geo, miolo, profundidades } = criarHemisferio(lado, semente + (lado > 0 ? 7 : 0));
    superficies.push({ geo, lado });
    colorirLobos(geo, coresLobos, classificar, profundidades);
    dividirPorRegiao(geo, 4, classificar).forEach((parte, k) => {
      const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.5, sheenColor: '#ffd9dc' });
      grupo.add(marcarParte(new THREE.Mesh(parte, material), chavesLobos[k]));
    });
    grupo.add(marcarParte(new THREE.Mesh(miolo, materialMiolo), 'substancia_branca'));
  }

  // cerebelo e tronco encefálico
  grupo.add(marcarParte(new THREE.Mesh(criarCerebelo(ruido), new THREE.MeshPhysicalMaterial({ color: '#bd8f93', roughness: 0.6, clearcoat: 0.25 })), 'cerebelo'));
  const eixoTronco = new THREE.CatmullRomCurve3([V(0.12, -0.2, 0), V(0.2, -0.6, 0), V(0.32, -1.0, 0), V(0.42, -1.5, 0)]);
  const tronco = tuboDeRaioVariavel(eixoTronco, {
    raio: (u) => 0.85 * (0.16 + 0.055 * Math.exp(-(((u - 0.35) / 0.13) ** 2)) - 0.045 * u) * (u > 0.95 ? Math.sqrt(Math.max(0, 1 - ((u - 0.95) / 0.05) ** 2)) : 1),
    segmentos: 60, lados: 24,
  });
  grupo.add(marcarParte(new THREE.Mesh(tronco.geometria, standard('#d4b4a0', 0.6)), 'tronco_encefalico'));

  // estruturas profundas (aparecem no corte)
  const arco = (pontos, raio, achatar = 1) => {
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos), 60, raio, 12);
    if (achatar !== 1) geo.scale(1, 1, achatar);
    return geo;
  };
  grupo.add(marcarParte(new THREE.Mesh(arco([V(-0.7, -0.02, 0), V(-0.62, 0.12, 0), V(-0.35, 0.24, 0), V(0, 0.28, 0), V(0.35, 0.22, 0), V(0.62, 0.05, 0), V(0.68, -0.12, 0)], 0.07, 5.5), standard('#f4efe6', 0.55)), 'corpo_caloso'));
  const materialLiquor = translucido('#8fc5e0', 0.7);
  const materialTalamo = standard('#c68f95', 0.55);
  const materialHipocampo = standard('#c28e5d', 0.55);
  for (const lado of [-1, 1]) {
    const z = (valor) => lado * valor;
    grupo.add(marcarParte(new THREE.Mesh(arco([V(-0.55, 0.05, z(0.3)), V(-0.3, 0.2, z(0.3)), V(0.1, 0.24, z(0.3)), V(0.45, 0.12, z(0.3)), V(0.62, -0.1, z(0.32)), V(0.5, -0.33, z(0.36)), V(0.2, -0.42, z(0.38))], 0.05), materialLiquor), 'ventriculos'));
    const talamo = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), materialTalamo);
    talamo.scale.set(0.2, 0.15, 0.13);
    talamo.position.set(0.05, -0.08, z(0.27));
    grupo.add(marcarParte(talamo, 'talamo'));
    grupo.add(marcarParte(new THREE.Mesh(arco([V(-0.02, -0.42, z(0.42)), V(0.22, -0.5, z(0.44)), V(0.45, -0.42, z(0.44)), V(0.55, -0.22, z(0.4))], 0.045), materialHipocampo), 'hipocampo'));
  }

  // artérias: polígono de Willis na base e artéria cerebral média em cada lado. A cerebral média
  // acompanha a superfície: cada ponto vem de um raio lançado contra a malha do hemisfério.
  const materialArteria = standard('#d6403a', 0.45);
  const arterias = [
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.35, -0.6, 0), V(-0.28, -0.6, 0.15), V(-0.05, -0.6, 0.2), V(0.1, -0.6, 0.12), V(0.15, -0.6, 0), V(0.1, -0.6, -0.12), V(-0.05, -0.6, -0.2), V(-0.28, -0.6, -0.15)], true), 60, 0.022, 8),
    arco([V(0.05, -0.62, 0), V(0.1, -1.0, 0), V(0.2, -1.38, 0)], 0.03),
  ];
  const lancador = new THREE.Raycaster();
  for (const { geo, lado } of superficies) {
    const malha = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const naSuperficie = (x, y) => {
      lancador.set(V(x, y, lado * 4), V(0, 0, -lado));
      const acerto = lancador.intersectObject(malha)[0];
      return acerto ? acerto.point.clone().addScaledVector(acerto.face.normal, 0.025) : null;
    };
    const yLateral = (x) => -0.05 + 0.12 * (x + 0.2);
    arterias.push(arco([V(-0.7, -1.1, lado * 0.22), V(-0.45, -0.85, lado * 0.2), V(-0.3, -0.6, lado * 0.15)], 0.03));
    const principal = [V(-0.3, -0.6, lado * 0.15), V(-0.48, -0.45, lado * 0.5)];
    for (let x = -0.5; x <= 0.5; x += 0.05) principal.push(naSuperficie(x, yLateral(x)));
    const pontosPrincipal = principal.filter(Boolean);
    if (pontosPrincipal.length > 3) arterias.push(arco(pontosPrincipal, 0.022));
    // ramos que sobem pela superfície a partir da fissura lateral
    for (let k = 0; k < 4; k++) {
      const x0 = -0.3 + k * 0.25;
      const ramo = [];
      for (let s = 0; s <= 12; s++) {
        const ponto = naSuperficie(x0 + (k % 2 ? 0.02 : -0.02) * s + Math.sin(s * 0.9 + k) * 0.03, yLateral(x0) + s * 0.04);
        if (ponto) ramo.push(ponto);
      }
      if (ramo.length > 5) arterias.push(arco(ramo, 0.009));
    }
  }
  grupo.add(marcarParte(new THREE.Mesh(mergeGeometries(arterias), materialArteria), 'arterias_cerebrais'));

  // sinapses: pontos sobre o córtex, sorteados por área (MeshSurfaceSampler), cada um com fase e tamanho próprios
  const posicoes = new Float32Array(sinapses * 3);
  const fases = new Float32Array(sinapses);
  const tamanhos = new Float32Array(sinapses);
  const amostras = superficies.map(({ geo }) => new MeshSurfaceSampler(new THREE.Mesh(geo)).setRandomGenerator(aleatorio).build());
  const ponto = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let i = 0; i < sinapses; i++) {
    amostras[i % 2].sample(ponto, normal);
    ponto.addScaledVector(normal, 0.012);
    posicoes.set([ponto.x, ponto.y, ponto.z], i * 3);
    fases[i] = aleatorio();
    tamanhos[i] = 0.7 + aleatorio() * 1.1;
  }
  const geoPontos = new THREE.BufferGeometry();
  geoPontos.setAttribute('position', new THREE.BufferAttribute(posicoes, 3));
  geoPontos.setAttribute('aFase', new THREE.BufferAttribute(fases, 1));
  geoPontos.setAttribute('aTamanho', new THREE.BufferAttribute(tamanhos, 1));
  const materialPontos = materialSinapses('#8fe3ff');
  const pontos = new THREE.Points(geoPontos, materialPontos);
  pontos.frustumCulled = false;
  pontos.raycast = () => {}; // não captura cliques: a parte é escolhida pelo botão
  grupo.add(marcarParte(pontos, 'sinapses'));

  function atualizar(t) {
    materialPontos.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar };
}
