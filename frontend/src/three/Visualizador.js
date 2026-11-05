import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { criarModelo } from './modelos/index.js';

const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;

// Com a barra no máximo, o plano não chega ao fundo: sobra um pedaço do modelo
const ALCANCE_CORTE = 0.9;

// Peças separadas: ficam menores para as duas caberem no campo circular, levemente viradas uma para a outra
const ESCALA_PECAS = 0.52;
const AFASTAMENTO_PECAS = 1.12;
const INCLINACAO_PECAS = 0.3;
const VELOCIDADE_GIRO_PECA = 0.009; // radianos por pixel arrastado

/** Injeta GLSL no material padrão: as faces internas reveladas pelo corte ficam mais escuras. */
function escurecerFacesInternas(shader) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `#include <opaque_fragment>
    if (!gl_FrontFacing) gl_FragColor.rgb *= 0.35;`
  );
}

/**
 * Visualizador 3D reutilizável: cena, câmera, luzes, controles orbitais,
 * raycasting (hover/clique em partes), animação, pausa, aramado, plano de corte,
 * separação do modelo em duas peças e limpeza de memória.
 */
export class Visualizador {
  constructor(container, { interativo = true, girarSozinho = true, aoPassar, aoSelecionar, aoMenu } = {}) {
    this.container = container;
    this.aoPassar = aoPassar;
    this.aoSelecionar = aoSelecionar;
    this.aoMenu = aoMenu;
    this.modelo = null;
    this.pivo = null;
    this.parteHover = null;
    this.parteSelecionada = null;
    this.girarSozinho = girarSozinho;
    this.pausado = reduzirMovimento;
    this.aramado = false;
    this.corte = 0;
    this.semieixos = new THREE.Vector3();
    this.centroCorte = new THREE.Vector3();
    this.planoCorte = new THREE.Plane(new THREE.Vector3(0, 0, -1));
    this.planoDesenho = this.planoCorte.clone(); // o plano que os materiais usam em cada desenho
    this.separado = false;
    this.abertura = 0; // 0 = peças unidas, 1 = totalmente separadas
    this.pecas = [];
    this.pecaArrastada = null;

    // Renderizador
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.autoClear = false; // com as peças separadas, a cena é desenhada duas vezes por quadro
    container.appendChild(this.renderer.domElement);

    // Cena e câmera perspectiva
    this.cena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    this.camera.position.set(0, 0.6, 7);

    // Iluminação: ambiente (IBL) + luz principal + luz de recorte colorida + hemisférica
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.ambiente = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.cena.environment = this.ambiente;
    this.cena.environmentIntensity = 0.55;
    pmrem.dispose();

    const principal = new THREE.DirectionalLight('#fff4e8', 2.2);
    principal.position.set(3, 4, 5);
    const recorte = new THREE.PointLight('#8fb8ff', 18, 20);
    recorte.position.set(-4, 1.5, -3);
    const preenchimento = new THREE.HemisphereLight('#dfefff', '#2a1a2e', 0.6);
    this.cena.add(principal, recorte, preenchimento);

    // Controles orbitais (girar e aproximar)
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.enableDamping = !this.pausado;
    this.controles.enablePan = false;
    this.controles.autoRotate = this.girarSozinho && !this.pausado;
    this.controles.autoRotateSpeed = 0.8;
    this.controles.enableZoom = interativo;

    // Raycasting
    this.raycaster = new THREE.Raycaster();
    this.ponteiro = new THREE.Vector2();
    if (interativo) this.#ligarEventos();

    // Redimensionamento
    this.observador = new ResizeObserver(() => this.#redimensionar());
    this.observador.observe(container);
    this.#redimensionar();

    // Laço de animação (o tempo acumulado só avança sem pausa, para não saltar ao retomar)
    this.tempo = 0;
    this.ultimoQuadro = performance.now();
    this.renderer.setAnimationLoop(() => this.#quadro());
  }

  /** Carrega o modelo de uma entidade vinda da API. */
  async carregar(entidade) {
    this.#encerrarSeparacao();
    this.#removerModelo();
    const cores = { primaria: entidade.cor_primaria, secundaria: entidade.cor_secundaria };

    if (entidade.modelo_url) {
      const gltf = await new GLTFLoader().loadAsync(entidade.modelo_url);
      // Em modelos .glb, o nome de cada malha vira a chave da parte
      gltf.scene.traverse((o) => o.isMesh && (o.userData.parte = o.name));
      this.modelo = { objeto: gltf.scene, atualizar: () => {} };
    } else {
      this.modelo = criarModelo(entidade.modelo_tipo, entidade.modelo_params, cores);
    }

    // pivô centralizado: a animação de entrada escala a partir do centro do modelo
    this.pivo = new THREE.Group();
    this.pivo.add(this.modelo.objeto);
    this.cena.add(this.pivo);
    this.#enquadrar(this.modelo.objeto);
    this.#apontarCorteParaCamera();
    this.#posicionarPlanoCorte();
    this.#prepararMateriais();
    this.entrada = reduzirMovimento ? 1 : 0;
  }

  /** Destaca uma parte (usado também pelos botões da lista, para acessibilidade). */
  selecionar(chave) {
    this.parteSelecionada = chave;
    this.#aplicarDestaque();
  }

  /** Congela a animação do modelo e o giro automático; arrastar, aramado e corte continuam funcionando. */
  pausar(ativo) {
    this.pausado = ativo;
    this.#atualizarGiroAutomatico();
    this.controles.enableDamping = !ativo; // a inércia manteria a câmera deslizando depois da pausa
  }

  /** Mostra a malha de triângulos do modelo. */
  definirAramado(ativo) {
    this.aramado = ativo;
    this.#paraCadaMaterial((mat) => (mat.wireframe = ativo));
  }

  /**
   * Avança o plano de corte: 0 = modelo inteiro, 1 = corte máximo.
   * Ao sair do 0, o plano fica preso ao modelo: a câmera pode girar em volta da seção cortada.
   */
  definirCorte(valor) {
    if (this.corte === 0 && valor > 0 && !this.pecasAtivas) this.#apontarCorteParaCamera();
    this.corte = valor;
    if (valor === 0 && this.pecasAtivas) {
      this.separar(false); // sem corte não há duas peças; o plano só sai do lugar depois que elas se unem
      return;
    }
    this.#posicionarPlanoCorte();
  }

  /**
   * Parte o modelo em duas peças no plano de corte, abertas como um livro.
   * Sem corte definido, corta perto do meio. Juntar devolve o modelo inteiro, sem corte.
   */
  separar(ativo) {
    if (!this.modelo || ativo === this.separado) return;
    if (ativo) {
      if (this.corte === 0) this.definirCorte(0.5);
      if (!this.pecas.length) this.#montarPecas(); // reabrindo durante o fechamento, mantém as poses
      this.pivo.matrixAutoUpdate = false;
      this.#mostrarHalo(false); // a esfera do halo envolve o modelo inteiro, não cada peça
    } else {
      this.corte = 0; // o plano só sai do lugar em #encerrarSeparacao, quando as peças se unem
    }
    this.separado = ativo;
    this.#atualizarGiroAutomatico();
  }

  destruir() {
    this.renderer.setAnimationLoop(null);
    this.observador.disconnect();
    this.controles.dispose();
    this.#removerModelo();
    this.ambiente.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---------------- internos ----------------

  #quadro() {
    const agora = performance.now();
    const dt = Math.min((agora - this.ultimoQuadro) / 1000, 0.1);
    this.ultimoQuadro = agora;

    if (this.modelo) {
      if (this.entrada < 1) {
        this.entrada = Math.min(this.entrada + dt / 0.9, 1); // 0,9 s, independente do FPS
        this.pivo.scale.setScalar(0.6 + 0.4 * easeOutCubic(this.entrada));
      }
      if (!this.pausado) {
        this.tempo += dt;
        this.modelo.atualizar(this.tempo, dt);
      }
    }

    this.#animarSeparacao(dt);
    this.controles.update();
    this.#desenhar();
  }

  #desenhar() {
    this.renderer.clear();
    if (!this.pecasAtivas) return this.renderer.render(this.cena, this.camera);
    // sem limpar entre os desenhos: o teste de profundidade encaixa as duas peças na mesma imagem
    for (const peca of this.pecas) {
      this.#aplicarPeca(peca);
      this.renderer.render(this.cena, this.camera);
    }
  }

  get pecasAtivas() {
    return this.separado || this.abertura > 0;
  }

  #atualizarGiroAutomatico() {
    this.controles.autoRotate = this.girarSozinho && !this.pausado && !this.separado;
  }

