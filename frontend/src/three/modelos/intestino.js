import * as THREE from 'three';
import { criarAleatorio, marcarParte, tuboDeRaioVariavel, fatiarTubo } from '../utils/geometria.js';

/**
 * Intestino delgado: um tubo muito longo dobrado em alças (curva Catmull-Rom por fileiras que
 * vão e voltam) com duas paredes, como o estômago. A parede de dentro, virada do avesso, tem as
 * pregas circulares (modulação periódica do raio) e é coberta por vilosidades instanciadas, que
 * apontam para o centro do tubo. Uma onda de contração percorre o tubo, e as vilosidades a acompanham.
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
  const PAREDE = 0.8; // raio interno em relação ao externo
  const PREGAS = 64; // quantidade de pregas circulares ao longo do tubo
  const omegaOnda = ondasPorMinuto / 60;
  // onda de contração que corre pelo tubo: cada crista estreita um pouco o raio
  const onda = (u, t) => 1 - 0.09 * (0.5 + 0.5 * Math.cos(Math.PI * 2 * (u * 9 - t * omegaOnda))) ** 3;
  // pregas circulares: anéis que avançam para dentro do tubo
  const pregas = (u) => 1 - 0.2 * (0.5 + 0.5 * Math.cos(Math.PI * 2 * u * PREGAS)) ** 3;

  const segmentos = 560;
  const lados = 16;
  const externo = tuboDeRaioVariavel(eixo, { raio: (u, t) => RAIO * onda(u, t), segmentos, lados });
  const interno = tuboDeRaioVariavel(eixo, {
    raio: (u, t) => RAIO * PAREDE * onda(u, t),
    modulacao: (u) => pregas(u),
    segmentos, lados, paraDentro: true,
  });

  const parede = (cor) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.45, clearcoat: 0.45, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: '#ffd0c4' });
  const base = new THREE.Color(cores.primaria);
  const materialMucosa = new THREE.MeshStandardMaterial({ color: new THREE.Color(cores.secundaria).offsetHSL(0, 0.1, -0.1), roughness: 0.6, side: THREE.FrontSide });
  materialMucosa.userData.manterLado = true;

  // três trechos clicáveis (os mesmos vértices): duodeno, jejuno e íleo, em tons um pouco diferentes
  const [geoDuodeno, geoJejuno, geoIleo] = fatiarTubo(externo, [0, 0.07, 0.4, 1]);
  grupo.add(marcarParte(new THREE.Mesh(geoDuodeno, parede(base.clone().offsetHSL(0.02, 0, -0.07))), 'duodeno'));
  grupo.add(marcarParte(new THREE.Mesh(geoJejuno, parede(base.clone().offsetHSL(0, 0.05, 0))), 'jejuno'));
  grupo.add(marcarParte(new THREE.Mesh(geoIleo, parede(base.clone().offsetHSL(-0.01, -0.05, 0.05))), 'ileo'));
  grupo.add(marcarParte(new THREE.Mesh(interno.geometria, materialMucosa), 'pregas_circulares'));

  // vilosidades: cones minúsculos na parede de dentro, apontando para o eixo do tubo
  const COMPRIMENTO = 0.05;
  const geometriaVilo = new THREE.ConeGeometry(0.011, COMPRIMENTO, 6, 1);
  geometriaVilo.translate(0, COMPRIMENTO / 2, 0); // a base fica na origem
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
      // a base fica na parede interna (já com a prega) e a ponta aponta para o centro
      const fator = PAREDE * pregas(v.u) * onda(v.u, t);
      interno.pontoNaSecao(v.u, v.a, fator, p);
      interno.direcaoNaSecao(v.u, v.a, dir).negate();
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
    externo.atualizar(t);
    interno.atualizar(t);
    posicionarVilos(t);
  }

  return { objeto: grupo, atualizar };
}
