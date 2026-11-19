import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { deformarComRuido, marcarParte, dividirPorPlano, virarParaDentro, cilindroEntre } from '../utils/geometria.js';

const pulso = (fase, centro, largura) => Math.exp(-((fase - centro) ** 2) / (2 * largura ** 2));
const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Massa dos ventrículos: esfera remodelada vértice a vértice num cone arredondado,
 * com a base achatada (onde se apoiam os átrios) e a ponta, o ápice, em -Y.
 */
function geometriaVentriculos(semente) {
  const geo = new THREE.SphereGeometry(1, 112, 84);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y < 0) {
      const afinar = 1 - 0.55 * (-v.y) ** 1.6;
      v.set(v.x * afinar, v.y * 1.45, v.z * afinar);
    } else {
      v.y *= 0.55;
    }
    pos.setXYZ(i, v.x * 0.95, v.y, v.z * 0.78);
  }
  return deformarComRuido(geo, { amplitude: 0.02, frequencia: 2, semente });
}

/**
 * Coronária descendente anterior: corre pelo sulco entre os ventrículos, na frente.
 * Os pontos vêm da própria malha (vértices junto ao plano do septo), afastados pela normal.
 */
function curvaSulco(geo, normal, limite) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const pontos = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (Math.abs(v.dot(normal) - limite) < 0.03 && v.z > 0.1) {
      pontos.push(v.clone().addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, i), 0.035));
    }
  }
  pontos.sort((a, b) => b.y - a.y);
  // um ponto a cada faixa de altura: a curva fica suave, sem zigue-zague entre vértices vizinhos
  const filtrados = pontos.filter((p, i) => i === 0 || pontos[i - 1].y - p.y > 0.001).filter((_, i, l) => i % Math.ceil(l.length / 14) === 0);
  return new THREE.CatmullRomCurve3(filtrados);
}

/**
 * Valva cardíaca: anel (toro) e cúspides em leque. Cada cúspide gira numa dobradiça
 * tangente ao anel; `sentido` = +1 abre para cima (aórtica, pulmonar), -1 para baixo (mitral, tricúspide).
 */
function criarValva(chave, { raio, cuspides, material, sentido }) {
  const valva = new THREE.Group();
  const anel = new THREE.Mesh(new THREE.TorusGeometry(raio, raio * 0.13, 8, 40), material);
  anel.rotation.x = Math.PI / 2;
  valva.add(marcarParte(anel, chave));

  const fatia = (Math.PI * 2) / cuspides;
  const folhetos = [];
  for (let i = 0; i < cuspides; i++) {
    const meio = i * fatia;
    const dobradica = new THREE.Vector3(Math.cos(meio), 0, -Math.sin(meio)).multiplyScalar(raio);
    const geo = new THREE.CircleGeometry(raio * 0.97, 10, meio - fatia / 2 + 0.06, fatia - 0.12);
    geo.rotateX(-Math.PI / 2).translate(-dobradica.x, 0, -dobradica.z);
    const pivo = new THREE.Group();
    pivo.position.copy(dobradica);
    pivo.add(marcarParte(new THREE.Mesh(geo, material), chave));
    pivo.userData.eixo = new THREE.Vector3(-Math.sin(meio), 0, -Math.cos(meio)); // tangente ao anel
    valva.add(pivo);
    folhetos.push(pivo);
  }
  valva.userData.abrir = (abertura) =>
    folhetos.forEach((f) => f.quaternion.setFromAxisAngle(f.userData.eixo, sentido * abertura * 1.15));
  return valva;
}

/**
 * Coração: massa ventricular única dividida pelo septo, átrios, valvas que abrem e fecham
 * no ciclo cardíaco, coronárias e grandes vasos em TubeGeometry sobre curvas Catmull-Rom.
 * Visto de frente: o lado esquerdo do paciente aparece à direita da tela.
 */
