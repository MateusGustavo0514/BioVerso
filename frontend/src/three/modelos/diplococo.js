import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, curvaNovelo, esferasInstanciadas, marcarParte } from '../utils/geometria.js';

/**
 * Molda uma célula do par, com o X local apontando para fora (o parceiro fica em -X).
 * 'lanceta' (pneumococo): alongada e afinada na ponta externa, achatada no lado do par.
 * 'rim' (meningococo): lado do par achatado e levemente côncavo, como um grão de café.
 * Serve para os vértices da parede e para os pontos do interior, que assim acompanham a forma.
 */
function criarMolde(forma, raio) {
  return (v) => {
    const u = THREE.MathUtils.clamp(v.x / raio, -1, 1);
    const rho2 = Math.min((v.y * v.y + v.z * v.z) / (raio * raio), 1);
    if (forma === 'lanceta') {
      const afinar = u > 0 ? 1 - 0.45 * u * u : 1;
      return v.set(v.x * (u > 0 ? 1.3 : 0.85), v.y * afinar, v.z * afinar);
    }
    if (u < 0) v.x = v.x * 0.42 + raio * 0.24 * (1 - rho2) ** 2; // achata e afunda o centro da face
    return v.set(v.x, v.y * 1.08, v.z);
  };
}

/** Aplica o molde a todos os vértices de uma geometria. */
function moldarGeometria(geo, molde) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, ...molde(v.fromBufferAttribute(pos, i)).toArray());
  geo.computeVertexNormals();
  return geo;
}

/**
 * Diplococo: pares de células encostadas (Streptococcus pneumoniae, em cadeia curta; Neisseria
 * meningitidis, em par). Cada parte junta as geometrias de todas as células numa malha só; a cápsula
 * de polissacarídeo é um elipsoide semitransparente em volta de cada par.
 */
