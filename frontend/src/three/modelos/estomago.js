import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { criarAleatorio, marcarParte, tuboDeRaioVariavel, fatiarTubo } from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Interpolação suave entre nós [u, valor]: o perfil de raio do estômago ao longo do eixo. */
function perfil(nos) {
  return (u) => {
    if (u <= nos[0][0]) return nos[0][1];
    for (let i = 1; i < nos.length; i++) {
      if (u <= nos[i][0]) return nos[i - 1][1] + (nos[i][1] - nos[i - 1][1]) * suave(nos[i - 1][0], nos[i][0], u);
    }
    return nos[nos.length - 1][1];
  };
}

// Camadas da parede, de fora para dentro. `fator` = raio relativo; cada faixa entre duas superfícies tem
// uma cor. Uma superfície mostra por fora a cor da faixa de fora e, cortada, a cor da faixa de dentro:
// assim a faixa tem a mesma cor de qualquer ângulo, e o corte mostra as camadas como anéis coloridos.
const LONGITUDINAL = '#c86d62';
const CIRCULAR = '#a4413e';
const OBLIQUA = '#bd5f55';
const SUBMUCOSA = '#f1d7c0';
const MUCOSA = '#e48d88';
const CAMADAS = [
  { fator: 1.0, interior: LONGITUDINAL }, // serosa: por fora, a cor do estômago
  { fator: 0.955, superficie: LONGITUDINAL, interior: CIRCULAR, chave: 'camada_muscular' },
  { fator: 0.91, superficie: CIRCULAR, interior: OBLIQUA, chave: 'camada_muscular' },
  { fator: 0.865, superficie: OBLIQUA, interior: SUBMUCOSA, chave: 'camada_muscular' },
  { fator: 0.82, superficie: SUBMUCOSA, interior: MUCOSA, chave: 'submucosa' },
];

/**
 * Estômago: um eixo curvo (fundo → corpo → antro → piloro) e tubos de raio variável em volta dele,
 * um para cada camada da parede (serosa, três camadas musculares, submucosa e mucosa). A mucosa, por
 * dentro, tem as rugas e as fossetas das glândulas. As camadas só aparecem no corte, como faixas da
 * parede. O peristaltismo é uma onda de constrição
 * que desce do corpo ao piloro, recalculada a cada quadro em todas as camadas.
 */
