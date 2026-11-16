import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAleatorio, deformarComRuido, curvaNovelo, esferasInstanciadas, marcarParte } from '../utils/geometria.js';
import { criarHaloDaForma } from '../shaders/fresnel.js';

/** Curva helicoidal paramétrica: o formato de um flagelo bacteriano. Corre ao longo de -X. */
export class Helice extends THREE.Curve {
  constructor(comprimento, amplitude, voltas) {
    super();
    Object.assign(this, { comprimento, amplitude, voltas });
  }
  getPoint(t, alvo = new THREE.Vector3()) {
    const a = this.amplitude * Math.min(t * 4, 1); // começa fino na base
    const angulo = t * this.voltas * Math.PI * 2;
    return alvo.set(-t * this.comprimento, Math.cos(angulo) * a, Math.sin(angulo) * a);
  }
}

/**
 * Moléculas soltas em volta da célula (toxinas, enzimas), instanciadas em orientações sorteadas.
 * `forma`: 'ab5' (anel de cinco subunidades B com a subunidade A em cima, como a toxina da cólera),
 * 'cadeia' (três domínios em fila, como a toxina do tétano) ou 'esfera'.
 */
export function particulasInstanciadas(posicoes, tamanho, cor, forma, aleatorio) {
  let geo;
  if (forma === 'ab5') {
    geo = mergeGeometries([
      ...Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return new THREE.SphereGeometry(tamanho * 0.42, 10, 8).translate(Math.cos(a) * tamanho * 0.62, 0, Math.sin(a) * tamanho * 0.62);
      }),
      new THREE.SphereGeometry(tamanho * 0.5, 12, 10).translate(0, tamanho * 0.55, 0),
    ]);
  } else if (forma === 'cadeia') {
    geo = mergeGeometries([
      new THREE.SphereGeometry(tamanho * 0.5, 12, 10).translate(-tamanho * 0.7, 0, 0),
      new THREE.SphereGeometry(tamanho * 0.42, 12, 10).translate(0, tamanho * 0.15, 0),
      new THREE.SphereGeometry(tamanho * 0.36, 12, 10).translate(tamanho * 0.6, -tamanho * 0.1, 0),
    ]);
  } else {
    geo = new THREE.IcosahedronGeometry(tamanho * 0.5, 1);
  }
  const malha = new THREE.InstancedMesh(geo, new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.45, clearcoat: 0.4 }), posicoes.length);
  const matriz = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const eixo = new THREE.Vector3();
  const escala = new THREE.Vector3();
  posicoes.forEach((p, i) => {
    quat.setFromAxisAngle(eixo.set(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).normalize(), aleatorio() * Math.PI * 2);
    malha.setMatrixAt(i, matriz.compose(p, quat, escala.setScalar(0.85 + aleatorio() * 0.3)));
  });
  return malha;
}

/**
 * Perfil do bacilo com esporo terminal (Clostridium tetani): união suave da cápsula da célula
 * com a esfera do esporo, revolvida em volta do eixo (LatheGeometry). Eixo em Y.
 */
function perfilComEsporo(comprimento, raio, raioEsporo, centroEsporo, amostras = 160) {
  const raioCapsula = (x) => {
    const d = Math.max(Math.abs(x) - comprimento / 2, 0);
    return d < raio ? Math.sqrt(raio * raio - d * d) : 0;
  };
  const raioEsfera = (x) => {
    const d = Math.abs(x - centroEsporo);
    return d < raioEsporo ? Math.sqrt(raioEsporo * raioEsporo - d * d) : 0;
  };
  const k = raio * 0.6; // largura da emenda entre o corpo e o esporo
  const xMin = -comprimento / 2 - raio;
  const xMax = Math.max(comprimento / 2 + raio, centroEsporo + raioEsporo);
  const pontos = [];
  for (let i = 0; i <= amostras; i++) {
    const s = 0.5 - 0.5 * Math.cos((Math.PI * i) / amostras); // mais amostras perto das pontas
    const x = xMin + (xMax - xMin) * s;
    const a = raioCapsula(x);
    const b = raioEsfera(x);
    const h = Math.max(k - Math.abs(a - b), 0) / k; // máximo suave: sem quina no "pescoço"
    pontos.push(new THREE.Vector2(i === 0 || i === amostras ? 0 : Math.max(a, b) + h * h * k * 0.25, x));
  }
  return pontos;
}

/** Corpo em bastão, com o eixo longo no X: cápsula simples ou, com esporo, a superfície de revolução. */
function geometriaBastao(comprimento, raio, esporo, fatorEsporo = 1) {
  const geo = esporo
    ? new THREE.LatheGeometry(perfilComEsporo(comprimento, raio, esporo.raio * fatorEsporo, esporo.centro), 64)
    : new THREE.CapsuleGeometry(raio, comprimento, 24, 64, Math.ceil(comprimento / raio) * 4); // divisões no comprimento: o ruído varia também ao longo do corpo
  return geo.rotateZ(-Math.PI / 2);
}