export function criarDiplococo(params, cores) {
  const {
    forma = 'lanceta', raio = 0.5, pares = 1, semente = 9, ribossomos = 140,
    capsula = true, septo = false, pili = 0, vesiculas = 0, raioMembrana = 0.82,
    chaveParede = 'parede_celular', corCapsula, corSepto = '#e8dcc0', corDna = '#f0c75e', corRibossomo = '#6a5acd',
  } = params;
  const aleatorio = criarAleatorio(semente);
  const molde = criarMolde(forma, raio);

  // Distância do centro de cada célula ao meio do par: as faces se tocam (com o septo no meio)
  const recuo = forma === 'lanceta' ? raio * 0.72 : raio * 0.25;
  const meioPar = recuo + raio * (forma === 'lanceta' ? 1.3 : 1);
  const geoParede = deformarComRuido(new THREE.SphereGeometry(raio, 56, 40), { amplitude: raio * 0.02, frequencia: 3 / raio, semente });
  moldarGeometria(geoParede, molde);
  const geoMembrana = geoParede.clone().scale(raioMembrana, raioMembrana, raioMembrana);

  // Cadeia curta: pares em fila, com uma leve curva
  const matrizesPar = Array.from({ length: pares }, (_, p) => {
    const desvio = pares > 1 ? (p - (pares - 1) / 2) : 0;
    const angulo = desvio * 0.35;
    const posicao = new THREE.Vector3(desvio * (meioPar * 2 + raio * 0.25), -Math.abs(desvio) * raio * 0.35, 0);
    return new THREE.Matrix4().compose(
      posicao,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(aleatorio() * 0.6, 0, -angulo)),
      new THREE.Vector3(1, 1, 1)
    );
  });

  // Cada célula: o lado +1 fica em +X; o lado -1 é a mesma célula girada 180° em Y (sem espelhar)
  const matrizesCelula = matrizesPar.flatMap((par) => [1, -1].map((lado) =>
    new THREE.Matrix4().makeRotationY(lado > 0 ? 0 : Math.PI).setPosition(lado * recuo, 0, 0).premultiply(par)
  ));

  const juntar = (geo, matrizes) => mergeGeometries(matrizes.map((m) => geo.clone().applyMatrix4(m)));
  const conjunto = new THREE.Group();

  // Parede (pneumococo, Gram-positivo) ou membrana externa (meningococo, Gram-negativo)
  const paredes = new THREE.Mesh(
    juntar(geoParede, matrizesCelula),
    new THREE.MeshPhysicalMaterial({ color: cores.primaria, roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color('#ffffff') })
  );
  conjunto.add(marcarParte(paredes, chaveParede));

  const corMembrana = new THREE.Color(cores.primaria).offsetHSL(0, -0.1, 0.2);
  conjunto.add(marcarParte(new THREE.Mesh(juntar(geoMembrana, matrizesCelula), new THREE.MeshPhysicalMaterial({ color: corMembrana, roughness: 0.5 })), 'membrana_plasmatica'));

  // Septo: o disco de parede que se forma na divisão e mantém as duas células unidas
  if (septo) {
    const disco = new THREE.CylinderGeometry(raio * 0.52, raio * 0.52, raio * 0.07, 40).rotateZ(Math.PI / 2);
    conjunto.add(marcarParte(new THREE.Mesh(juntar(disco, matrizesPar), new THREE.MeshPhysicalMaterial({ color: corSepto, roughness: 0.6 })), 'septo'));
  }

  // Nucleoide de cada célula, com os pontos de controle moldados como a célula
  const cromossomos = matrizesCelula.map((m) => {
    const curva = curvaNovelo({ raioMin: raio * 0.15, raioMax: raio * 0.45, pontos: 44, aleatorio, fechada: true });
    curva.points.forEach((p) => molde(p.add(new THREE.Vector3(raio * 0.12, 0, 0))));
    curva.arcLengthDivisions = 800;
    return new THREE.TubeGeometry(curva, 700, raio * 0.024, 6, true).applyMatrix4(m);
  });
  conjunto.add(marcarParte(new THREE.Mesh(mergeGeometries(cromossomos), new THREE.MeshPhysicalMaterial({ color: corDna, roughness: 0.35, clearcoat: 0.5 })), 'cromossomo'));

  // Ribossomos: entre o nucleoide e a membrana de cada célula
  const pontos = matrizesCelula.flatMap((m) => Array.from({ length: ribossomos }, () => {
    const direcao = new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
    return molde(direcao.multiplyScalar(raio * raioMembrana * (0.45 + 0.45 * Math.cbrt(aleatorio())))).applyMatrix4(m);
  }));
  conjunto.add(marcarParte(esferasInstanciadas(pontos, raio * 0.04, corRibossomo, aleatorio, 6), 'ribossomos'));

  // Ponto da superfície de uma célula, longe da face do par, e a direção para fora
  const pontoSuperficie = (m) => {
    let direcao;
    do direcao = new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
    while (direcao.x < -0.3);
    const local = molde(direcao.clone().multiplyScalar(raio));
    return { base: local.clone().applyMatrix4(m), fora: direcao.transformDirection(m) };
  };

  // Pili tipo IV (meningococo): filamentos longos e finos que prendem a bactéria às células
  if (pili > 0) {
    const fios = Array.from({ length: pili }, (_, i) => {
      const { base, fora } = pontoSuperficie(matrizesCelula[i % matrizesCelula.length]);
      const comprimento = raio * (0.9 + aleatorio() * 1.1);
      const curva = new THREE.CatmullRomCurve3([0, 0.35, 0.7, 1].map((s) => base.clone()
        .addScaledVector(fora, s * comprimento)
        .add(new THREE.Vector3(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).multiplyScalar(s * raio * 0.35))));
      return new THREE.TubeGeometry(curva, 24, raio * 0.014, 5, false);
    });
    conjunto.add(marcarParte(new THREE.Mesh(mergeGeometries(fios), new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.6 })), 'pili'));
  }

  // Vesículas de membrana externa: bolhas que se soltam levando endotoxina (LPS)
  if (vesiculas > 0) {
    const posicoes = Array.from({ length: vesiculas }, (_, i) => {
      const { base, fora } = pontoSuperficie(matrizesCelula[i % matrizesCelula.length]);
      const solta = aleatorio() < 0.25;
      return base.addScaledVector(fora, raio * (solta ? 0.3 + aleatorio() * 0.4 : 0.03));
    });
    conjunto.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.08, cores.secundaria, aleatorio, 12), 'vesiculas'));
  }

  // Cápsula de polissacarídeo: elipsoide semitransparente em volta de cada par
  let capsulas = null;
  if (capsula) {
    const semi = new THREE.Vector3(meioPar + raio * 0.3, raio * (forma === 'rim' ? 1.08 : 1) + raio * 0.3, raio + raio * 0.3);
    const geo = deformarComRuido(new THREE.SphereGeometry(1, 48, 32), { amplitude: 0.025, frequencia: 2.5, semente: semente + 1 }).scale(semi.x, semi.y, semi.z);
    capsulas = new THREE.Mesh(
      juntar(geo, matrizesPar),
      new THREE.MeshPhysicalMaterial({
        color: corCapsula ?? new THREE.Color(cores.secundaria).lerp(new THREE.Color('#ffffff'), 0.35),
        roughness: 0.3, transparent: true, opacity: 0.28, depthWrite: false,
      })
    );
    conjunto.add(marcarParte(capsulas, 'capsula'));
  }

  const grupo = new THREE.Group();
  grupo.add(conjunto);

  function atualizar(t) {
    conjunto.rotation.z = Math.sin(t * 0.6) * 0.06; // balanço lento do par
    conjunto.rotation.y = Math.sin(t * 0.45) * 0.08;
    if (capsulas) capsulas.scale.setScalar(1 + Math.sin(t * 1.4) * 0.012);
  }

  return { objeto: grupo, atualizar, foco: paredes };
}
