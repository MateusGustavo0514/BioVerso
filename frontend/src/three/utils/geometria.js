import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Gerador pseudoaleatório com semente (mulberry32): o mesmo modelo sai igual toda vez. */
export function criarAleatorio(semente = 1) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Desloca cada vértice ao longo da própria normal usando ruído simplex 3D.
 * É o que dá o aspecto orgânico (irregular) às membranas e órgãos.
 */
export function deformarComRuido(geometria, { amplitude = 0.05, frequencia = 2.5, oitavas = 2, semente = 1 } = {}) {
  geometria.deleteAttribute('uv');
  const geo = mergeVertices(geometria); // une vértices duplicados na costura da esfera
  geo.computeVertexNormals();

  const ruido = createNoise3D(criarAleatorio(semente));
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    let deslocamento = 0;
    let amp = 1;
    let freq = frequencia;
    for (let o = 0; o < oitavas; o++) {
      deslocamento += ruido(v.x * freq, v.y * freq, v.z * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    v.addScaledVector(n, deslocamento * amplitude);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  return geo;
}

/** Distribui N pontos quase uniformes numa esfera (espiral de Fibonacci). */
export function pontosFibonacci(quantidade) {
  const pontos = [];
  const anguloDourado = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < quantidade; i++) {
    const y = 1 - (i / Math.max(quantidade - 1, 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = anguloDourado * i;
    pontos.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return pontos;
}

/**
 * Trajeto de um genoma: caminhada sorteada entre cascas esféricas, suavizada por Catmull-Rom.
 * `escala` estica o novelo (nucleoide de um bacilo) e `fechada` liga o fim ao início (DNA circular).
 */
export function curvaNovelo({ raioMin, raioMax, pontos, aleatorio, escala = new THREE.Vector3(1, 1, 1), fechada = false }) {
  const direcao = new THREE.Vector3(0, 1, 0);
  const eixo = new THREE.Vector3();
  const lista = [];
  for (let i = 0; i < pontos; i++) {
    eixo.set(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).cross(direcao).normalize();
    direcao.applyAxisAngle(eixo, 0.7 + aleatorio() * 0.6);
    lista.push(direcao.clone().multiplyScalar(raioMin + aleatorio() * (raioMax - raioMin)).multiply(escala));
  }
  return new THREE.CatmullRomCurve3(lista, fechada);
}

/** Esferas instanciadas em posições dadas, com leve variação de tamanho. */
export function esferasInstanciadas(posicoes, raioEsfera, cor, aleatorio, detalhe = 16) {
  const malha = new THREE.InstancedMesh(
    new THREE.SphereGeometry(raioEsfera, detalhe, Math.ceil(detalhe * 0.75)),
    new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.5, sheen: 0.6, sheenColor: '#ffffff' }),
    posicoes.length
  );
  const matriz = new THREE.Matrix4();
  posicoes.forEach((p, i) => {
    const s = 0.9 + aleatorio() * 0.2;
    malha.setMatrixAt(i, matriz.makeScale(s, s, s).setPosition(p));
  });
  return malha;
}

/** Cilindro que liga dois pontos (útil para ramificações). */
export function cilindroEntre(inicio, fim, raioInicio, raioFim, segmentos = 8) {
  const direcao = new THREE.Vector3().subVectors(fim, inicio);
  const comprimento = direcao.length();
  const geo = new THREE.CylinderGeometry(raioFim, raioInicio, comprimento, segmentos, 1, false);
  geo.translate(0, comprimento / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direcao.normalize());
  geo.applyQuaternion(q);
  geo.translate(inicio.x, inicio.y, inicio.z);
  return geo;
}

/** Marca um objeto como "parte" clicável (a chave bate com a tabela `partes` do banco). */
export function marcarParte(objeto, chave) {
  objeto.userData.parte = chave;
  return objeto;
}

/** Separa os triângulos de uma malha pelos dois lados de um plano: uma superfície só, duas partes clicáveis. */
export function dividirPorPlano(geo, normal, limite) {
  const pos = geo.attributes.position;
  const indices = geo.index.array;
  const [lado, outro] = [[], []];
  const centro = new THREE.Vector3();
  const vertice = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    centro.set(0, 0, 0);
    for (let k = 0; k < 3; k++) centro.add(vertice.fromBufferAttribute(pos, indices[i + k]));
    (centro.divideScalar(3).dot(normal) > limite ? lado : outro).push(indices[i], indices[i + 1], indices[i + 2]);
  }
  return [lado, outro].map((lista) => geo.clone().setIndex(lista));
}

/**
 * Separa os triângulos de uma malha por uma função da posição do centro do triângulo.
 * `classificar(centro)` devolve o número da peça (0, 1, 2...). Todas as peças usam a mesma superfície.
 */
export function dividirPorRegiao(geo, quantidade, classificar) {
  const pos = geo.attributes.position;
  const indices = geo.index.array;
  const listas = Array.from({ length: quantidade }, () => []);
  const centro = new THREE.Vector3();
  const vertice = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    centro.set(0, 0, 0);
    for (let k = 0; k < 3; k++) centro.add(vertice.fromBufferAttribute(pos, indices[i + k]));
    listas[classificar(centro.divideScalar(3))].push(indices[i], indices[i + 1], indices[i + 2]);
  }
  return listas.map((lista) => geo.clone().setIndex(lista));
}

