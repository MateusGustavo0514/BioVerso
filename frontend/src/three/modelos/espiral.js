import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, esferasInstanciadas, marcarParte } from '../utils/geometria.js';
import { criarHaloDaForma } from '../shaders/fresnel.js';
import { curvaSuperHelice } from './genomas.js';
import { Helice, particulasInstanciadas } from './bacilo.js';

/**
 * Eixo da célula. 'virgula': arco plano (Vibrio). 'helice': reta no X, com `gancho` opcional nas
 * duas pontas (Leptospira, em forma de ponto de interrogação). A hélice do corpo é enrolada depois.
 */
function criarEixo({ forma, comprimento, curvatura, gancho }) {
  const pontos = [];
  if (forma === 'virgula') {
    const r = comprimento / curvatura; // arco de comprimento `comprimento` e ângulo `curvatura`
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16 - 0.5) * curvatura;
      pontos.push(new THREE.Vector3(Math.sin(a) * r, r - Math.cos(a) * r, 0));
    }
  } else {
    const n = 14;
    for (let i = 0; i <= n; i++) pontos.push(new THREE.Vector3((i / n - 0.5) * comprimento, 0, 0));
    if (gancho) {
      // arco de raio `gancho` que vira ~140° em cada ponta, em lados opostos (simetria pelo centro)
      const arco = [];
      for (let i = 1; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 0.78;
        arco.push(new THREE.Vector3(comprimento / 2 + Math.sin(a) * gancho, gancho - Math.cos(a) * gancho, 0));
      }
      pontos.push(...arco);
      pontos.unshift(...arco.map((p) => p.clone().negate()).reverse());
    }
  }
  const curva = new THREE.CatmullRomCurve3(pontos, false, 'centripetal');
  curva.arcLengthDivisions = 2000;
  return curva;
}

/** Tubo ao longo da curva com as pontas fechadas por esferas. */
function tuboFechado(curva, segmentos, raio, radiais) {
  const inicio = curva.getPointAt(0);
  const fim = curva.getPointAt(1);
  return mergeGeometries([
    new THREE.TubeGeometry(curva, segmentos, raio, radiais, false),
    new THREE.SphereGeometry(raio, radiais, Math.ceil(radiais * 0.7)).translate(inicio.x, inicio.y, inicio.z),
    new THREE.SphereGeometry(raio, radiais, Math.ceil(radiais * 0.7)).translate(fim.x, fim.y, fim.z),
  ]);
}

/**
 * Bactéria curva ou espiralada: Vibrio (vírgula), Helicobacter (hélice curta), Leptospira e Treponema
 * (espiroquetas). O corpo é um tubo ao longo de uma hélice enrolada no eixo; os pontos internos usam
 * os referenciais de Frenet da mesma curva, então tudo acompanha as voltas.
 */