/** Anel de DNA levemente irregular, numa orientação sorteada. */
function geometriaPlasmideo(raio, centro, aleatorio) {
  const pontos = Array.from({ length: 12 }, (_, i) => {
    const angulo = (i / 12) * Math.PI * 2;
    const r = raio * (0.85 + aleatorio() * 0.3);
    return new THREE.Vector3(Math.cos(angulo) * r, Math.sin(angulo) * r, (aleatorio() - 0.5) * raio * 0.5);
  });
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pontos, true), 80, raio * 0.13, 6, true);
  geo.rotateX((aleatorio() - 0.5) * 0.9); // inclinação leve: o anel continua legível de frente
  geo.rotateY((aleatorio() - 0.5) * 0.9);
  return geo.translate(centro.x, centro.y, centro.z);
}

/** Endósporo: capa, córtex e núcleo concêntricos (o núcleo guarda o DNA), visíveis no corte. */
function criarEsporo(esporo, raio, aleatorio) {
  const { centro, raio: r, corCapa = '#c9b37e', corCortex = '#efe4c4', corNucleo = '#7a6a9e', corDna = '#f0c75e' } = esporo;
  const grupo = new THREE.Group();
  grupo.position.x = centro;
  const capa = new THREE.Mesh(
    deformarComRuido(new THREE.SphereGeometry(r * 0.84, 48, 32), { amplitude: r * 0.025, frequencia: 9 / r, semente: 7 }),
    new THREE.MeshPhysicalMaterial({ color: corCapa, roughness: 0.75 })
  );
  const cortex = new THREE.Mesh(new THREE.SphereGeometry(r * 0.68, 40, 28), new THREE.MeshPhysicalMaterial({ color: corCortex, roughness: 0.6 }));
  const nucleo = new THREE.Mesh(new THREE.SphereGeometry(r * 0.46, 32, 24), new THREE.MeshPhysicalMaterial({ color: corNucleo, roughness: 0.5 }));
  const curvaDna = curvaNovelo({ raioMin: r * 0.08, raioMax: r * 0.32, pontos: 36, aleatorio, fechada: true });
  curvaDna.arcLengthDivisions = 800;
  const dna = new THREE.Mesh(new THREE.TubeGeometry(curvaDna, 500, raio * 0.03, 6, true), new THREE.MeshPhysicalMaterial({ color: corDna, roughness: 0.35, clearcoat: 0.5 }));
  grupo.add(marcarParte(capa, 'capa_esporo'), marcarParte(cortex, 'cortex_esporo'), marcarParte(nucleo, 'nucleo_esporo'), marcarParte(dna, 'nucleo_esporo'));
  return grupo;
}

/**
 * Interior da célula, visível com o corte: membrana plasmática, nucleoide, plasmídeos, ribossomos e,
 * conforme a espécie, uma camada intermediária da parede, inclusões e o esporo.
 */