/** Vira a malha do avesso (ordem dos vértices e normais): a face visível passa a ser a de dentro. */
export function virarParaDentro(geo) {
  const indices = geo.index.array;
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const normais = geo.attributes.normal.array;
  for (let i = 0; i < normais.length; i++) normais[i] = -normais[i];
  return geo;
}

/**
 * Tubo de raio variável ao longo de uma curva (esôfago, estômago, intestino, ureter, osso...).
 * Diferente do TubeGeometry, o raio é uma função `raio(u, t)` e há uma modulação opcional
 * `modulacao(u, ângulo, t)` (pregas, vilosidades...). As posições são recalculadas por `atualizar(t)`,
 * o que permite animar ondas de contração (peristaltismo) sem shader próprio.
 *
 * Opção `paraDentro`: vira a malha do avesso (revestimento interno, só a face de dentro aparece).
 * Devolve também `pontoNaSecao(u, ângulo, fator)`, para pôr outros objetos na parede do tubo.
 */
export function tuboDeRaioVariavel(curva, { raio, modulacao = null, segmentos = 80, lados = 32, paraDentro = false } = {}) {
  const quadros = curva.computeFrenetFrames(segmentos, false);
  const centros = Array.from({ length: segmentos + 1 }, (_, i) => curva.getPointAt(i / segmentos));
  const geometria = new THREE.BufferGeometry();
  const posicoes = new THREE.BufferAttribute(new Float32Array((segmentos + 1) * lados * 3), 3);
  geometria.setAttribute('position', posicoes);

  // mesma convenção do TubeGeometry: vértice = centro + raio * (-cos(a) * normal + sen(a) * binormal)
  const direcao = (i, angulo, alvo) =>
    alvo.copy(quadros.normals[i]).multiplyScalar(-Math.cos(angulo)).addScaledVector(quadros.binormals[i], Math.sin(angulo));

  const indices = [];
  for (let j = 1; j <= segmentos; j++) {
    for (let i = 0; i < lados; i++) {
      const i1 = (i + 1) % lados;
      const a = (j - 1) * lados + i;
      const b = j * lados + i;
      const c = j * lados + i1;
      const d = (j - 1) * lados + i1;
      if (paraDentro) indices.push(a, d, b, b, d, c);
      else indices.push(a, b, d, b, c, d);
    }
  }
  geometria.setIndex(indices);

  const dir = new THREE.Vector3();
  function atualizar(t = 0) {
    for (let j = 0; j <= segmentos; j++) {
      const u = j / segmentos;
      const r = raio(u, t);
      for (let i = 0; i < lados; i++) {
        const angulo = (i / lados) * Math.PI * 2;
        const fator = r * (modulacao ? modulacao(u, angulo, t) : 1);
        direcao(j, angulo, dir);
        posicoes.setXYZ(j * lados + i, centros[j].x + dir.x * fator, centros[j].y + dir.y * fator, centros[j].z + dir.z * fator);
      }
    }
    posicoes.needsUpdate = true;
    geometria.computeVertexNormals();
    geometria.attributes.normal.needsUpdate = true;
  }
  atualizar(0);

  const quadroA = new THREE.Vector3();
  function pontoNaSecao(u, angulo, fator = 1, alvo = new THREE.Vector3()) {
    const x = Math.min(Math.max(u, 0), 1) * segmentos;
    const i = Math.min(Math.floor(x), segmentos - 1);
    const f = x - i;
    const r = raio(u, 0) * fator;
    alvo.copy(centros[i]).lerp(centros[i + 1], f);
    direcao(i, angulo, quadroA);
    alvo.addScaledVector(quadroA, r * (1 - f));
    direcao(i + 1, angulo, quadroA);
    return alvo.addScaledVector(quadroA, r * f);
  }
  /** Direção radial (para fora) na seção `u`, no ângulo dado. */
  function direcaoNaSecao(u, angulo, alvo = new THREE.Vector3()) {
    const i = Math.min(Math.round(Math.min(Math.max(u, 0), 1) * segmentos), segmentos);
    return direcao(i, angulo, alvo);
  }
  const tangenteNaSecao = (u, alvo = new THREE.Vector3()) => alvo.copy(curva.getTangentAt(Math.min(Math.max(u, 0), 1)));

  return { geometria, atualizar, pontoNaSecao, direcaoNaSecao, tangenteNaSecao, segmentos, lados };
}