export function criarEspiral(params, cores) {
  const {
    forma = 'helice', comprimento = 3, raio = 0.3, voltas = 2, amplitude = 0.3, curvatura = 1.1, gancho = 0,
    semente = 5, ribossomos = 500, cromossomos = 1, raioMembrana = 0.8,
    chaveCorpo = 'membrana', chaveMembrana = 'membrana_plasmatica', chaveCromossomo = 'cromossomo',
    corDna = '#f0c75e', corRibossomo = '#6a5acd',
    flagelos, endoflagelos, pili = 0, particulas = [], giroCorpo = 0,
  } = params;
  const aleatorio = criarAleatorio(semente);
  const celula = new THREE.Group();

  const eixo = criarEixo({ forma, comprimento, curvatura, gancho });
  const curva = amplitude > 0 && forma === 'helice'
    ? curvaSuperHelice(eixo, { contas: voltas, voltasPorConta: 1, amplitude, continua: true, amostrasPorConta: 40 })
    : eixo;
  const extensao = curva.getLength();
  const segmentos = Math.max(160, Math.round(extensao / (raio * 0.25)));
  const { normals, binormals } = curva.computeFrenetFrames(segmentos, false);

  // Ponto à distância `r` do eixo do tubo, no ângulo `a` da seção transversal em `u`
  const pontoNaSecao = (u, r, a) => {
    const k = Math.round(u * segmentos);
    return curva.getPointAt(u).addScaledVector(normals[k], Math.cos(a) * r).addScaledVector(binormals[k], Math.sin(a) * r);
  };

  // Envoltório externo
  const corpo = new THREE.Mesh(
    tuboFechado(curva, segmentos, raio, 24),
    new THREE.MeshPhysicalMaterial({
      color: cores.primaria, roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.3, sheen: 0.6, sheenColor: new THREE.Color('#ffffff'),
    })
  );
  celula.add(marcarParte(corpo, chaveCorpo));

  // Membrana plasmática (nas espiroquetas, o cilindro protoplasmático), logo abaixo do envoltório
  celula.add(marcarParte(
    new THREE.Mesh(tuboFechado(curva, segmentos, raio * raioMembrana, 20), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(cores.primaria).offsetHSL(0, -0.1, 0.2), roughness: 0.5 })),
    chaveMembrana
  ));

  // Nucleoide: laço de DNA que vai e volta ao longo da célula (cada cromossomo ocupa um trecho)
  const passo = (raio * 0.7) / extensao;
  const lacos = Array.from({ length: cromossomos }, (_, c) => {
    const u0 = 0.06 + (c / cromossomos) * 0.88;
    const u1 = 0.06 + ((c + 1) / cromossomos) * 0.88 - (cromossomos > 1 ? 0.03 : 0);
    const pontos = [];
    for (const [de, ate] of [[u0, u1], [u1, u0]]) {
      const n = Math.max(4, Math.round(Math.abs(ate - de) / passo));
      for (let i = 0; i < n; i++) {
        const u = de + ((ate - de) * i) / n;
        pontos.push(pontoNaSecao(u, raio * raioMembrana * 0.55 * Math.sqrt(aleatorio()), aleatorio() * Math.PI * 2));
      }
    }
    const laco = new THREE.CatmullRomCurve3(pontos, true);
    laco.arcLengthDivisions = pontos.length * 20;
    return new THREE.TubeGeometry(laco, pontos.length * 12, raio * 0.05, 6, true);
  });
  celula.add(marcarParte(
    new THREE.Mesh(mergeGeometries(lacos), new THREE.MeshPhysicalMaterial({ color: corDna, roughness: 0.35, clearcoat: 0.5 })),
    chaveCromossomo
  ));

  // Ribossomos espalhados no citoplasma
  const posicoes = Array.from({ length: ribossomos }, () =>
    pontoNaSecao(0.02 + aleatorio() * 0.96, raio * raioMembrana * 0.85 * Math.sqrt(aleatorio()), aleatorio() * Math.PI * 2)
  );
  celula.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.07, corRibossomo, aleatorio, 8), 'ribossomos'));

  // Endoflagelos (espiroquetas): presos em cada ponta, correm no periplasma, entre o envoltório e o cilindro
  if (endoflagelos) {
    const { porPolo = 1, fracao = 0.45, giros = 1.5, chave = 'endoflagelos', cor = cores.secundaria } = endoflagelos;
    const raioTrilha = raio * (1 + raioMembrana) / 2;
    const trilhas = [];
    for (const polo of [0, 1]) {
      for (let k = 0; k < porPolo; k++) {
        const fase = (k / porPolo) * Math.PI * 2 + polo * 1.3;
        const pontos = [];
        const n = Math.max(12, Math.round((fracao * extensao) / (raio * 0.4)));
        for (let i = 0; i <= n; i++) {
          const s = i / n;
          const u = polo === 0 ? 0.01 + s * fracao : 0.99 - s * fracao;
          pontos.push(pontoNaSecao(u, raioTrilha, fase + s * giros * Math.PI * 2));
        }
        trilhas.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos), n * 6, raio * 0.07, 6, false));
      }
    }
    celula.add(marcarParte(new THREE.Mesh(mergeGeometries(trilhas), new THREE.MeshStandardMaterial({ color: cor, roughness: 0.5 })), chave));
  }

  // Pili na superfície (ex.: pilus corregulado pela toxina, do Vibrio)
  if (pili > 0) {
    const geoPilus = new THREE.CylinderGeometry(raio * 0.016, raio * 0.025, raio * 0.5, 5).translate(0, raio * 0.25, 0);
    const malha = new THREE.InstancedMesh(geoPilus, new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.6 }), pili);
    const cima = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < pili; i++) {
      const u = 0.05 + aleatorio() * 0.9;
      const a = aleatorio() * Math.PI * 2;
      const base = pontoNaSecao(u, raio * 0.97, a);
      const normal = base.clone().sub(curva.getPointAt(u)).normalize();
      m.compose(base, q.setFromUnitVectors(cima, normal), new THREE.Vector3(1, 0.6 + aleatorio(), 1));
      malha.setMatrixAt(i, m);
    }
    celula.add(marcarParte(malha, 'pili'));
  }

  // Flagelos polares, numa só ponta; `bainha` engrossa o tubo e `bulbo` põe a dilatação na ponta (H. pylori)
  const giros = [];
  if (flagelos) {
    const { quantidade = 1, comprimento: compFlagelo = 2.5, amplitude: ampFlagelo = 0.12, voltas: voltasFlagelo = 3, bainha = false, bulbo = false } = flagelos;
    const mat = new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.5 });
    const fim = curva.getPointAt(1);
    const tangente = curva.getTangentAt(1);
    const lateral = new THREE.Vector3();
    for (let i = 0; i < quantidade; i++) {
      const a = (i / quantidade) * Math.PI * 2 + aleatorio() * 0.4;
      lateral.copy(normals[segmentos]).multiplyScalar(Math.cos(a)).addScaledVector(binormals[segmentos], Math.sin(a));
      const abertura = quantidade > 1 ? 0.45 : 0;
      const direcao = tangente.clone().addScaledVector(lateral, abertura).normalize();
      const pivo = new THREE.Group();
      pivo.position.copy(fim).addScaledVector(direcao, raio * 0.92);
      pivo.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), direcao); // a hélice corre no -X local
      const giro = new THREE.Group();
      const helice = new Helice(compFlagelo * (0.85 + aleatorio() * 0.3), ampFlagelo, voltasFlagelo);
      giro.add(marcarParte(new THREE.Mesh(new THREE.TubeGeometry(helice, 160, raio * (bainha ? 0.1 : 0.06), 8), mat), 'flagelo'));
      if (bulbo) {
        const ponta = helice.getPoint(1);
        giro.add(marcarParte(new THREE.Mesh(new THREE.SphereGeometry(raio * 0.2, 16, 12).translate(ponta.x, ponta.y, ponta.z), mat), 'flagelo'));
      }
      giro.userData.velocidade = 7 + aleatorio() * 3;
      pivo.add(giro);
      celula.add(pivo);
      giros.push(giro);
    }
  }

  // Partículas soltas em volta (toxina da cólera) ou presas à superfície (urease do H. pylori)
  for (const { chave, quantidade = 16, cor = '#e0527a', forma: formaParticula = 'esfera', tamanho = 0.25, distancia = [1.7, 2.8] } of particulas) {
    const pos = Array.from({ length: quantidade }, () =>
      pontoNaSecao(0.04 + aleatorio() * 0.92, raio * (distancia[0] + aleatorio() * (distancia[1] - distancia[0])), aleatorio() * Math.PI * 2)
    );
    celula.add(marcarParte(particulasInstanciadas(pos, raio * tamanho, cor, formaParticula, aleatorio), chave));
  }

  // Halo que acompanha as voltas do corpo
  const halo = criarHaloDaForma(corpo.geometry, raio * 0.3, { cor: cores.primaria, intensidade: 0.7, potencia: 2.5 });
  celula.add(halo);

  const grupo = new THREE.Group();
  grupo.add(celula);

  function atualizar(t) {
    // espiroquetas e H. pylori giram no próprio eixo, como um saca-rolhas; o Vibrio só balança
    celula.rotation.x = giroCorpo ? t * giroCorpo : Math.sin(t * 0.7) * 0.08;
    giros.forEach((g) => (g.rotation.x = t * g.userData.velocidade));
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar, foco: corpo };
}