export function criarEstomago(params, cores) {
  const { ondasPorMinuto = 3, semente = 8, fossetas = 1300 } = params;
  const aleatorio = criarAleatorio(semente);
  const ruido = createNoise3D(criarAleatorio(semente + 3));
  const grupo = new THREE.Group();

  const eixo = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.55, 1.0, 0),
    new THREE.Vector3(0.62, 0.55, 0.02),
    new THREE.Vector3(0.5, 0.0, 0.05),
    new THREE.Vector3(0.2, -0.5, 0.05),
    new THREE.Vector3(-0.3, -0.78, 0.02),
    new THREE.Vector3(-0.8, -0.72, 0),
    new THREE.Vector3(-1.15, -0.55, 0),
  ]);

  // raio do corpo do estômago; a cúpula do fundo fecha a ponta de cima como uma meia esfera
  const raioCorpo = perfil([[0.15, 0.45], [0.32, 0.6], [0.55, 0.5], [0.75, 0.31], [0.9, 0.2], [0.96, 0.15], [1, 0.145]]);
  const cupula = 0.15;
  const raioBase = (u) => (u >= cupula ? raioCorpo(u) : raioCorpo(cupula) * Math.sqrt(Math.max(0, 1 - ((cupula - u) / cupula) ** 2)));

  // peristaltismo: faixa de constrição que anda do corpo ao piloro (mais forte no antro)
  const omega = ondasPorMinuto / 60;
  const onda = (u, t) => {
    const posicao = 0.3 + ((t * omega) % 1) * 0.65;
    const forca = 0.05 + 0.13 * suave(0.45, 0.8, u);
    return 1 - forca * Math.exp(-((u - posicao) ** 2) / (2 * 0.045 ** 2)) * suave(0.25, 0.4, u);
  };

  // rugas: dobras longitudinais da mucosa, que avançam para dentro da cavidade
  const RAIO_MUCOSA = 0.79;
  const rugas = (u, angulo) => {
    const n = ruido(Math.cos(angulo) * 1.2, Math.sin(angulo) * 1.2, u * 3.5);
    const dobra = 0.5 + 0.5 * Math.cos(7 * angulo + 3.2 * n);
    return 1 - 0.16 * dobra * suave(0.12, 0.3, u) * (1 - suave(0.82, 0.96, u));
  };

  const tubos = CAMADAS.map(({ fator }) => tuboDeRaioVariavel(eixo, { raio: (u, t) => raioBase(u) * fator * onda(u, t), segmentos: 110, lados: 48 }));
  const mucosa = tuboDeRaioVariavel(eixo, {
    raio: (u, t) => raioBase(u) * RAIO_MUCOSA * onda(u, t),
    modulacao: (u, a) => rugas(u, a),
    segmentos: 110, lados: 48, paraDentro: true,
  });


  const material = (opcoes, interior) => {
    const m = new THREE.MeshPhysicalMaterial({ roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.45, ...opcoes });
    m.userData.interiorCheio = interior;
    return m;
  };

  // serosa (camada de fora), fatiada em trechos clicáveis que dividem os mesmos vértices
  const [geoFundo, geoCorpo, geoAntro, geoPiloro] = fatiarTubo(tubos[0], [0, 0.22, 0.62, 0.92, 1]);
  const trechos = [['fundo', geoFundo], ['corpo', geoCorpo], ['antro', geoAntro], ['piloro', geoPiloro]];
  for (const [chave, geo] of trechos) {
    grupo.add(marcarParte(new THREE.Mesh(geo, material({ color: cores.primaria, sheen: 0.5, sheenColor: '#ffc9bf' }, CAMADAS[0].interior)), chave));
  }
  // camadas de dentro (musculares e submucosa): só aparecem no corte, como faixas da parede
  CAMADAS.slice(1).forEach((camada, k) => {
    const tubo = tubos[k + 1];
    grupo.add(marcarParte(new THREE.Mesh(tubo.geometria, material({ color: camada.superficie }, camada.interior)), camada.chave));
  });
  // mucosa: vista de dentro (cavidade) ou cortada, sempre na cor da mucosa
  const materialMucosa = material({ color: new THREE.Color(cores.secundaria).offsetHSL(0, 0.12, -0.1), roughness: 0.62, clearcoat: 0 }, MUCOSA);
  grupo.add(marcarParte(new THREE.Mesh(mucosa.geometria, materialMucosa), 'mucosa'));

  // anel muscular do piloro (esfíncter): um toro orientado pela tangente do eixo
  const anel = new THREE.Mesh(new THREE.TorusGeometry(raioCorpo(0.95) * 0.9, 0.06, 14, 36), material({ color: CIRCULAR }, CIRCULAR));
  anel.position.copy(eixo.getPointAt(0.95));
  anel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), eixo.getTangentAt(0.95));
  grupo.add(marcarParte(anel, 'piloro'));

  // fossetas gástricas: pontos escuros na mucosa (cada esfera representa muitas glândulas)
  const pontos = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < fossetas; i++) {
    const u = 0.17 + aleatorio() * 0.72;
    const a = aleatorio() * Math.PI * 2;
    pontos.push(mucosa.pontoNaSecao(u, a, RAIO_MUCOSA * rugas(u, a) * 0.995, p).clone());
  }
  const fossetasMalha = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.013, 8, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(cores.secundaria).multiplyScalar(0.5), roughness: 0.8 }),
    pontos.length
  );
  const m = new THREE.Matrix4();
  pontos.forEach((ponto, i) => fossetasMalha.setMatrixAt(i, m.makeTranslation(ponto.x, ponto.y, ponto.z)));
  grupo.add(marcarParte(fossetasMalha, 'glandulas_gastricas'));

  // esôfago e duodeno: tubos fechados; cortados, mostram a parede cheia
  const tuboSimples = (pontos, raio, cor, chave) => {
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos), 60, raio, 20);
    grupo.add(marcarParte(new THREE.Mesh(geo, material({ color: cor }, true)), chave));
  };
  tuboSimples([
    new THREE.Vector3(-0.05, 1.8, 0), new THREE.Vector3(0.0, 1.35, 0.02), new THREE.Vector3(0.12, 1.0, 0.03), new THREE.Vector3(0.3, 0.7, 0.02),
  ], 0.115, new THREE.Color(cores.primaria).offsetHSL(0.0, -0.05, -0.05), 'esofago');
  // duodeno: primeiro trecho do intestino, em C em volta da cabeça do pâncreas
  tuboSimples([
    new THREE.Vector3(-1.1, -0.55, 0), new THREE.Vector3(-1.45, -0.55, 0.04), new THREE.Vector3(-1.72, -0.28, 0.08),
    new THREE.Vector3(-1.78, 0.12, 0.08), new THREE.Vector3(-1.58, 0.4, 0.04), new THREE.Vector3(-1.3, 0.46, 0),
  ], 0.13, new THREE.Color(cores.primaria).offsetHSL(0.03, 0, -0.1), 'duodeno');

  function atualizar(t) {
    tubos.forEach((tubo) => tubo.atualizar(t));
    mucosa.atualizar(t);
  }

  return { objeto: grupo, atualizar };
}
