import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, marcarParte, virarParaDentro } from '../utils/geometria.js';

// Todas as medidas partem de um globo de raio 1 (a esclera). O eixo óptico é +Z.
const R_ESCLERA = 1;
const ABERTURA = 0.62; // ângulo (a partir do eixo) onde a esclera deixa a córnea aparecer
const R_CORNEA = 0.75;
const R_RETINA = 0.93;
const Z_IRIS = 0.8;
const R_IRIS = 0.575;

/** Calota esférica com o polo em +Z (a SphereGeometry tem o polo em +Y; gira-se 90° em X). */
function calota(raio, de, ate, segmentos = 64) {
  const geo = new THREE.SphereGeometry(raio, segmentos, Math.ceil(segmentos / 2), 0, Math.PI * 2, de, ate - de);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/**
 * Íris: anel de raio interno variável (a pupila). A geometria é refeita a cada quadro pela posição
 * da borda da pupila; as cores por vértice vêm de ruído em coordenadas polares, que desenha as
 * fibras radiais, e não mudam.
 */
function criarIris(cor, aleatorio) {
  const T = 96;
  const P = 10;
  const ruido = createNoise3D(aleatorio);
  const posicoes = new THREE.BufferAttribute(new Float32Array((P + 1) * (T + 1) * 3), 3);
  const cores = new Float32Array((P + 1) * (T + 1) * 3);
  const indices = [];
  const base = new THREE.Color(cor);
  const c = new THREE.Color();
  for (let j = 0; j <= P; j++) {
    const s = j / P;
    for (let i = 0; i <= T; i++) {
      const a = (i / T) * Math.PI * 2;
      const fibras = 0.5 + 0.5 * ruido(Math.cos(a) * 5, Math.sin(a) * 5, s * 1.4);
      const colarete = Math.exp(-(((s - 0.3) / 0.1) ** 2)) * 0.25; // anel mais claro em volta da pupila
      const limbo = s > 0.88 ? (s - 0.88) / 0.12 : 0; // borda externa escurece
      const borda = s < 0.08 ? 0.5 + s * 6 : 1; // contorno escuro da pupila
      const f = (0.6 + 0.55 * fibras + colarete) * (1 - 0.55 * limbo) * borda;
      c.copy(base).multiplyScalar(f);
      cores.set([c.r, c.g, c.b], (j * (T + 1) + i) * 3);
      if (j < P && i < T) {
        const a0 = j * (T + 1) + i;
        const b0 = (j + 1) * (T + 1) + i;
        indices.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posicoes);
  geo.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  geo.setIndex(indices);
  function definirPupila(raioPupila) {
    for (let j = 0; j <= P; j++) {
      const s = j / P;
      const r = raioPupila + (R_IRIS - raioPupila) * s;
      for (let i = 0; i <= T; i++) {
        const a = (i / T) * Math.PI * 2;
        posicoes.setXYZ(j * (T + 1) + i, r * Math.cos(a), r * Math.sin(a), Z_IRIS + 0.04 * (1 - s));
      }
    }
    posicoes.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }
  definirPupila(0.25);
  return { geo, definirPupila };
}

/**
 * Vasos da retina: ramos que partem do disco óptico e correm sobre a superfície da esfera. Cada passo
 * gira a direção em torno da normal da esfera (caminhada sorteada) e reprojeta o ponto sobre ela;
 * de vez em quando o ramo se divide.
 */
function criarVasos(origem, raioEsfera, aleatorio) {
  const arterias = [];
  const veias = [];
  const crescer = (inicio, direcao, passos, raio, profundidade, lista) => {
    const pontos = [inicio.clone()];
    let p = inicio.clone();
    const d = direcao.clone();
    for (let i = 0; i < passos; i++) {
      const normal = p.clone().normalize();
      d.applyAxisAngle(normal, (aleatorio() - 0.5) * 0.4);
      d.addScaledVector(normal, -d.dot(normal)).normalize();
      p = p.clone().addScaledVector(d, 0.075).setLength(raioEsfera);
      if (p.z > 0.35) break; // não passa da borda da retina
      pontos.push(p);
      if (profundidade > 0 && i > 1 && aleatorio() < 0.33) {
        const lado = aleatorio() < 0.5 ? -1 : 1;
        crescer(p, d.clone().applyAxisAngle(normal, lado * (0.5 + aleatorio() * 0.5)), Math.ceil(passos * 0.65), raio * 0.7, profundidade - 1, lista);
      }
    }
    if (pontos.length > 2) lista.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos), pontos.length * 3, raio, 5));
  };
  const normal = origem.clone().normalize();
  const u = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
  const v = normal.clone().cross(u);
  for (let k = 0; k < 6; k++) {
    const angulo = (k / 6) * Math.PI * 2 + 0.3;
    const direcao = u.clone().multiplyScalar(Math.cos(angulo)).addScaledVector(v, Math.sin(angulo));
    crescer(origem, direcao, 16, 0.0125, 2, k % 2 ? veias : arterias);
  }
  return [mergeGeometries(arterias), mergeGeometries(veias)];
}

