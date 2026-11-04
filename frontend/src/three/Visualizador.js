import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { criarModelo } from './modelos/index.js';

const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;

/**
 * Visualizador 3D reutilizável: cena, câmera, luzes, controles orbitais,
 * raycasting (hover/clique em partes), animação e limpeza de memória.
 */
export class Visualizador {
  constructor(container, { interativo = true, girarSozinho = true, aoPassar, aoSelecionar } = {}) {
    this.container = container;
    this.aoPassar = aoPassar;
    this.aoSelecionar = aoSelecionar;
    this.modelo = null;
    this.pivo = null;
    this.parteHover = null;
    this.parteSelecionada = null;

    // Renderizador
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    this.controles.enableDamping = true;
    this.controles.enablePan = false;
    this.controles.autoRotate = girarSozinho && !reduzirMovimento;
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

    // Laço de animação
    this.inicio = performance.now();
    this.ultimoQuadro = this.inicio;
    this.renderer.setAnimationLoop(() => this.#quadro());
  }

  /** Carrega o modelo de uma entidade vinda da API. */
  async carregar(entidade) {
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
    this.entrada = reduzirMovimento ? 1 : 0;
  }

  /** Destaca uma parte (usado também pelos botões da lista, para acessibilidade). */
  selecionar(chave) {
    this.parteSelecionada = chave;
    this.#aplicarDestaque();
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
    const t = (agora - this.inicio) / 1000;
    const dt = Math.min((agora - this.ultimoQuadro) / 1000, 0.1);
    this.ultimoQuadro = agora;

    if (this.modelo) {
      if (this.entrada < 1) {
        this.entrada = Math.min(this.entrada + dt / 0.9, 1); // 0,9 s, independente do FPS
        this.pivo.scale.setScalar(0.6 + 0.4 * easeOutCubic(this.entrada));
      }
      if (!reduzirMovimento) this.modelo.atualizar(t, dt);
    }

    this.controles.update();
    this.renderer.render(this.cena, this.camera);
  }

  #enquadrar(objeto) {
    const caixa = new THREE.Box3().setFromObject(objeto);
    const centro = caixa.getCenter(new THREE.Vector3());
    const tamanho = caixa.getSize(new THREE.Vector3());
    objeto.position.sub(centro);

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

    canvas.addEventListener('pointermove', (e) => {
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

    canvas.addEventListener('pointerdown', (e) => (inicioClique = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
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
    if (!this.pivo) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ponteiro.set(((evento.clientX - r.left) / r.width) * 2 - 1, -((evento.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ponteiro, this.camera);

    const acertos = this.raycaster.intersectObject(this.pivo, true);
    // prefere objetos opacos (ex.: brônquios dentro do pulmão semitransparente)
    const acerto = acertos.find((a) => !a.object.material.transparent) ?? acertos[0];
    let alvo = acerto?.object;
    while (alvo && !alvo.userData.parte) alvo = alvo.parent;
    return alvo?.userData.parte ?? null;
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
