import * as THREE from 'three';
import {
  criarAleatorio, deformarComRuido, marcarParte, dividirPorPlano, virarParaDentro,
  arvoreRamificada, geometriaDosRamos,
} from '../utils/geometria.js';

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

export function criarFigado(params, cores) {
  const { semente = 11, lobulos = 420, ramificacoes = 4, respiracoesPorMinuto = 14 } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  const figado = geometriaFigado(semente);
  const material = () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: '#ff9a82' });
  const [geoEsquerdo, geoDireito] = dividirPorPlano(figado, new THREE.Vector3(1, 0, 0), X_SULCO);
  grupo.add(marcarParte(new THREE.Mesh(geoDireito, material()), 'lobo_direito'));
  grupo.add(marcarParte(new THREE.Mesh(geoEsquerdo, material()), 'lobo_esquerdo'));

  // parênquima por dentro: a mesma forma, menor e virada do avesso, para o corte mostrar uma cavidade iluminada
  const miolo = virarParaDentro(figado.clone());
  miolo.scale(0.93, 0.9, 0.93);
  const materialMiolo = new THREE.MeshStandardMaterial({ color: '#b9573f', roughness: 0.7, side: THREE.FrontSide });
  materialMiolo.userData.manterLado = true;
  grupo.add(marcarParte(new THREE.Mesh(miolo, materialMiolo), 'lobulos'));

  // aproximação do volume interno (elipsoide), para os vasos e lóbulos ficarem dentro do órgão
  const dentro = (ponto, folga = 0.55) => {
    const x = ponto.x / COMPRIMENTO;
    const e = suave(0, 1, x);
    const ay = ALTURA * (ponto.y > 0 ? 1 : 0.5) * (1 - 0.62 * e);
    const az = PROFUNDIDADE * (1 - 0.35 * e);
    return x * x + (ponto.y / ay) ** 2 + (ponto.z / az) ** 2 < folga;
  };

  // lóbulos hepáticos: prismas de seis lados com uma veia central, sorteados sem se encostarem
  const prismas = [];
  for (let tentativas = 0; prismas.length < lobulos && tentativas < lobulos * 40; tentativas++) {
    const ponto = new THREE.Vector3((aleatorio() * 2 - 1) * COMPRIMENTO, (aleatorio() * 2 - 1) * ALTURA, (aleatorio() * 2 - 1) * PROFUNDIDADE);
    if (!dentro(ponto, 0.5) || prismas.some((o) => o.distanceToSquared(ponto) < 0.15 * 0.15)) continue;
    prismas.push(ponto);
  }
  const malhaPrismas = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.085, 6),
    new THREE.MeshStandardMaterial({ color: '#d98a6c', roughness: 0.55 }),
    prismas.length
  );
  const malhaVeiaCentral = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6),
    new THREE.MeshStandardMaterial({ color: '#8a2b3c', roughness: 0.5 }),
    prismas.length
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  prismas.forEach((ponto, i) => {
    q.setFromEuler(new THREE.Euler(aleatorio() * Math.PI, aleatorio() * Math.PI, aleatorio() * Math.PI));
    m.compose(ponto, q, new THREE.Vector3(1, 1, 1));
    malhaPrismas.setMatrixAt(i, m);
    malhaVeiaCentral.setMatrixAt(i, m);
  });
  grupo.add(marcarParte(malhaPrismas, 'lobulos'), marcarParte(malhaVeiaCentral, 'lobulos'));

  // vasos: três árvores recursivas. Porta, artéria e ductos correm juntos (a tríade portal);
  // as veias hepáticas descem de cima, entre eles.
  const material_vaso = (cor) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.4, clearcoat: 0.5 });
  const hilo = new THREE.Vector3(-0.1, -0.4, 0.25);
  const ramosPorta = [];
  for (const [direcao, comprimento] of [[new THREE.Vector3(-1, 0.45, -0.1), 0.6], [new THREE.Vector3(0.9, 0.45, -0.05), 0.5]]) {
    arvoreRamificada({
      inicio: hilo, direcao: direcao.normalize(), comprimento, raio: 0.075, profundidade: ramificacoes,
      dentro: (ponto) => dentro(ponto, 0.5), aleatorio, ramos: ramosPorta, abertura: 0.7, reducaoComprimento: 0.78,
    });
  }
  const frente = new THREE.Vector3(0, 0, 1);
  const ladoDoRamo = (sinal) => (ramo) => {
    const d = ramo.fim.clone().sub(ramo.inicio).normalize();
    return frente.clone().addScaledVector(d, -frente.dot(d)).normalize().multiplyScalar(sinal * ramo.raio * 1.9);
  };
  grupo.add(marcarParte(new THREE.Mesh(geometriaDosRamos(ramosPorta, { lados: 8 }), material_vaso('#5b6bc0')), 'veia_porta'));
  grupo.add(marcarParte(new THREE.Mesh(geometriaDosRamos(ramosPorta, { espessura: 0.42, lados: 6, deslocamento: ladoDoRamo(1) }), material_vaso('#d6403a')), 'arteria_hepatica'));
  const ductosIntra = new THREE.Mesh(geometriaDosRamos(ramosPorta, { espessura: 0.42, lados: 6, deslocamento: ladoDoRamo(-1) }), material_vaso('#7ea34a'));
  grupo.add(marcarParte(ductosIntra, 'ductos_biliares'));

  const ramosVeias = [];
  for (const direcao of [new THREE.Vector3(-0.7, -0.55, 0.3), new THREE.Vector3(0.75, -0.5, 0.25), new THREE.Vector3(0, -0.5, 0.85)]) {
    arvoreRamificada({
      inicio: new THREE.Vector3(0, 0.65, -0.55), direcao: direcao.normalize(), comprimento: 0.55, raio: 0.07, profundidade: ramificacoes - 1,
      dentro: (ponto) => dentro(ponto, 0.5), aleatorio, ramos: ramosVeias, abertura: 0.7, reducaoComprimento: 0.78,
    });
  }
  grupo.add(marcarParte(new THREE.Mesh(geometriaDosRamos(ramosVeias, { lados: 8 }), material_vaso('#33449a')), 'veias_hepaticas'));

  // fora do órgão: veia cava inferior (atrás), tronco da veia porta, artéria e colédoco
  const tubo = (pontos, raio, cor, chave) => {
    const malha = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos), 40, raio, 12), material_vaso(cor));
    grupo.add(marcarParte(malha, chave));
    return malha;
  };
  tubo([new THREE.Vector3(0.0, 1.25, -0.9), new THREE.Vector3(0.0, 0.7, -0.96), new THREE.Vector3(0.0, -0.2, -0.9), new THREE.Vector3(0.0, -0.8, -0.8)], 0.09, '#33449a', 'veias_hepaticas');
  const junta = new THREE.Vector3(-0.05, -0.65, 0.3);
  tubo([new THREE.Vector3(0.45, -1.25, 0.55), new THREE.Vector3(0.2, -0.85, 0.4), hilo.clone().add(new THREE.Vector3(0, -0.04, 0))], 0.09, '#5b6bc0', 'veia_porta');
  tubo([new THREE.Vector3(0.6, -1.2, 0.35), new THREE.Vector3(0.3, -0.8, 0.28), hilo.clone().add(new THREE.Vector3(0.1, -0.03, -0.02))], 0.035, '#d6403a', 'arteria_hepatica');
  tubo([hilo.clone().add(new THREE.Vector3(-0.08, -0.03, 0.04)), junta, new THREE.Vector3(0.15, -1.0, 0.3), new THREE.Vector3(0.3, -1.3, 0.35)], 0.04, '#7ea34a', 'ductos_biliares');

  // vesícula biliar (pera) sob o lobo direito, e o ducto cístico até o colédoco
  const vesicula = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshPhysicalMaterial({ color: cores.secundaria, roughness: 0.35, clearcoat: 0.7, transparent: true, opacity: 0.92 })
  );
  vesicula.scale.set(0.17, 0.4, 0.17);
  vesicula.position.set(-0.7, -0.5, 0.42);
  vesicula.rotation.z = -1.0;
  grupo.add(marcarParte(vesicula, 'vesicula_biliar'));
  tubo([new THREE.Vector3(-0.58, -0.68, 0.42), new THREE.Vector3(-0.35, -0.7, 0.38), junta], 0.03, '#7ea34a', 'ductos_biliares');

  // ligamento falciforme: lâmina fina na face da frente, no sulco entre os lobos
  const ligamento = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: '#e4c7a6', roughness: 0.7 }));
  ligamento.scale.set(0.012, 0.5, 0.17);
  ligamento.position.set(X_SULCO, 0.28, 0.76);
  grupo.add(marcarParte(ligamento, 'ligamento_falciforme'));

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