/** Tubo com as duas pontas fechadas por esferas (o TubeGeometry deixa as pontas abertas). */
function tuboFechado(curva, segmentos, raio, lados) {
  const ponta = (p) => new THREE.SphereGeometry(raio, lados, Math.ceil(lados / 2)).translate(p.x, p.y, p.z);
  return mergeGeometries([
    new THREE.TubeGeometry(curva, segmentos, raio, lados),
    ponta(curva.getPoint(0)),
    ponta(curva.getPoint(1)),
  ]);
}

export function criarOlho(params, cores) {
  const { periodoPupila = 7, semente = 4 } = params;
  const aleatorio = criarAleatorio(semente);
  const olho = new THREE.Group();

  // esclera: globo com uma abertura na frente, onde se encaixa a córnea
  olho.add(marcarParte(
    new THREE.Mesh(calota(R_ESCLERA, ABERTURA, Math.PI, 96), new THREE.MeshPhysicalMaterial({ color: cores.secundaria, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 })),
    'esclera'
  ));

  // córnea: calota de raio menor, que abaula para a frente. Transmissão + índice de refração da córnea
  const abertura = R_ESCLERA * Math.sin(ABERTURA);
  const zBorda = R_ESCLERA * Math.cos(ABERTURA);
  const geoCornea = calota(R_CORNEA, 0, Math.asin(abertura / R_CORNEA), 64);
  geoCornea.translate(0, 0, zBorda - Math.sqrt(R_CORNEA ** 2 - abertura ** 2));
  const cornea = new THREE.Mesh(geoCornea, new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02,
    transmission: 1, thickness: 0.12, ior: 1.376, transparent: true, opacity: 0.35, depthWrite: false,
  }));
  cornea.renderOrder = 3;
  olho.add(marcarParte(cornea, 'cornea'));

  // íris com a pupila que abre e fecha, e um disco escuro atrás dela para a pupila parecer preta
  const iris = criarIris(cores.primaria, aleatorio);
  olho.add(marcarParte(new THREE.Mesh(iris.geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })), 'iris'));
  const fundoPupila = new THREE.Mesh(new THREE.CircleGeometry(R_IRIS, 48), new THREE.MeshStandardMaterial({ color: '#060606', roughness: 1 }));
  fundoPupila.position.z = Z_IRIS - 0.07;
  olho.add(marcarParte(fundoPupila, 'iris'));

  // cristalino: lente biconvexa transparente, achatada em Z
  const cristalino = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshPhysicalMaterial({ color: '#f6f0cf', roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.6, ior: 1.41 })
  );
  cristalino.position.z = 0.62;
  cristalino.scale.set(0.4, 0.4, 0.17);
  olho.add(marcarParte(cristalino, 'cristalino'));

  // corpo ciliar (anel de músculo) e zônulas (fibras que prendem o cristalino ao anel)
  const corCiliar = new THREE.MeshStandardMaterial({ color: '#b9786a', roughness: 0.6 });
  const anel = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 12, 56), corCiliar);
  anel.position.z = 0.68;
  olho.add(marcarParte(anel, 'corpo_ciliar'));
  const zonulas = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 4), new THREE.MeshStandardMaterial({ color: '#efe6d8', roughness: 0.7 }), 90);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    const de = new THREE.Vector3(0.58 * Math.cos(a), 0.58 * Math.sin(a), 0.68);
    const ate = new THREE.Vector3(0.41 * Math.cos(a), 0.41 * Math.sin(a), 0.62);
    const direcao = ate.clone().sub(de);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direcao.clone().normalize());
    m.compose(de.clone().add(ate).multiplyScalar(0.5), q, new THREE.Vector3(1, direcao.length(), 1));
    zonulas.setMatrixAt(i, m);
  }
  olho.add(marcarParte(zonulas, 'corpo_ciliar'));

  // humor vítreo: gel transparente atrás do cristalino
  const zVitreo = 0.45;
  olho.add(marcarParte(
    new THREE.Mesh(calota(0.9, Math.acos(zVitreo / 0.9), Math.PI, 48), new THREE.MeshPhysicalMaterial({ color: '#bfe3f0', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false })),
    'humor_vitreo'
  ));

  // retina: revestimento do fundo do olho, visto por dentro
  const retina = virarParaDentro(calota(R_RETINA, Math.acos(0.54 / R_RETINA), Math.PI, 64));
  const materialRetina = new THREE.MeshStandardMaterial({ color: '#cf5a3b', roughness: 0.7, side: THREE.FrontSide });
  materialRetina.userData.manterLado = true;
  olho.add(marcarParte(new THREE.Mesh(retina, materialRetina), 'retina'));

  // mácula (com a fóvea) no polo posterior; disco óptico mais para o lado do nariz
  const sobreRetina = (malha, direcao, raio) => {
    malha.position.copy(direcao.clone().normalize().multiplyScalar(raio));
    malha.lookAt(0, 0, 0); // o círculo (que olha para +Z) passa a olhar para o centro do globo
    return malha;
  };
  const macula = sobreRetina(new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), new THREE.MeshStandardMaterial({ color: '#dba23d', roughness: 0.8, side: THREE.DoubleSide })), new THREE.Vector3(0, 0, -1), R_RETINA - 0.002);
  const fovea = sobreRetina(new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), new THREE.MeshStandardMaterial({ color: '#7a3d14', roughness: 0.9, side: THREE.DoubleSide })), new THREE.Vector3(0, 0, -1), R_RETINA - 0.003);
  olho.add(marcarParte(macula, 'macula'), marcarParte(fovea, 'macula'));

  const direcaoDisco = new THREE.Vector3(-0.34, 0, -0.94).normalize();
  const disco = sobreRetina(new THREE.Mesh(new THREE.CircleGeometry(0.095, 32), new THREE.MeshStandardMaterial({ color: '#f1d68a', roughness: 0.7, side: THREE.DoubleSide })), direcaoDisco, R_RETINA - 0.002);
  olho.add(marcarParte(disco, 'nervo_optico'));
  const nervo = new THREE.Mesh(
    tuboFechado(new THREE.CatmullRomCurve3([
      direcaoDisco.clone().multiplyScalar(0.95),
      direcaoDisco.clone().multiplyScalar(1.35),
      direcaoDisco.clone().multiplyScalar(1.75).add(new THREE.Vector3(-0.1, 0.12, 0)),
      direcaoDisco.clone().multiplyScalar(2.2).add(new THREE.Vector3(-0.15, 0.2, 0)),
    ]), 32, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: '#efe0b8', roughness: 0.6 })
  );
  olho.add(marcarParte(nervo, 'nervo_optico'));

  // vasos da retina: arterias (vermelho vivo) e veias (vinho) a partir do disco
  const [geoArterias, geoVeias] = criarVasos(direcaoDisco.clone().multiplyScalar(R_RETINA - 0.004), R_RETINA - 0.004, aleatorio);
  olho.add(
    marcarParte(new THREE.Mesh(geoArterias, new THREE.MeshStandardMaterial({ color: '#d1453b', roughness: 0.5 })), 'vasos_da_retina'),
    marcarParte(new THREE.Mesh(geoVeias, new THREE.MeshStandardMaterial({ color: '#7b1f2e', roughness: 0.5 })), 'vasos_da_retina')
  );

  // quatro músculos retos: faixas que saem do fundo da órbita e se prendem à esclera
  const materialMusculo = new THREE.MeshStandardMaterial({ color: '#a8433b', roughness: 0.55 });
  const noEsfera = (raio, teta, fi) => new THREE.Vector3(raio * Math.sin(teta) * Math.cos(fi), raio * Math.sin(teta) * Math.sin(fi), raio * Math.cos(teta));
  for (let k = 0; k < 4; k++) {
    const fi = (k * Math.PI) / 2 + 0.2;
    const caminho = new THREE.CatmullRomCurve3([
      noEsfera(1.6, 2.95, fi), noEsfera(1.16, 2.5, fi), noEsfera(1.07, 2.1, fi), noEsfera(1.06, 1.75, fi), noEsfera(1.05, 1.4, fi), noEsfera(1.03, 1.1, fi),
    ]);
    const geo = tuboFechado(caminho, 40, 0.07, 10);
    olho.add(marcarParte(new THREE.Mesh(geo, materialMusculo), 'musculos_extraoculares'));
  }

  // o eixo óptico aponta para o lado direito da tela, meio de frente: dá para ver a íris e o perfil
  const raiz = new THREE.Group();
  olho.rotation.y = 1.0;
  raiz.add(olho);

  const omega = (Math.PI * 2) / periodoPupila;
  function atualizar(t) {
    const luz = 0.5 + 0.5 * Math.sin(t * omega); // 0 = escuro (pupila aberta), 1 = claro (fechada)
    iris.definirPupila(0.3 - 0.17 * luz);
    cristalino.scale.z = 0.165 + 0.02 * Math.sin(t * omega * 0.5); // acomodação: o cristalino engrossa e afina
  }

  return { objeto: raiz, atualizar };
}