export function criarCoracao(params, cores) {
  const { bpm = 70 } = params;
  const grupo = new THREE.Group();

  const corMusculo = new THREE.Color(cores.primaria);
  const corVenosa = new THREE.Color(cores.secundaria);
  // cortado, o músculo aparece cheio (a espessura da parede fica visível), e não como uma casca
  const musculo = (cor) => {
    const material = new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.35, sheen: 0.15, sheenColor: '#ff9a9a' });
    material.userData.interiorCheio = true;
    return material;
  };
  // revestimento interno das câmaras: só a face de dentro (malha virada do avesso), por isso não vira DoubleSide
  const parede = (cor) => {
    const material = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.75, side: THREE.FrontSide });
    material.userData.manterLado = true;
    return material;
  };
  const materialValva = new THREE.MeshStandardMaterial({ color: '#efe3cf', roughness: 0.55 });

  // ---------- Ventrículos: uma superfície, dividida pelo plano do septo ----------
  const ventriculos = new THREE.Group();
  ventriculos.rotation.set(-0.25, 0, 0.55); // ápice para baixo, para a esquerda do paciente e para a frente
  const normalSepto = new THREE.Vector3(1, 0, -0.9).normalize(); // aponta para o ventrículo esquerdo
  const limiteSepto = -0.08; // o esquerdo fica maior que o direito

  const geoVentriculos = geometriaVentriculos(1);
  const [geoEsquerdo, geoDireito] = dividirPorPlano(geoVentriculos, normalSepto, limiteSepto);
  ventriculos.add(
    marcarParte(new THREE.Mesh(geoEsquerdo, musculo(corMusculo)), 'ventriculo_esquerdo'),
    marcarParte(new THREE.Mesh(geoDireito, musculo(corMusculo.clone().offsetHSL(0, 0, 0.03))), 'ventriculo_direito')
  );

  // Cavidades: o espaço entre a superfície e a cavidade é a parede; a do ventrículo esquerdo é a mais grossa
  const cavidade = (chave, { raios, centro, giroY = 0 }) => {
    const malha = new THREE.Mesh(virarParaDentro(new THREE.SphereGeometry(1, 48, 32)), parede(corMusculo.clone().offsetHSL(0, -0.1, 0.1)));
    malha.scale.set(...raios);
    malha.position.set(...centro);
    malha.rotation.y = giroY;
    return marcarParte(malha, chave);
  };
  ventriculos.add(
    cavidade('ventriculo_esquerdo', { raios: [0.34, 0.62, 0.3], centro: [0.28, -0.33, -0.2] }),
    cavidade('ventriculo_direito', { raios: [0.3, 0.55, 0.2], centro: [-0.45, -0.18, 0.24], giroY: 0.7 })
  );

  // Coronária no sulco interventricular anterior
  const corCoronaria = corMusculo.clone().offsetHSL(0, 0.15, 0.12);
  ventriculos.add(
    marcarParte(
      new THREE.Mesh(new THREE.TubeGeometry(curvaSulco(geoVentriculos, normalSepto, limiteSepto), 80, 0.035, 10), musculo(corCoronaria)),
      'coronarias'
    )
  );

  // Valvas na base dos ventrículos (coordenadas locais: acompanham a contração)
  const valvas = {
    tricuspide: criarValva('valvula_tricuspide', { raio: 0.17, cuspides: 3, material: materialValva, sentido: -1 }),
    mitral: criarValva('valvula_mitral', { raio: 0.16, cuspides: 2, material: materialValva, sentido: -1 }),
    pulmonar: criarValva('valvula_pulmonar', { raio: 0.12, cuspides: 3, material: materialValva, sentido: 1 }),
    aortica: criarValva('valvula_aortica', { raio: 0.13, cuspides: 3, material: materialValva, sentido: 1 }),
  };
  valvas.tricuspide.position.set(-0.45, 0.3, 0.12);
  valvas.mitral.position.set(0.32, 0.3, -0.25);
  valvas.pulmonar.position.set(0.1, 0.4, 0.38);
  valvas.aortica.position.set(-0.05, 0.36, -0.05);
  ventriculos.add(...Object.values(valvas));

  // Músculos papilares (no fundo de cada ventrículo) e cordas tendíneas, que os prendem às cúspides
  // da mitral e da tricúspide: quando o ventrículo contrai, elas impedem que a valva vire para o átrio
  const pecasPapilares = [];
  const cordas = [];
  const papilar = (base, topo, valva, raioValva, angulos) => {
    pecasPapilares.push(cilindroEntre(base, topo, 0.07, 0.035, 14), new THREE.SphereGeometry(0.036, 12, 8).translate(topo.x, topo.y, topo.z));
    for (const a of angulos) {
      const borda = valva.position.clone().add(new THREE.Vector3(Math.cos(a) * raioValva * 0.75, -0.06, -Math.sin(a) * raioValva * 0.75));
      cordas.push(cilindroEntre(topo, borda, 0.006, 0.005, 5));
    }
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  papilar(V(0.12, -0.64, -0.12), V(0.14, -0.34, -0.14), valvas.mitral, 0.16, [2.4, 3.0, 3.6, 4.2]);
  papilar(V(0.44, -0.62, -0.3), V(0.42, -0.33, -0.3), valvas.mitral, 0.16, [-0.6, 0.0, 0.6, 1.2]);
  papilar(V(-0.45, -0.52, 0.31), V(-0.45, -0.24, 0.29), valvas.tricuspide, 0.17, [4.4, 5.0, 5.6]);
  papilar(V(-0.62, -0.46, 0.14), V(-0.6, -0.2, 0.15), valvas.tricuspide, 0.17, [2.6, 3.2, 3.8]);
  const materialPapilar = musculo(corMusculo.clone().offsetHSL(0, -0.05, 0.08));
  const materialCorda = new THREE.MeshStandardMaterial({ color: '#f2ece0', roughness: 0.5 });
  ventriculos.add(
    marcarParte(new THREE.Mesh(mergeGeometries(pecasPapilares.map((g) => g.toNonIndexed())), materialPapilar), 'musculos_papilares'),
    marcarParte(new THREE.Mesh(mergeGeometries(cordas), materialCorda), 'musculos_papilares')
  );
  grupo.add(ventriculos);

  // posição de uma valva no espaço do coração, para ligar os vasos a ela
  ventriculos.updateMatrix();
  const saida = (valva) => valva.position.clone().applyMatrix4(ventriculos.matrix);

  // ---------- Átrios, apoiados na base ----------
  const corAtrio = corMusculo.clone().offsetHSL(-0.01, -0.1, 0.06);
  const atrio = (chave, { raio, escala, centro, semente, auricula }) => {
    const conjunto = new THREE.Group();
    conjunto.position.set(...centro);
    const casca = new THREE.Mesh(deformarComRuido(new THREE.SphereGeometry(raio, 64, 48), { amplitude: 0.02, frequencia: 2.4, semente }), musculo(corAtrio));
    casca.scale.set(...escala);
    const interior = new THREE.Mesh(virarParaDentro(new THREE.SphereGeometry(raio * 0.86, 40, 28)), parede(corAtrio.clone().offsetHSL(0, -0.08, 0.08)));
    interior.scale.set(...escala);
    // auricula: o pequeno lobo que sobressai na frente do átrio
    const lobo = new THREE.Mesh(deformarComRuido(new THREE.SphereGeometry(raio * 0.45, 32, 24), { amplitude: 0.025, frequencia: 4, semente }), musculo(corAtrio));
    lobo.scale.set(1.3, 0.6, 0.8);
    lobo.position.set(...auricula);
    conjunto.add(marcarParte(casca, chave), marcarParte(interior, chave), marcarParte(lobo, chave));
    return conjunto;
  };
  const atrioDireito = atrio('atrio_direito', { raio: 0.4, escala: [1, 1.05, 0.95], centro: [-0.72, 0.42, 0.08], semente: 3, auricula: [0.18, 0.28, 0.32] });
  const atrioEsquerdo = atrio('atrio_esquerdo', { raio: 0.38, escala: [1.25, 0.85, 0.95], centro: [0.08, 0.62, -0.5], semente: 4, auricula: [0.42, 0.12, 0.38] });
  grupo.add(atrioDireito, atrioEsquerdo);

  // ---------- Grandes vasos ----------
  const vaso = (chave, pontos, raio, cor) => {
    const curva = new THREE.CatmullRomCurve3(pontos.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
    return marcarParte(new THREE.Mesh(new THREE.TubeGeometry(curva, 96, raio, 24, false), musculo(cor)), chave);
  };
  const deslocar = (p, x, y, z) => p.clone().add(new THREE.Vector3(x, y, z));

  const corAorta = corMusculo.clone().offsetHSL(0, 0.05, 0.1);
  const a0 = saida(valvas.aortica);
  const aorta = new THREE.Group();
  aorta.add(
    // sobe atrás do tronco pulmonar, faz o arco para trás e para a esquerda e desce atrás do coração
    vaso('aorta', [a0, deslocar(a0, -0.05, 0.6, 0.02), deslocar(a0, 0.1, 1.15, -0.05), deslocar(a0, 0.45, 1.35, -0.4), deslocar(a0, 0.8, 1.15, -0.7), deslocar(a0, 0.85, 0.5, -0.8), deslocar(a0, 0.85, -0.6, -0.8)], 0.15, corAorta),
    // ramos do arco: tronco braquiocefálico, carótida comum e subclávia esquerdas
    vaso('aorta', [deslocar(a0, 0.12, 1.2, -0.1), deslocar(a0, 0.02, 1.65, -0.1), deslocar(a0, -0.05, 1.9, -0.1)], 0.055, corAorta),
    vaso('aorta', [deslocar(a0, 0.4, 1.32, -0.35), deslocar(a0, 0.42, 1.7, -0.37), deslocar(a0, 0.44, 1.9, -0.38)], 0.045, corAorta),
    vaso('aorta', [deslocar(a0, 0.62, 1.28, -0.55), deslocar(a0, 0.72, 1.62, -0.6), deslocar(a0, 0.8, 1.82, -0.62)], 0.045, corAorta)
  );

  // tronco pulmonar: sai na frente, sobe para a esquerda do paciente e se divide sob o arco da aorta
  const p0 = saida(valvas.pulmonar);
  const bifurcacao = deslocar(p0, 0.25, 0.65, -0.25);
  const tronco = new THREE.Group();
  tronco.add(
    vaso('arteria_pulmonar', [p0, deslocar(p0, 0.08, 0.35, -0.02), bifurcacao], 0.14, corVenosa),
    vaso('arteria_pulmonar', [bifurcacao, deslocar(bifurcacao, 0.4, 0.02, -0.15), deslocar(bifurcacao, 0.85, -0.08, -0.25)], 0.1, corVenosa),
    vaso('arteria_pulmonar', [bifurcacao, deslocar(bifurcacao, -0.3, 0.04, -0.3), deslocar(bifurcacao, -0.95, -0.02, -0.35)], 0.1, corVenosa)
  );

  // veias cavas chegam ao átrio direito; as quatro veias pulmonares, ao esquerdo
  const ad = atrioDireito.position;
  const veiasCavas = new THREE.Group();
  veiasCavas.add(
    vaso('veia_cava', [deslocar(ad, -0.05, 0.25, -0.05), deslocar(ad, -0.08, 0.9, -0.08), deslocar(ad, -0.08, 1.45, -0.1)], 0.13, corVenosa.clone().offsetHSL(0, 0, -0.06)),
    vaso('veia_cava', [deslocar(ad, 0.0, -0.25, -0.12), deslocar(ad, 0.02, -0.75, -0.2), deslocar(ad, 0.02, -1.15, -0.25)], 0.14, corVenosa.clone().offsetHSL(0, 0, -0.06))
  );
  const ae = atrioEsquerdo.position;
  const corVeiaPulmonar = corMusculo.clone().offsetHSL(0, 0.1, 0.08);
  const veiasPulmonares = new THREE.Group();
  for (const lado of [-1, 1]) {
    for (const altura of [0.12, -0.14]) {
      const inicio = deslocar(ae, lado * 0.3, altura, -0.12);
      veiasPulmonares.add(vaso('veias_pulmonares', [inicio, deslocar(inicio, lado * 0.35, altura * 0.3, -0.12), deslocar(inicio, lado * 0.75, altura * 0.6, -0.15)], 0.065, corVeiaPulmonar));
    }
  }
  grupo.add(aorta, tronco, veiasCavas, veiasPulmonares);

  // Ciclo cardíaco: átrios contraem antes dos ventrículos; as valvas seguem as pressões
  const periodo = 60 / bpm;
  const escalaAtrios = [atrioDireito, atrioEsquerdo].map((a) => a.scale.clone());
  function atualizar(t) {
    const fase = (t % periodo) / periodo;
    const contracaoAtrios = pulso(fase, 0.08, 0.05);
    const contracaoVentriculos = pulso(fase, 0.3, 0.07);

    [atrioDireito, atrioEsquerdo].forEach((a, i) => a.scale.copy(escalaAtrios[i]).multiplyScalar(1 - 0.07 * contracaoAtrios));
    ventriculos.scale.set(1 - 0.05 * contracaoVentriculos, 1 - 0.03 * contracaoVentriculos, 1 - 0.05 * contracaoVentriculos);
    aorta.scale.setScalar(1 + 0.015 * pulso(fase, 0.36, 0.08));

    // sístole (ventrículos contraindo): aórtica e pulmonar abertas, mitral e tricúspide fechadas
    const sistole = suave(0.18, 0.24, fase) * (1 - suave(0.4, 0.46, fase));
    valvas.aortica.userData.abrir(sistole);
    valvas.pulmonar.userData.abrir(sistole);
    valvas.mitral.userData.abrir(1 - suave(0.14, 0.2, fase) * (1 - suave(0.46, 0.54, fase)));
    valvas.tricuspide.userData.abrir(1 - suave(0.14, 0.2, fase) * (1 - suave(0.46, 0.54, fase)));
  }
  atualizar(0);

  return { objeto: grupo, atualizar };
}
