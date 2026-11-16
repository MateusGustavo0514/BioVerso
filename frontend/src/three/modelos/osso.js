import * as THREE from 'three';
import { criarAleatorio, marcarParte, tuboDeRaioVariavel } from '../utils/geometria.js';

const suave = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Fêmur: a haste (diáfise) é um tubo de raio variável sobre um eixo levemente arqueado, com as duas
 * pontas alargadas. Cabeça, colo, trocânter e côndilos são peças separadas, cada uma clicável.
 * Dentro das extremidades há osso esponjoso (milhares de trabéculas instanciadas, orientadas
 * ao longo das linhas de força) e, no meio da haste, o canal medular, um revestimento virado do avesso.
 */
export function criarOsso(params, cores) {
  const { trabeculas = 3200, semente = 5 } = params;
  const aleatorio = criarAleatorio(semente);
  const grupo = new THREE.Group();

  const osso = () => new THREE.MeshStandardMaterial({ color: cores.primaria, roughness: 0.72 });

  // eixo da haste, de baixo (distal, joelho) para cima (proximal, quadril)
  const eixo = new THREE.CatmullRomCurve3([V(0.1, -2.0, 0), V(0.06, -1.0, 0.06), V(0.0, 0.0, 0.1), V(-0.06, 1.0, 0.06), V(-0.1, 1.65, 0)]);
  const RAIO_HASTE = 0.2;
  const raioHaste = (u) => {
    const aberto = RAIO_HASTE + 0.3 * (1 - suave(0, 0.22, u)) + 0.07 * suave(0.78, 0.95, u);
    if (u < 0.03) return aberto * Math.sqrt(Math.max(0, 1 - ((0.03 - u) / 0.03) ** 2));
    if (u > 0.94) return aberto * Math.sqrt(Math.max(0, 1 - ((u - 0.94) / 0.06) ** 2));
    return aberto;
  };
  // linha áspera: uma crista na face de trás da haste
  const crista = (u, a) => 1 + 0.07 * Math.exp(-(((a - Math.PI) / 0.45) ** 2)) * suave(0.25, 0.4, u) * (1 - suave(0.7, 0.85, u));
  const haste = tuboDeRaioVariavel(eixo, { raio: raioHaste, modulacao: crista, segmentos: 120, lados: 40 });
  grupo.add(marcarParte(new THREE.Mesh(haste.geometria, osso()), 'diafise'));

  // canal medular: revestimento amarelo (medula) virado do avesso, só no meio da haste
  const medula = tuboDeRaioVariavel(eixo, {
    raio: (u) => RAIO_HASTE * 0.55 * suave(0.2, 0.26, u) * (1 - suave(0.76, 0.82, u)),
    segmentos: 120, lados: 24, paraDentro: true,
  });
  const materialMedula = new THREE.MeshStandardMaterial({ color: cores.secundaria, roughness: 0.65, side: THREE.FrontSide });
  materialMedula.userData.manterLado = true;
  grupo.add(marcarParte(new THREE.Mesh(medula.geometria, materialMedula), 'canal_medular'));

  // cabeça, colo e trocânter maior (o quadril fica à esquerda da tela)
  const base = V(-0.18, 1.5, 0.02);
  const centroCabeca = V(-0.82, 1.98, 0.02);
  const RAIO_CABECA = 0.37;
  const cabeca = new THREE.Mesh(new THREE.SphereGeometry(RAIO_CABECA, 48, 36), osso());
  cabeca.position.copy(centroCabeca);
  grupo.add(marcarParte(cabeca, 'cabeca_femoral'));

  const colo = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([base, V(-0.45, 1.75, 0.02), centroCabeca.clone().lerp(base, 0.12)]), 24, 0.17, 20),
    osso()
  );
  grupo.add(marcarParte(colo, 'colo_femoral'));

  const trocanter = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), osso());
  trocanter.scale.set(0.2, 0.34, 0.24);
  trocanter.position.set(0.1, 1.72, -0.02);
  grupo.add(marcarParte(trocanter, 'trocanter_maior'));

  // côndilos medial e lateral
  const condilos = [[-0.17, -2.05, 0.04], [0.37, -2.05, 0.04]].map(([x, y, z]) => {
    const malha = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), osso());
    malha.scale.set(0.28, 0.33, 0.4);
    malha.position.set(x, y, z);
    grupo.add(marcarParte(malha, 'condilos'));
    return malha;
  });

  // cartilagem articular: calotas finas e translúcidas sobre a cabeça e na base dos côndilos
  const materialCartilagem = new THREE.MeshPhysicalMaterial({ color: '#cfe6ee', roughness: 0.2, clearcoat: 0.8, transparent: true, opacity: 0.82 });
  const calotaCabeca = new THREE.Mesh(new THREE.SphereGeometry(RAIO_CABECA * 1.025, 48, 24, 0, Math.PI * 2, 0, 1.9), materialCartilagem);
  calotaCabeca.position.copy(centroCabeca);
  calotaCabeca.quaternion.setFromUnitVectors(V(0, 1, 0), centroCabeca.clone().sub(base).normalize());
  grupo.add(marcarParte(calotaCabeca, 'cartilagem_articular'));
  for (const c of condilos) {
    const cal = new THREE.Mesh(new THREE.SphereGeometry(1.03, 36, 20, 0, Math.PI * 2, Math.PI - 1.9, 1.9), materialCartilagem);
    cal.scale.copy(c.scale);
    cal.position.copy(c.position);
    grupo.add(marcarParte(cal, 'cartilagem_articular'));
  }

  // osso esponjoso: hastes finas por dentro das extremidades. Cada região tem uma direção de
  // força principal (do quadril ao colo; vertical nos côndilos); as hastes seguem essa direção
  // com um desvio sorteado, como as trabéculas reais.
  const regioes = [];
  const naEsfera = (centro, raio, escala = V(1, 1, 1)) => () => {
    const d = V(aleatorio() * 2 - 1, aleatorio() * 2 - 1, aleatorio() * 2 - 1);
    return d.lengthSq() > 1 ? null : d.multiplyScalar(raio).multiply(escala).add(centro);
  };
  const eixoColo = centroCabeca.clone().sub(base).normalize();
  regioes.push({ quantidade: 0.27, sorteia: naEsfera(centroCabeca, RAIO_CABECA * 0.62), direcao: eixoColo });
  regioes.push({ quantidade: 0.12, sorteia: () => base.clone().lerp(centroCabeca, aleatorio() * 0.8).add(V((aleatorio() - 0.5) * 0.12, (aleatorio() - 0.5) * 0.12, (aleatorio() - 0.5) * 0.12)), direcao: eixoColo });
  regioes.push({ quantidade: 0.14, sorteia: naEsfera(trocanter.position, 0.55, trocanter.scale), direcao: V(0.3, 1, 0).normalize() });
  for (const c of condilos) {
    regioes.push({ quantidade: 0.16, sorteia: naEsfera(c.position, 0.58, c.scale), direcao: V(0, 1, 0) });
  }
  // metáfises: dentro do tubo, perto das duas pontas da haste
  const dentroDoTubo = (u0, u1) => () => {
    const u = u0 + aleatorio() * (u1 - u0);
    return haste.pontoNaSecao(u, aleatorio() * Math.PI * 2, 0.6 * Math.sqrt(aleatorio()));
  };
  regioes.push({ quantidade: 0.08, sorteia: dentroDoTubo(0.04, 0.2), direcao: V(0, 1, 0) });
  regioes.push({ quantidade: 0.07, sorteia: dentroDoTubo(0.84, 0.94), direcao: V(0.1, 1, 0) });

  const soma = regioes.reduce((n, r) => n + r.quantidade, 0);
  const hastes = [];
  for (const regiao of regioes) {
    const alvo = Math.round((regiao.quantidade / soma) * trabeculas);
    for (let n = 0, tentativas = 0; n < alvo && tentativas < alvo * 20; tentativas++) {
      const p = regiao.sorteia();
      if (!p) continue;
      const d = regiao.direcao.clone().multiplyScalar(1.4).add(V(aleatorio() - 0.5, aleatorio() - 0.5, aleatorio() - 0.5).multiplyScalar(1.6)).normalize();
      hastes.push({ p, d, comprimento: 0.07 + aleatorio() * 0.07 });
      n++;
    }
  }
  const trabeculasMalha = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.009, 0.009, 1, 5),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(cores.primaria).offsetHSL(0, 0.05, -0.06), roughness: 0.8 }),
    hastes.length
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  hastes.forEach(({ p, d, comprimento }, i) => {
    q.setFromUnitVectors(V(0, 1, 0), d);
    trabeculasMalha.setMatrixAt(i, m.compose(p, q, V(1, comprimento, 1)));
  });
  grupo.add(marcarParte(trabeculasMalha, 'osso_esponjoso'));

  return { objeto: grupo, atualizar() {} };
}