  #animarSeparacao(dt) {
    const alvo = this.separado ? 1 : 0;
    if (this.abertura === alvo) return;
    const passo = reduzirMovimento ? 1 : dt / 0.7;
    this.abertura = alvo ? Math.min(this.abertura + passo, 1) : Math.max(this.abertura - passo, 0);
    if (this.abertura === 0) this.#encerrarSeparacao();
  }

  /** Calcula a posição e o giro finais: a superfície cortada de cada peça fica virada para a câmera. */
  #montarPecas() {
    const direita = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const cima = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const paraCamera = this.camera.position.clone().sub(this.controles.target).normalize();
    const extensao = ({ x, y, z }) => Math.hypot(x * this.semieixos.x, y * this.semieixos.y, z * this.semieixos.z);

    // modelos deitados (como o bacilo) se abrem na vertical; os demais, na horizontal
    const deitado = extensao(direita) > extensao(cima) * 1.25;
    const direcao = deitado ? cima : direita;
    const dobradica = deitado ? direita : cima;
    const sinal = deitado ? 1 : -1;
    const distancia = extensao(direcao) * ESCALA_PECAS * AFASTAMENTO_PECAS;

    const { normal } = this.planoCorte;
    const giroEm = (angulo) => new THREE.Quaternion().setFromAxisAngle(dobradica, angulo);
    const alinhar = (de, para) => new THREE.Quaternion().setFromUnitVectors(de, para);
    this.pecas = [
      // a peça de trás já mostra a superfície cortada para a câmera
      {
        posicao: direcao.clone().multiplyScalar(distancia),
        giro: giroEm(sinal * INCLINACAO_PECAS).multiply(alinhar(normal.clone().negate(), paraCamera)),
        inverso: false,
      },
      // a peça da frente dá meia-volta na dobradiça
      {
        posicao: direcao.clone().multiplyScalar(-distancia),
        giro: giroEm(Math.PI - sinal * INCLINACAO_PECAS).multiply(alinhar(normal, paraCamera.clone().negate())),
        inverso: true,
      },
    ];
  }

  /** Coloca o modelo na pose da peça: o pivô recebe a matriz dela e o plano acompanha a transformação. */
  #aplicarPeca(peca) {
    const e = easeOutCubic(this.abertura);
    const centro = this.planoCorte.projectPoint(this.centroCorte, new THREE.Vector3());
    const giro = new THREE.Quaternion().slerp(peca.giro, e);
    const escala = new THREE.Vector3().setScalar(1 + (ESCALA_PECAS - 1) * e);
    const posicao = centro.clone().addScaledVector(peca.posicao, e);

    this.pivo.matrix
      .compose(posicao, giro, escala)
      .multiply(new THREE.Matrix4().makeTranslation(-centro.x, -centro.y, -centro.z));
    this.pivo.matrixWorldNeedsUpdate = true;

    this.planoDesenho.copy(this.planoCorte);
    if (peca.inverso) this.planoDesenho.negate();
    this.planoDesenho.applyMatrix4(this.pivo.matrix);
  }

  #encerrarSeparacao() {
    this.separado = false;
    this.abertura = 0;
    this.pecas = [];
    this.pecaArrastada = null;
    this.#posicionarPlanoCorte();
    if (this.pivo) {
      this.pivo.matrixAutoUpdate = true;
      this.pivo.updateMatrix();
      this.pivo.matrixWorldNeedsUpdate = true;
    }
    this.#mostrarHalo(true);
    this.#atualizarGiroAutomatico();
  }

  #mostrarHalo(visivel) {
    this.modelo?.objeto.traverse((o) => {
      if (o.isMesh && o.material.isShaderMaterial) o.visible = visivel;
    });
  }

  /** Arrastar gira a peça; com Shift, move. Os eixos são os da câmera, para seguir o ponteiro. */
  #arrastarPeca(peca, dx, dy, mover) {
    const direita = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const cima = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    if (mover) {
      const distancia = this.camera.position.distanceTo(this.controles.target);
      const altura = 2 * distancia * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const porPixel = altura / this.renderer.domElement.clientHeight;
      peca.posicao.addScaledVector(direita, dx * porPixel).addScaledVector(cima, -dy * porPixel);
      return;
    }
    const emY = new THREE.Quaternion().setFromAxisAngle(cima, dx * VELOCIDADE_GIRO_PECA);
    const emX = new THREE.Quaternion().setFromAxisAngle(direita, dy * VELOCIDADE_GIRO_PECA);
    peca.giro.premultiply(emX).premultiply(emY);
  }

  /** Orienta o plano de frente para a câmera; o lado voltado para ela é o que some. */
  #apontarCorteParaCamera() {
    this.planoCorte.normal.copy(this.controles.target).sub(this.camera.position).normalize();
  }

  #posicionarPlanoCorte() {
    const { normal } = this.planoCorte;
    // profundidade do modelo vista desta direção (elipsoide inscrito na caixa envolvente):
    // nos pulmões, altos e rasos, usar o maior eixo deixaria a barra sem efeito no começo
    const s = this.semieixos;
    const profundidade = Math.hypot(normal.x * s.x, normal.y * s.y, normal.z * s.z);
    // sem corte, o plano fica longe do modelo (remover o plano forçaria recompilar os shaders)
    this.planoCorte.constant = this.corte > 0
      ? profundidade * (1 - 2 * this.corte * ALCANCE_CORTE) - normal.dot(this.centroCorte)
      : this.camera.far;
    this.planoDesenho.copy(this.planoCorte);
  }

  #enquadrar(objeto) {
    const caixa = new THREE.Box3().setFromObject(objeto);
    const centro = caixa.getCenter(new THREE.Vector3());
    const tamanho = caixa.getSize(new THREE.Vector3());
    objeto.position.sub(centro);

    // o corte percorre o `foco` do modelo, quando há um (flagelos longos não contam)
    objeto.updateMatrixWorld(true);
    const caixaCorte = new THREE.Box3().setFromObject(this.modelo.foco ?? objeto);
    caixaCorte.getCenter(this.centroCorte);
    caixaCorte.getSize(this.semieixos).multiplyScalar(0.5);

    // o maior semieixo ocupa ~78% do campo circular
    const raio = Math.max(tamanho.x, tamanho.y, tamanho.z) / 2;
    const distancia = raio / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / 0.78;
    this.camera.position.set(0, raio * 0.2, distancia);
    this.camera.near = distancia / 100;
    this.camera.far = distancia * 10;
    this.camera.updateProjectionMatrix();
    this.controles.target.set(0, 0, 0);
    this.controles.minDistance = raio * 1.2;
    this.controles.maxDistance = distancia * 2.5;
    this.controles.update();
  }

  #redimensionar() {
    const { clientWidth: largura, clientHeight: altura } = this.container;
    if (!largura || !altura) return;
    this.renderer.setSize(largura, altura, false);
    this.camera.aspect = largura / altura;
    this.camera.updateProjectionMatrix();
  }

  #ligarEventos() {
    const canvas = this.renderer.domElement;
    let inicioClique = null;
    let ultimo = null;

    canvas.addEventListener('pointermove', (e) => {
      if (this.pecaArrastada) {
        this.#arrastarPeca(this.pecaArrastada, e.clientX - ultimo.x, e.clientY - ultimo.y, e.shiftKey);
        ultimo = { x: e.clientX, y: e.clientY };
        return;
      }
      const parte = this.#parteSobPonteiro(e);
      if (parte !== this.parteHover) {
        this.parteHover = parte;
        this.#aplicarDestaque();
      }
      canvas.style.cursor = parte ? 'pointer' : 'grab';
      const r = canvas.getBoundingClientRect();
      this.aoPassar?.(parte, e.clientX - r.left, e.clientY - r.top);
    });

    canvas.addEventListener('pointerleave', () => {
      this.parteHover = null;
      this.#aplicarDestaque();
      this.aoPassar?.(null);
    });

    // captura: decide antes do OrbitControls se o arraste é da peça ou da câmera
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // o botão direito abre o menu; não seleciona nem arrasta
      inicioClique = { x: e.clientX, y: e.clientY };
      const peca = this.separado ? this.#acertoSobPonteiro(e)?.peca : null;
      if (!peca) return;
      this.pecaArrastada = peca;
      this.controles.enabled = false;
      ultimo = inicioClique;
      canvas.setPointerCapture(e.pointerId);
    }, { capture: true });

    const soltarPeca = () => {
      this.pecaArrastada = null;
      this.controles.enabled = true;
    };
    canvas.addEventListener('pointercancel', soltarPeca);

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.#acertoSobPonteiro(e)) return; // o menu só abre sobre o modelo
      const r = canvas.getBoundingClientRect();
      this.aoMenu?.(e.clientX - r.left, e.clientY - r.top);
    });

    canvas.addEventListener('pointerup', (e) => {
      soltarPeca();
      if (!inicioClique) return;
      const arrastou = Math.hypot(e.clientX - inicioClique.x, e.clientY - inicioClique.y) > 5;
      inicioClique = null;
      if (arrastou) return;
      const parte = this.#parteSobPonteiro(e);
      this.selecionar(parte);
      this.aoSelecionar?.(parte);
    });
  }

  #parteSobPonteiro(evento) {
    let alvo = this.#acertoSobPonteiro(evento)?.acerto.object;
    while (alvo && !alvo.userData.parte) alvo = alvo.parent;
    return alvo?.userData.parte ?? null;
  }

  /** Acerto mais próximo do ponteiro e, com o modelo separado, a peça a que ele pertence. */
  #acertoSobPonteiro(evento) {
    if (!this.pivo) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ponteiro.set(((evento.clientX - r.left) / r.width) * 2 - 1, -((evento.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ponteiro, this.camera);

    let melhor = null;
    for (const peca of this.pecasAtivas ? this.pecas : [null]) {
      if (peca) {
        this.#aplicarPeca(peca);
        this.pivo.updateMatrixWorld(true);
      }
      // ignora o que o plano de corte removeu da tela
      const acertos = this.raycaster
        .intersectObject(this.pivo, true)
        .filter((a) => this.planoDesenho.distanceToPoint(a.point) >= 0);
      // prefere objetos opacos (ex.: brônquios dentro do pulmão semitransparente)
      const acerto = acertos.find((a) => !a.object.material.transparent) ?? acertos[0];
      if (acerto && (!melhor || acerto.distance < melhor.acerto.distance)) melhor = { acerto, peca };
    }
    return melhor;
  }

  #aplicarDestaque() {
    if (!this.modelo) return;
    this.modelo.objeto.traverse((o) => {
      const mat = o.material;
      if (!o.isMesh || !mat?.emissive) return;
      const chave = o.userData.parte;
      if (chave && chave === this.parteHover) {
        mat.emissive.set('#ffffff');
        mat.emissiveIntensity = 0.22;
      } else if (chave && chave === this.parteSelecionada) {
        mat.emissive.set('#ffffff');
        mat.emissiveIntensity = 0.32;
      } else {
        mat.emissiveIntensity = 0;
      }
    });
  }

  /** Só materiais padrão: ShaderMaterials (como o halo) ficam fora de corte e aramado, por design. */
  #paraCadaMaterial(acao) {
    this.modelo?.objeto.traverse((o) => {
      if (!o.isMesh) return;
      [o.material].flat().filter((m) => m.isMeshStandardMaterial).forEach(acao);
    });
  }

  #prepararMateriais() {
    this.#paraCadaMaterial((mat) => {
      mat.clippingPlanes = [this.planoDesenho];
      mat.side = THREE.DoubleSide; // o corte revela o interior das malhas
      mat.wireframe = this.aramado;
      mat.onBeforeCompile = escurecerFacesInternas;
      mat.needsUpdate = true;
    });
  }

  #removerModelo() {
    if (!this.modelo) return;
    this.cena.remove(this.pivo);
    this.modelo.objeto.traverse((o) => {
      o.geometry?.dispose();
      [o.material].flat().forEach((m) => m?.dispose());
    });
    this.modelo = null;
    this.pivo = null;
  }
}
