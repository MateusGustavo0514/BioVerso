import * as THREE from 'three';
import { deformarComRuido, marcarParte } from '../utils/geometria.js';

const pulso = (fase, centro, largura) => Math.exp(-((fase - centro) ** 2) / (2 * largura ** 2));

/**
 * Coração estilizado construído com primitivas deformadas e tubos em curvas Catmull-Rom.
 * Visto de frente: o lado esquerdo do paciente aparece à direita da tela.
 */
export function criarCoracao(params, cores) {
  const { bpm = 70 } = params;
  const grupo = new THREE.Group();

  const musculo = (cor) =>
    new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.5, clearcoat: 0.7, clearcoatRoughness: 0.3, sheen: 0.15, sheenColor: '#ff9a9a' });

  const camara = (chave, { raio, escala, posicao, rotacaoZ = 0, cor, semente }) => {
    const geo = deformarComRuido(new THREE.SphereGeometry(raio, 96, 64), { amplitude: 0.018, frequencia: 2.2, semente });
    const malha = new THREE.Mesh(geo, musculo(cor));
    malha.scale.set(...escala);
    malha.position.set(...posicao);
    malha.rotation.z = rotacaoZ;
    malha.userData.escalaBase = malha.scale.clone();
    return marcarParte(malha, chave);
  };

  const corMusculo = new THREE.Color(cores.primaria);
  const ventriculoEsquerdo = camara('ventriculo_esquerdo', {
    raio: 0.62, escala: [0.9, 1.25, 0.9], posicao: [0.28, -0.35, -0.12], rotacaoZ: 0.45, cor: corMusculo, semente: 1,
  });
  const ventriculoDireito = camara('ventriculo_direito', {
    raio: 0.58, escala: [0.9, 1.05, 0.75], posicao: [-0.22, -0.2, 0.22], rotacaoZ: 0.35, cor: corMusculo.clone().offsetHSL(0, 0, 0.03), semente: 2,
  });
  const atrioDireito = camara('atrio_direito', {
    raio: 0.36, escala: [1, 1.1, 0.9], posicao: [-0.62, 0.45, 0.05], cor: corMusculo.clone().offsetHSL(-0.01, -0.1, 0.06), semente: 3,
  });
  const atrioEsquerdo = camara('atrio_esquerdo', {
    raio: 0.32, escala: [1.1, 0.9, 1], posicao: [0.5, 0.5, -0.35], cor: corMusculo.clone().offsetHSL(-0.01, -0.1, 0.06), semente: 4,
  });
  grupo.add(ventriculoEsquerdo, ventriculoDireito, atrioDireito, atrioEsquerdo);

  // Vasos: TubeGeometry ao longo de curvas suaves
  const vaso = (chave, pontos, raio, cor) => {
    const curva = new THREE.CatmullRomCurve3(pontos.map((p) => new THREE.Vector3(...p)));
    const malha = new THREE.Mesh(
      new THREE.TubeGeometry(curva, 96, raio, 24, false),
      new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.35, clearcoat: 0.8 })
    );
    return marcarParte(malha, chave);
  };

  const corAorta = corMusculo.clone().offsetHSL(0, 0.05, 0.1);
  const aorta = new THREE.Group();
  aorta.add(
    vaso('aorta', [[0.05, 0.2, -0.05], [0.08, 1.05, -0.05], [0.35, 1.45, -0.3], [0.72, 1.25, -0.55], [0.8, 0.3, -0.65]], 0.17, corAorta),
    // ramos que saem do arco: tronco braquiocefálico, carótida e subclávia
    vaso('aorta', [[0.15, 1.35, -0.18], [0.05, 1.75, -0.15], [-0.05, 1.95, -0.1]], 0.06, corAorta),
    vaso('aorta', [[0.38, 1.45, -0.3], [0.38, 1.8, -0.3], [0.4, 2.0, -0.3]], 0.05, corAorta),
    vaso('aorta', [[0.58, 1.38, -0.45], [0.7, 1.75, -0.48], [0.8, 1.9, -0.5]], 0.05, corAorta)
  );

  const corVenosa = new THREE.Color(cores.secundaria);
  const arteriaPulmonar = vaso('arteria_pulmonar', [[-0.15, 0.3, 0.3], [-0.05, 0.85, 0.28], [0.3, 1.08, 0.05], [0.75, 1.0, -0.1]], 0.14, corVenosa);
  const ramoPulmonar = vaso('arteria_pulmonar', [[-0.02, 0.95, 0.25], [-0.45, 1.05, 0.05], [-0.9, 1.0, -0.05]], 0.1, corVenosa);
  const veiaCava = vaso('veia_cava', [[-0.62, 0.55, 0.0], [-0.64, 1.2, -0.05], [-0.62, 1.85, -0.08]], 0.13, corVenosa.clone().offsetHSL(0, 0, -0.06));

  grupo.add(aorta, arteriaPulmonar, ramoPulmonar, veiaCava);
  grupo.rotation.z = -0.12;

  // Ciclo cardíaco: átrios contraem antes dos ventrículos
  const periodo = 60 / bpm;
  function atualizar(t) {
    const fase = (t % periodo) / periodo;
    const contracaoAtrios = pulso(fase, 0.08, 0.05);
    const contracaoVentriculos = pulso(fase, 0.3, 0.07);

    for (const atrio of [atrioDireito, atrioEsquerdo]) {
      atrio.scale.copy(atrio.userData.escalaBase).multiplyScalar(1 - 0.07 * contracaoAtrios);
    }
    for (const ventriculo of [ventriculoEsquerdo, ventriculoDireito]) {
      const b = ventriculo.userData.escalaBase;
      ventriculo.scale.set(b.x * (1 - 0.06 * contracaoVentriculos), b.y * (1 - 0.035 * contracaoVentriculos), b.z * (1 - 0.06 * contracaoVentriculos));
    }
    aorta.scale.setScalar(1 + 0.02 * pulso(fase, 0.36, 0.08));
  }

  return { objeto: grupo, atualizar };
}