function criarInterior(opcoes) {
  const {
    comprimento, raio, ribossomos, plasmideos, raioMembrana: fatorMembrana, parede, inclusoes, esporo,
    corMembrana, corDna, corRibossomo, corPlasmideo, aleatorio,
  } = opcoes;
  const interior = new THREE.Group();
  const raioMembrana = raio * fatorMembrana;

  // Camada intermediária da parede (ex.: peptidoglicano e arabinogalactano da micobactéria)
  if (parede) {
    const { chave, cor, raioRel = 0.92 } = parede;
    const geo = geometriaBastao(comprimento, raio * raioRel, esporo, raioRel);
    interior.add(marcarParte(new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.7 })), chave));
  }

  const membrana = new THREE.Mesh(
    geometriaBastao(comprimento, raioMembrana, esporo, 0.92),
    new THREE.MeshPhysicalMaterial({ color: corMembrana, roughness: 0.5 })
  );
  interior.add(marcarParte(membrana, 'membrana_plasmatica'));

  // Parte "viva" da célula: com esporo terminal, o citoplasma fica do lado oposto a ele
  const xInicio = -comprimento / 2;
  const xFim = esporo ? esporo.centro - esporo.raio : comprimento / 2;
  const centroX = (xInicio + xFim) / 2;
  const meio = (xFim - xInicio) / 2;

  // Nucleoide: cromossomo circular, compactado e esticado ao longo do eixo da célula
  const raioNucleoide = raio * 0.6;
  const escala = new THREE.Vector3((meio + raio * (esporo ? 0.1 : 0.4)) / raioNucleoide, 1, 1);
  const curvaDna = curvaNovelo({ raioMin: raio * 0.2, raioMax: raioNucleoide, pontos: 140, aleatorio, escala, fechada: true });
  curvaDna.arcLengthDivisions = 2000; // o padrão (200) achataria as dobras
  const cromossomo = new THREE.Mesh(
    new THREE.TubeGeometry(curvaDna, 2200, raio * 0.03, 6, true).translate(centroX, 0, 0),
    new THREE.MeshPhysicalMaterial({ color: corDna, roughness: 0.35, clearcoat: 0.5 })
  );
  interior.add(marcarParte(cromossomo, 'cromossomo'));

  // Ponto sorteado no citoplasma: dentro da cápsula, fora do miolo do nucleoide e do esporo
  const limite = raioMembrana * 0.92;
  const pontoCitoplasma = () => {
    for (;;) {
      const x = (aleatorio() - 0.5) * (comprimento + limite * 2);
      const y = (aleatorio() - 0.5) * limite * 2;
      const z = (aleatorio() - 0.5) * limite * 2;
      const dentroDaCapsula = Math.hypot(Math.max(Math.abs(x) - comprimento / 2, 0), y, z) < limite;
      const noNucleoide = ((x - centroX) / meio) ** 2 + (y * y + z * z) / (raio * 0.3) ** 2 < 1;
      const noEsporo = esporo && Math.hypot(x - esporo.centro, y, z) < esporo.raio * 0.95;
      if (dentroDaCapsula && !noNucleoide && !noEsporo) return new THREE.Vector3(x, y, z);
    }
  };

  // Plasmídeos alternados nos dois lados do nucleoide, no plano do eixo: o corte central os alcança
  if (plasmideos > 0) {
    const aneis = Array.from({ length: plasmideos }, (_, i) => {
      const x = centroX + (((i + 0.5) / plasmideos) * 2 - 1) * meio * 0.55;
      const y = (i % 2 ? 1 : -1) * raioMembrana * 0.62;
      return geometriaPlasmideo(raio * 0.22, new THREE.Vector3(x, y, 0), aleatorio);
    });
    const plasmideo = new THREE.Mesh(
      mergeGeometries(aneis),
      new THREE.MeshPhysicalMaterial({ color: corPlasmideo, roughness: 0.35, clearcoat: 0.5 })
    );
    interior.add(marcarParte(plasmideo, 'plasmideo'));
  }

  // Inclusões (ex.: gotas de lipídio da micobactéria): esferas maiores soltas no citoplasma
  if (inclusoes) {
    const { quantidade = 6, chave = 'inclusoes', cor = '#f2d98d', tamanho = 0.16 } = inclusoes;
    const posicoes = Array.from({ length: quantidade }, pontoCitoplasma);
    interior.add(marcarParte(esferasInstanciadas(posicoes, raio * tamanho, cor, aleatorio, 20), chave));
  }

  const posicoes = Array.from({ length: ribossomos }, pontoCitoplasma);
  interior.add(marcarParte(esferasInstanciadas(posicoes, raio * 0.04, corRibossomo, aleatorio, 8), 'ribossomos'));

  if (esporo) interior.add(criarEsporo(esporo, raio, aleatorio));
  return interior;
}

/**
 * Bactéria em bastão (bacilo): E. coli, bacilo da tuberculose, bacilo do tétano. Eixo longo no X.
 * Parâmetros opcionais: `parede` (camada intermediária), `inclusoes`, `esporo` terminal,
 * `particulas` soltas em volta (toxinas) e `aspecto: 'ceroso'` (parede de ácidos micólicos).
 */