/**
 * Fatia um tubo de `tuboDeRaioVariavel` em trechos (por exemplo fundo, corpo e antro do estômago).
 * `fracoes` = [0, 0.3, 0.7, 1]. Os trechos dividem os mesmos vértices, então a animação e as
 * normais continuam sem emenda entre eles.
 */
export function fatiarTubo(tubo, fracoes) {
  const { geometria, segmentos, lados } = tubo;
  const todos = geometria.index.array;
  const fatias = [];
  for (let k = 0; k < fracoes.length - 1; k++) {
    const de = Math.round(fracoes[k] * segmentos) * lados * 6;
    const ate = Math.round(fracoes[k + 1] * segmentos) * lados * 6;
    fatias.push(partilharVertices(geometria, Array.from(todos.slice(de, ate))));
  }
  return fatias;
}

/** Geometria nova com outro índice, mas os mesmos atributos (posição, normal e cor): a animação vale para as duas. */
function partilharVertices(geometria, indices) {
  const nova = new THREE.BufferGeometry();
  for (const nome of ['position', 'normal', 'color']) {
    if (geometria.attributes[nome]) nova.setAttribute(nome, geometria.attributes[nome]);
  }
  nova.setIndex(indices);
  return nova;
}

/**
 * Árvore recursiva de ramos (vasos, ductos): cada ramo se divide em `filhos`, menores e mais finos,
 * e só existe enquanto a ponta cabe dentro do volume (`dentro(ponto)`). Devolve a lista de ramos
 * `{ inicio, fim, raio, terminal }`; use `geometriaDosRamos` para virar malha.
 */
export function arvoreRamificada({
  inicio, direcao, comprimento, raio, profundidade, dentro, aleatorio, ramos = [],
  abertura = 0.4, reducaoComprimento = 0.75, reducaoRaio = 0.72, filhos = 2,
}) {
  const fim = inicio.clone().addScaledVector(direcao, comprimento);
  if (!dentro(fim)) return ramos;
  const ramo = { inicio, fim, raio, terminal: true };
  ramos.push(ramo);
  if (profundidade === 0) return ramos;
  const antes = ramos.length;
  for (let k = 0; k < filhos; k++) {
    const sinal = filhos === 2 ? (k === 0 ? -1 : 1) : 1;
    const eixo = new THREE.Vector3().crossVectors(direcao, new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5)).normalize();
    const nova = direcao.clone().applyAxisAngle(eixo, sinal * (abertura * 0.7 + aleatorio() * abertura * 0.7)).normalize();
    arvoreRamificada({
      inicio: fim, direcao: nova, comprimento: comprimento * (reducaoComprimento + (aleatorio() - 0.5) * 0.12),
      raio: raio * reducaoRaio, profundidade: profundidade - 1, dentro, aleatorio, ramos, abertura, reducaoComprimento, reducaoRaio, filhos,
    });
  }
  ramo.terminal = ramos.length === antes;
  return ramos;
}

/** Malha única com um cilindro por ramo. `deslocamento(ramo)` devolve um vetor para afastar o vaso do eixo. */
export function geometriaDosRamos(ramos, { espessura = 1, lados = 8, deslocamento = null } = {}) {
  const pedacos = ramos.map((ramo) => {
    const desloc = deslocamento ? deslocamento(ramo) : null;
    const a = desloc ? ramo.inicio.clone().add(desloc) : ramo.inicio;
    const b = desloc ? ramo.fim.clone().add(desloc) : ramo.fim;
    return cilindroEntre(a, b, ramo.raio * espessura, ramo.raio * espessura * 0.78, lados);
  });
  return mergeGeometries(pedacos);
}
