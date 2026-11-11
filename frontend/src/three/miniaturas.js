import { Visualizador } from './Visualizador.js';

// Fotos já tiradas, por slug: valem enquanto o site estiver aberto
const fotos = new Map();
const LADO = 320; // tamanho, em pixels CSS, do quadro fotografado

/**
 * Gera uma miniatura de cada modelo com um único Visualizador escondido fora da tela:
 * um contexto WebGL só, em vez de um por cartão. Chama `aoGerar(slug, url)` a cada foto
 * e devolve uma função que cancela o que ainda falta (usada ao sair da página).
 */
export function gerarMiniaturas(entidades, aoGerar) {
  const pendentes = entidades.filter((e) => {
    if (!fotos.has(e.slug)) return true;
    aoGerar(e.slug, fotos.get(e.slug));
    return false;
  });
  if (!pendentes.length) return () => {};

  let cancelado = false;
  const estudio = document.createElement('div');
  estudio.setAttribute('aria-hidden', 'true');
  Object.assign(estudio.style, {
    position: 'fixed', left: '-10000px', top: '0', width: `${LADO}px`, height: `${LADO}px`, pointerEvents: 'none',
  });
  document.body.append(estudio);
  const visualizador = new Visualizador(estudio, { interativo: false, girarSozinho: false });
  visualizador.pausar(true);

  (async () => {
    for (const entidade of pendentes) {
      // cede a vez ao navegador entre um modelo e outro: a página continua respondendo
      await new Promise((continuar) => setTimeout(continuar, 0));
      if (cancelado) break;
      try {
        await visualizador.carregar(entidade);
        const url = recortar(visualizador.fotografar());
        fotos.set(entidade.slug, url);
        if (!cancelado) aoGerar(entidade.slug, url);
      } catch {
        // sem foto, o cartão continua com a mancha colorida
      }
    }
    visualizador.destruir();
    estudio.remove();
  })();

  return () => (cancelado = true);
}

/**
 * Recorta a foto num quadrado justo em volta do que foi desenhado (pixels com alfa).
 * Modelos com partes longas, como os flagelos do bacilo, sairiam pequenos no cartão.
 */
function recortar(origem) {
  const { width: largura, height: altura } = origem;
  const copia = document.createElement('canvas');
  copia.width = largura;
  copia.height = altura;
  const contexto = copia.getContext('2d', { willReadFrequently: true });
  contexto.drawImage(origem, 0, 0);
  const { data } = contexto.getImageData(0, 0, largura, altura);

  let [x0, y0, x1, y1] = [largura, altura, -1, -1];
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if (data[(y * largura + x) * 4 + 3] < 12) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return copia.toDataURL('image/webp', 0.9); // nada desenhado: devolve como está

  const lado = Math.ceil(Math.max(x1 - x0, y1 - y0) * 1.06); // pequena margem
  const final = document.createElement('canvas');
  final.width = final.height = lado;
  final.getContext('2d').drawImage(copia, (x0 + x1 - lado) / 2, (y0 + y1 - lado) / 2, lado, lado, 0, 0, lado, lado);
  return final.toDataURL('image/webp', 0.9);
}