export function criarBacilo(params, cores) {
  const {
    comprimento = 2, raio = 0.5, flagelos = 6, pili = 80, semente = 3,
    ribossomos = 900, plasmideos = 3, corDna = '#f0c75e', corRibossomo = '#6a5acd', corPlasmideo = '#ff9d5c',
    chaveCorpo = 'membrana', raioMembrana = 0.88, rugosidade = 0.02, aspecto, parede, inclusoes, particulas = [],
  } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();
  const esporo = params.esporo && {
    ...params.esporo,
    raio: raio * (params.esporo.raio ?? 1.45),
    centro: comprimento / 2 + raio * (params.esporo.avanco ?? 0.35),
  };

  // Corpo: cápsula (ou bastão com esporo) com leve deformação
  const ceroso = aspecto === 'ceroso';
  const corpo = new THREE.Mesh(
    deformarComRuido(geometriaBastao(comprimento, raio, esporo), { amplitude: rugosidade, frequencia: ceroso ? 4.5 : 2, semente }),
    new THREE.MeshPhysicalMaterial({
      color: cores.primaria,
      roughness: ceroso ? 0.85 : 0.4,
      clearcoat: ceroso ? 0.15 : 1,
      clearcoatRoughness: 0.25,
      sheen: ceroso ? 1 : 0.6,
      sheenColor: new THREE.Color(ceroso ? cores.secundaria : '#ffffff'),
    })
  );
  grupo.add(marcarParte(corpo, chaveCorpo));

  // Ponto aleatório na parte cilíndrica da superfície + normal (sem invadir o esporo)
  const xMaximo = esporo ? esporo.centro - esporo.raio : comprimento / 2;
  const pontoSuperficie = () => {
    const x = -comprimento / 2 + aleatorio() * (xMaximo + comprimento / 2);
    const phi = aleatorio() * Math.PI * 2;
    return { x, phi, normal: new THREE.Vector3(0, Math.cos(phi), Math.sin(phi)) };
  };

  // Fímbrias (pili): cilindros finos instanciados, orientados pela normal
  if (pili > 0) {
    const geoPilus = new THREE.CylinderGeometry(0.006, 0.01, 0.16, 5);
    geoPilus.translate(0, 0.08, 0);
    const matPili = new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.6 });
    const malhaPili = new THREE.InstancedMesh(geoPilus, matPili, pili);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < pili; i++) {
      const { x, normal } = pontoSuperficie();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      m.compose(new THREE.Vector3(x, normal.y * raio, normal.z * raio), q, new THREE.Vector3(1, 0.6 + aleatorio(), 1));
      malhaPili.setMatrixAt(i, m);
    }
    grupo.add(marcarParte(malhaPili, 'pili'));
  }

  // Flagelos: tubo ao longo de uma hélice; o giro no próprio eixo simula a propulsão
  const matFlagelo = new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.5 });
  const giros = [];
  for (let i = 0; i < flagelos; i++) {
    const { x, phi } = pontoSuperficie();
    const pivo = new THREE.Group();
    pivo.position.set(x, 0, 0);
    pivo.rotation.x = phi; // Y local passa a apontar para fora da superfície

    const inclinacao = new THREE.Group();
    inclinacao.position.y = raio * 0.95;
    inclinacao.rotation.z = -0.35 - aleatorio() * 0.3; // aponta para trás e para fora

    const giro = new THREE.Group();
    const curva = new Helice(1.6 + aleatorio() * 0.8, 0.08, 3 + aleatorio() * 1.5);
    const flagelo = new THREE.Mesh(new THREE.TubeGeometry(curva, 160, 0.018, 6), matFlagelo);
    giro.add(marcarParte(flagelo, 'flagelo'));
    giro.userData.velocidade = 8 + aleatorio() * 4;

    inclinacao.add(giro);
    pivo.add(inclinacao);
    grupo.add(pivo);
    giros.push(giro);
  }

  const interior = criarInterior({
    comprimento, raio, ribossomos, plasmideos, raioMembrana, parede, inclusoes, esporo,
    corDna, corRibossomo, corPlasmideo, aleatorio,
    corMembrana: new THREE.Color(cores.primaria).offsetHSL(0, -0.1, 0.2),
  });
  grupo.add(interior);

  // Partículas soltas em volta do corpo (ex.: toxina do tétano liberada pela bactéria)
  for (const { chave, quantidade = 16, cor = '#e0527a', forma = 'esfera', tamanho = 0.12 } of particulas) {
    const posicoes = Array.from({ length: quantidade }, () => {
      const x = -comprimento / 2 + aleatorio() * (xMaximo + comprimento / 2);
      const direcao = new THREE.Vector3(0, aleatorio() - 0.5, aleatorio() - 0.5).normalize();
      return direcao.multiplyScalar(raio * (1.6 + aleatorio() * 1.1)).setX(x);
    });
    grupo.add(marcarParte(particulasInstanciadas(posicoes, raio * tamanho * 2, cor, forma, aleatorio), chave));
  }

  // halo com o contorno liso do bastão, sem o ruído do corpo
  const halo = criarHaloDaForma(geometriaBastao(comprimento, raio, esporo), raio * 0.25, { cor: cores.primaria, intensidade: 0.8, potencia: 2.5 });
  grupo.add(halo);

  function atualizar(t) {
    giros.forEach((g) => (g.rotation.x = t * g.userData.velocidade));
    corpo.rotation.x = Math.sin(t * 0.7) * 0.05;
    interior.rotation.x = corpo.rotation.x; // o conteúdo e o halo acompanham o envoltório
    halo.rotation.x = corpo.rotation.x;
    halo.material.uniforms.uTempo.value = t;
  }

  return { objeto: grupo, atualizar, foco: corpo };
}
