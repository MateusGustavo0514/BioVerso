import * as THREE from 'three';
import { criarAleatorio, marcarParte, tuboDeRaioVariavel, fatiarTubo } from '../utils/geometria.js';

// Camadas da parede, de fora para dentro (mesma ideia do estômago, com uma camada muscular a menos).
// Uma superfície mostra por fora a cor da faixa de fora e, cortada, a cor da faixa de dentro.
const LONGITUDINAL = '#c9766a';
const CIRCULAR = '#a8473f';
const SUBMUCOSA = '#f1d7c0';
const MUCOSA = '#ea9a8c';
const CAMADAS = [
  { fator: 1.0, interior: LONGITUDINAL }, // serosa: por fora, a cor de cada trecho
  { fator: 0.93, superficie: LONGITUDINAL, interior: CIRCULAR, chave: 'camada_muscular' },
  { fator: 0.86, superficie: CIRCULAR, interior: SUBMUCOSA, chave: 'camada_muscular' },
  { fator: 0.8, superficie: SUBMUCOSA, interior: MUCOSA, chave: 'submucosa' },
];
const RAIO_MUCOSA = 0.75;

/**
 * Intestino delgado: um tubo muito longo dobrado em alças (curva Catmull-Rom por fileiras que vão e
 * voltam), com a parede em camadas: serosa, músculo longitudinal, músculo circular, submucosa e mucosa.
 * A mucosa tem as pregas circulares (modulação periódica do raio) cobertas por vilosidades, que
 * apontam para o centro do tubo. As camadas só aparecem no corte, como faixas da parede.
 * Uma onda de contração percorre o tubo, e todas as camadas e as vilosidades a acompanham.
 */
export function criarIntestino(params, cores) {
  const { vilosidades = 3200, alcas = 9, ondasPorMinuto = 6, semente = 12 } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  // fileiras horizontais, de cima para baixo, em sentidos alternados; as pontas viram curvas
  const pontos = [new THREE.Vector3(-1.45, 1.35, 0.1), new THREE.Vector3(-1.25, 1.1, 0.05)];
  for (let k = 0; k < alcas; k++) {
    const sentido = k % 2 === 0 ? 1 : -1;
    const y = 1.0 - k * 0.27;
    for (let j = 0; j < 6; j++) {
      const x = sentido * (-1.05 + j * 0.42);
      pontos.push(new THREE.Vector3(x, y + (aleatorio() - 0.5) * 0.08, (aleatorio() - 0.5) * 0.6));
    }
    if (k < alcas - 1) pontos.push(new THREE.Vector3(sentido * 1.3, y - 0.135, (aleatorio() - 0.5) * 0.4));
  }
  pontos.push(new THREE.Vector3(-0.2, -1.4, 0.1));
  const eixo = new THREE.CatmullRomCurve3(pontos, false, 'centripetal');

  const RAIO = 0.125;
  const PREGAS = 64; // quantidade de pregas circulares ao longo do tubo
  const omegaOnda = ondasPorMinuto / 60;
  // onda de contração que corre pelo tubo: cada crista estreita um pouco o raio
  const onda = (u, t) => 1 - 0.09 * (0.5 + 0.5 * Math.cos(Math.PI * 2 * (u * 9 - t * omegaOnda))) ** 3;
  // pregas circulares: anéis que avançam para dentro do tubo
  const pregas = (u) => 1 - 0.2 * (0.5 + 0.5 * Math.cos(Math.PI * 2 * u * PREGAS)) ** 3;

  const segmentos = 480;
  const lados = 14;
  const tubos = CAMADAS.map(({ fator }) => tuboDeRaioVariavel(eixo, { raio: (u, t) => RAIO * fator * onda(u, t), segmentos, lados }));
  const mucosa = tuboDeRaioVariavel(eixo, {
    raio: (u, t) => RAIO * RAIO_MUCOSA * onda(u, t),
    modulacao: (u) => pregas(u),
    segmentos, lados, paraDentro: true,
  });

  const material = (opcoes, interior) => {
    const m = new THREE.MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.35, ...opcoes });
    m.userData.interiorCheio = interior;
    return m;
  };

  // serosa: três trechos clicáveis (os mesmos vértices), duodeno, jejuno e íleo, em tons um pouco diferentes
  const base = new THREE.Color(cores.primaria);
  const trechos = fatiarTubo(tubos[0], [0, 0.07, 0.4, 1]);
  [['duodeno', base.clone().offsetHSL(0.02, 0, -0.07)], ['jejuno', base.clone().offsetHSL(0, 0.05, 0)], ['ileo', base.clone().offsetHSL(-0.01, -0.05, 0.05)]].forEach(([chave, cor], k) => {
    grupo.add(marcarParte(new THREE.Mesh(trechos[k], material({ color: cor, sheen: 0.4, sheenColor: '#ffd0c4' }, CAMADAS[0].interior)), chave));
  });
  // camadas de dentro (musculares e submucosa): só aparecem no corte, como faixas da parede
  CAMADAS.slice(1).forEach((camada, k) => {
    const tubo = tubos[k + 1];
    grupo.add(marcarParte(new THREE.Mesh(tubo.geometria, material({ color: camada.superficie }, camada.interior)), camada.chave));
  });
  // mucosa com as pregas circulares: vista de dentro ou cortada, sempre na cor da mucosa
  const materialMucosa = material({ color: new THREE.Color(cores.secundaria).offsetHSL(0, 0.1, -0.1), roughness: 0.6, clearcoat: 0 }, MUCOSA);
  grupo.add(marcarParte(new THREE.Mesh(mucosa.geometria, materialMucosa), 'pregas_circulares'));

  // vilosidades: dedos minúsculos na mucosa, apontando para o eixo do tubo
  const geometriaVilo = new THREE.CapsuleGeometry(0.009, 0.034, 3, 6);
  geometriaVilo.translate(0, 0.026, 0); // a base fica na origem
  const malhaVilos = new THREE.InstancedMesh(
    geometriaVilo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(cores.secundaria).offsetHSL(-0.02, 0.2, -0.12), roughness: 0.55 }),
    vilosidades
  );
  const lista = Array.from({ length: vilosidades }, () => ({ u: 0.01 + aleatorio() * 0.98, a: aleatorio() * Math.PI * 2, tamanho: 0.7 + aleatorio() * 0.6 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const eixoY = new THREE.Vector3(0, 1, 0);
  const escala = new THREE.Vector3();
  function posicionarVilos(t) {
    lista.forEach((v, i) => {
      // `pontoNaSecao` já usa o raio da mucosa (sem a onda): aqui entram a prega e a onda do momento
      const fator = pregas(v.u) * (onda(v.u, t) / onda(v.u, 0));
      mucosa.pontoNaSecao(v.u, v.a, fator, p);
      mucosa.direcaoNaSecao(v.u, v.a, dir).negate();
      q.setFromUnitVectors(eixoY, dir);
      m.compose(p, q, escala.set(1, v.tamanho, 1));
      malhaVilos.setMatrixAt(i, m);
    });
    malhaVilos.instanceMatrix.needsUpdate = true;
  }
  posicionarVilos(0);
  grupo.add(marcarParte(malhaVilos, 'vilosidades'));

  // a malha é grande: recalcula a cada dois quadros
  let quadro = 0;
  function atualizar(t) {
    if (quadro++ % 2) return;
    tubos.forEach((tubo) => tubo.atualizar(t));
    mucosa.atualizar(t);
    posicionarVilos(t);
  }

  return { objeto: grupo, atualizar };
}
