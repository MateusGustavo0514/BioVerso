import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, cilindroEntre, esferasInstanciadas, marcarParte } from '../utils/geometria.js';

/**
 * Formata uma esfera unitária no formato de um pulmão.
 * lado = -1 (pulmão direito do paciente, à esquerda da tela) ou +1 (esquerdo).
 */
function geometriaPulmao(lado, semente, cor) {
  const geo = new THREE.SphereGeometry(1, 96, 72);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const medial = v.x * -lado > 0; // face voltada para o centro do tórax

    if (medial) v.x *= 0.45; // face medial achatada (onde fica o coração)
    if (lado > 0 && medial && v.y > -0.7 && v.y < 0.15) v.x *= 0.35; // incisura cardíaca
    if (v.y < -0.55) v.y = -0.55 + (v.y + 0.55) * 0.3; // base apoiada no diafragma
    const afinar = 1 - 0.4 * Math.max(v.y, 0); // ápice mais estreito
    v.x *= afinar;
    v.z *= afinar;

    v.x *= 0.8;
    v.y *= 1.35;
    v.z *= 0.7;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const forma = deformarComRuido(geo, { amplitude: 0.035, frequencia: 1.8, semente });

  // Fissuras: sulcos fundos que separam os lobos. A oblíqua (nos dois pulmões) desce de trás e do alto
  // para a frente e para baixo; a horizontal (só no direito) separa o lobo superior do médio.
  // Cada lobo ganha um tom levemente diferente, e a linha da fissura fica mais escura.
  const p = forma.attributes.position;
  const n = forma.attributes.normal;
  const cores = new Float32Array(p.count * 3);
  const base = new THREE.Color(cor);
  const tons = { superior: base.clone().offsetHSL(0, 0, 0.05), medio: base.clone().offsetHSL(0.04, 0.05, 0.02), inferior: base.clone().offsetHSL(-0.04, -0.05, -0.02) };
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    const obliqua = (y + 0.02 + 0.82 * z) / 1.29; // distância (no plano y-z) até a fissura oblíqua
    const horizontal = lado < 0 && obliqua > 0 && z > -0.15 ? y - 0.28 : Infinity; // só no pulmão direito
    const fissura = Math.exp(-((obliqua / 0.04) ** 2)) + Math.exp(-((horizontal / 0.04) ** 2));
    const fundura = 0.1 * Math.min(fissura, 1);
    p.setXYZ(i, p.getX(i) - n.getX(i) * fundura, y - n.getY(i) * fundura, z - n.getZ(i) * fundura);
    const lobo = obliqua < 0 ? 'inferior' : horizontal < 0 ? 'medio' : 'superior';
    c.copy(tons[lobo]).multiplyScalar(1 - 0.5 * Math.min(fissura, 1));
    cores.set([c.r, c.g, c.b], i * 3);
  }
  forma.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  forma.computeVertexNormals();
  return forma;
}

/**
 * Árvore brônquica recursiva: cada ramo se divide em dois, menor e mais fino.
 * `ramos` guarda cada segmento, para os vasos e os alvéolos seguirem a mesma árvore.
 */
function geometriaArvore({ inicio, direcao, comprimento, raio, profundidade, centro, limites, aleatorio, saida, ramos }) {
  const fim = inicio.clone().addScaledVector(direcao, comprimento);
  const rel = fim.clone().sub(centro);
  const dentro = (rel.x / limites.x) ** 2 + (rel.y / limites.y) ** 2 + (rel.z / limites.z) ** 2 < 1;
  if (!dentro) return;

  saida.push(cilindroEntre(inicio, fim, raio, raio * 0.75, 8));
  const ramo = { inicio, fim, raio, terminal: true };
  ramos.push(ramo);
  if (profundidade === 0) return;

  const antes = ramos.length;
  for (const sinal of [-1, 1]) {
    const eixo = new THREE.Vector3().crossVectors(direcao, new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5)).normalize();
    const novaDirecao = direcao.clone().applyAxisAngle(eixo, sinal * (0.3 + aleatorio() * 0.3)).normalize();
    geometriaArvore({
      inicio: fim, direcao: novaDirecao, comprimento: comprimento * (0.7 + aleatorio() * 0.12),
      raio: raio * 0.72, profundidade: profundidade - 1, centro, limites, aleatorio, saida, ramos,
    });
  }
  ramo.terminal = ramos.length === antes; // nenhum filho coube no pulmão: é a ponta de um bronquíolo
}

/**
 * Vasos que acompanham os brônquios: a artéria corre de um lado e a veia do outro.
 * O lado é a direção "para a frente" sem a componente do ramo (Gram-Schmidt), então
 * muda pouco de um segmento para o seguinte e o vaso não se quebra nas bifurcações.
 */
function geometriaVasos(ramos, sinal, espessura) {
  const frente = new THREE.Vector3(0, 0, 1);
  return mergeGeometries(
    ramos.map(({ inicio, fim, raio }) => {
      const direcao = fim.clone().sub(inicio).normalize();
      const lado = frente.clone().addScaledVector(direcao, -frente.dot(direcao)).normalize().multiplyScalar(sinal * raio * 1.6);
      return cilindroEntre(inicio.clone().add(lado), fim.clone().add(lado), raio * espessura, raio * espessura * 0.78, 6);
    })
  );
}

