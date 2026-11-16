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

/**
 * Estômago: um eixo curvo (fundo → corpo → antro → piloro) e um tubo de raio variável em volta dele.
 * Duas paredes: a camada muscular por fora e a mucosa, virada do avesso, por dentro, com as rugas
 * (dobras longitudinais por ruído) e as fossetas das glândulas gástricas, que só aparecem no corte.
 * O peristaltismo é uma onda de constrição que desce do corpo ao piloro, recalculada a cada quadro.
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

  const ESPESSURA_PAREDE = 0.8; // raio interno da mucosa em relação ao externo
  // rugas: dobras que correm no sentido do comprimento, mais altas no corpo do que no fundo e no piloro
  const rugas = (u, angulo) => {
    const n = ruido(Math.cos(angulo) * 1.2, Math.sin(angulo) * 1.2, u * 3.5);
    const dobra = 0.5 + 0.5 * Math.cos(7 * angulo + 3.2 * n);
    return 1 + 0.2 * dobra * suave(0.12, 0.3, u) * (1 - suave(0.82, 0.96, u));
  };

  const externo = tuboDeRaioVariavel(eixo, {
    raio: (u, t) => raioBase(u) * onda(u, t),
    segmentos: 110, lados: 40,
  });
  const interno = tuboDeRaioVariavel(eixo, {
    raio: (u, t) => raioBase(u) * ESPESSURA_PAREDE * onda(u, t),
    modulacao: (u, a) => rugas(u, a),
    segmentos: 110, lados: 40, paraDentro: true,
  });

  const materialParede = () =>
    new THREE.MeshPhysicalMaterial({ color: cores.primaria, roughness: 0.48, clearcoat: 0.4, clearcoatRoughness: 0.4, sheen: 0.5, sheenColor: '#ffc9bf' });
  // revestimento interno: só a face de dentro aparece (malha do avesso), como as cavidades do coração
  const materialMucosa = new THREE.MeshStandardMaterial({ color: new THREE.Color(cores.secundaria).offsetHSL(0, 0.12, -0.1), roughness: 0.62, side: THREE.FrontSide });
  materialMucosa.userData.manterLado = true;

  // a parede externa é fatiada em trechos clicáveis que dividem os mesmos vértices (sem emenda)
  const [geoFundo, geoCorpo, geoAntro, geoPiloro] = fatiarTubo(externo, [0, 0.22, 0.62, 0.92, 1]);
  const trechos = [['fundo', geoFundo], ['corpo', geoCorpo], ['antro', geoAntro], ['piloro', geoPiloro]];
  for (const [chave, geo] of trechos) grupo.add(marcarParte(new THREE.Mesh(geo, materialParede()), chave));
  grupo.add(marcarParte(new THREE.Mesh(interno.geometria, materialMucosa), 'mucosa'));

  // anel muscular do piloro (esfíncter): um toro orientado pela tangente do eixo
  const tangentePiloro = eixo.getTangentAt(0.95);
  const anel = new THREE.Mesh(new THREE.TorusGeometry(raioCorpo(0.95) * 1.02, 0.05, 12, 32), materialParede());
  anel.position.copy(eixo.getPointAt(0.95));
  anel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangentePiloro);
  anel.material.color.multiplyScalar(0.8);
  grupo.add(marcarParte(anel, 'piloro'));

  // fossetas gástricas: pontos escuros na mucosa (cada esfera representa muitas glândulas)
  const pontos = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < fossetas; i++) {
    const u = 0.17 + aleatorio() * 0.72;
    const a = aleatorio() * Math.PI * 2;
    pontos.push(interno.pontoNaSecao(u, a, ESPESSURA_PAREDE * rugas(u, a) * 0.995, p).clone());
  }
  const fossetasMalha = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.013, 8, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(cores.secundaria).multiplyScalar(0.5), roughness: 0.8 }),
    pontos.length
  );
  const m = new THREE.Matrix4();
  pontos.forEach((ponto, i) => fossetasMalha.setMatrixAt(i, m.makeScale(1, 1, 1).setPosition(ponto)));
  grupo.add(marcarParte(fossetasMalha, 'glandulas_gastricas'));

  // esôfago: desce até a cárdia, na curvatura menor
  const caminhoEsofago = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.05, 1.8, 0),
    new THREE.Vector3(0.0, 1.35, 0.02),
    new THREE.Vector3(0.12, 1.0, 0.03),
    new THREE.Vector3(0.3, 0.7, 0.02),
  ]);
  const esofago = new THREE.Mesh(
    new THREE.TubeGeometry(caminhoEsofago, 40, 0.115, 20),
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color(cores.primaria).offsetHSL(0.0, -0.05, -0.05), roughness: 0.5, clearcoat: 0.3 })
  );
  grupo.add(marcarParte(esofago, 'esofago'));

  // duodeno: primeiro trecho do intestino, em C em volta da cabeça do pâncreas
  const caminhoDuodeno = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.1, -0.55, 0),
    new THREE.Vector3(-1.45, -0.55, 0.04),
    new THREE.Vector3(-1.72, -0.28, 0.08),
    new THREE.Vector3(-1.78, 0.12, 0.08),
    new THREE.Vector3(-1.58, 0.4, 0.04),
    new THREE.Vector3(-1.3, 0.46, 0),
  ]);
  const duodeno = new THREE.Mesh(
    new THREE.TubeGeometry(caminhoDuodeno, 60, 0.13, 20),
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color(cores.primaria).offsetHSL(0.03, 0, -0.1), roughness: 0.5, clearcoat: 0.3 })
  );
  grupo.add(marcarParte(duodeno, 'duodeno'));

  function atualizar(t) {
    externo.atualizar(t);
    interno.atualizar(t);
  }

  return { objeto: grupo, atualizar };
}