export function criarPulmoes(params, cores) {
  const {
    respiracoesPorMinuto = 14, ramificacoes = 5, semente = 5,
    corArteria = '#4f6fc0', corVeia = '#c8423f', corAlveolo = '#f6a9b9',
  } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  const corPulmao = new THREE.Color(cores.primaria);
  const corCartilagem = new THREE.Color(cores.secundaria);

  // Material semitransparente: permite ver a árvore brônquica por dentro
  const materialPulmao = () =>
    new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.55, sheen: 1, sheenColor: '#ffd6dc',
      transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
      userData: { interiorCheio: '#e8a3ae' }, // cortado, o tecido aparece cheio (rosa esponjoso)
    });
  const materialVia = new THREE.MeshPhysicalMaterial({ color: corCartilagem, roughness: 0.4, clearcoat: 0.6, userData: { interiorCheio: true } });
  const materialVaso = (cor) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.4, clearcoat: 0.5, userData: { interiorCheio: true } });

  // Traqueia com anéis de cartilagem em "C" (TorusGeometry com arco incompleto)
  const traqueia = new THREE.Group();
  const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 1.1, 32, 1, true), materialVia);
  tubo.position.y = 1.55;
  traqueia.add(marcarParte(tubo, 'traqueia'));
  const aneis = new THREE.InstancedMesh(new THREE.TorusGeometry(0.135, 0.025, 8, 32, Math.PI * 1.6), materialVia, 14);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 14; i++) {
    m.makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationY(Math.PI * 0.7)).setPosition(0, 1.08 + i * 0.07, 0);
    aneis.setMatrixAt(i, m);
  }
  traqueia.add(marcarParte(aneis, 'traqueia'));
  grupo.add(traqueia);

  const carina = new THREE.Vector3(0, 1.0, 0);
  const lados = [];

  for (const [lado, chave] of [[-1, 'pulmao_direito'], [1, 'pulmao_esquerdo']]) {
    const conjunto = new THREE.Group();
    const centro = new THREE.Vector3(lado * 0.78, 0, 0);
    const escalaLado = lado < 0 ? 1.05 : 1; // o direito é um pouco maior

    const pulmao = new THREE.Mesh(geometriaPulmao(lado, semente + lado, corPulmao), materialPulmao());
    pulmao.position.copy(centro);
    pulmao.scale.setScalar(escalaLado);
    pulmao.renderOrder = 2;
    conjunto.add(marcarParte(pulmao, chave));

    // Brônquio principal + árvore dentro do pulmão
    const hilo = new THREE.Vector3(lado * 0.4, 0.4, 0);
    const pedacos = [cilindroEntre(carina, hilo, 0.09, 0.075, 12)];
    const ramos = [{ inicio: carina, fim: hilo, raio: 0.09, terminal: false }];
    // Um brônquio lobar para cada lobo: três no pulmão direito, dois no esquerdo
    const lobares = lado < 0
      ? [[0.45, 0.9, 0], [1, -0.15, 0.25], [0.5, -1, -0.1]] // superior, médio, inferior
      : [[0.55, 0.85, 0], [0.55, -1, 0]]; // superior, inferior
    for (const [x, y, z] of lobares) {
      geometriaArvore({
        inicio: hilo,
        direcao: new THREE.Vector3(lado * x, y, z).normalize(),
        comprimento: 0.3,
        raio: 0.055,
        profundidade: ramificacoes,
        centro,
        limites: new THREE.Vector3(0.68, 1.1, 0.56).multiplyScalar(escalaLado),
        aleatorio,
        saida: pedacos,
        ramos,
      });
    }
    const arvore = new THREE.Mesh(mergeGeometries(pedacos), materialVia);
    conjunto.add(marcarParte(arvore, 'bronquios'));

    // Interior: artérias (sangue pobre em oxigênio, azul) de um lado dos brônquios, veias do outro
    conjunto.add(
      marcarParte(new THREE.Mesh(geometriaVasos(ramos, 1, 0.7), materialVaso(corArteria)), 'arterias_pulmonares'),
      marcarParte(new THREE.Mesh(geometriaVasos(ramos, -1, 0.62), materialVaso(corVeia)), 'veias_pulmonares')
    );

    // Alvéolos: um cacho na ponta de cada bronquíolo (cada esfera representa milhares de alvéolos reais)
    const cachos = ramos.filter((r) => r.terminal).flatMap(({ inicio, fim }) => {
      const centroCacho = fim.clone().addScaledVector(fim.clone().sub(inicio).normalize(), 0.035);
      return Array.from({ length: 7 }, () => {
        const desvio = new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
        return centroCacho.clone().addScaledVector(desvio, 0.032 * Math.sqrt(aleatorio()));
      });
    });
    conjunto.add(marcarParte(esferasInstanciadas(cachos, 0.026, corAlveolo, aleatorio, 10), 'alveolos'));

    grupo.add(conjunto);
    lados.push(conjunto);
  }

  const omega = (respiracoesPorMinuto / 60) * Math.PI * 2;
  function atualizar(t) {
    const r = (Math.sin(t * omega) + 1) / 2; // 0 = expiração, 1 = inspiração
    for (const conjunto of lados) conjunto.scale.set(1 + 0.04 * r, 1 + 0.025 * r, 1 + 0.05 * r);
  }

  return { objeto: grupo, atualizar };
}
