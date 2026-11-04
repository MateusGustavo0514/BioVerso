import * as THREE from 'three';

/**
 * Shader próprio (GLSL) de efeito Fresnel: as bordas brilham mais que o centro,
 * lembrando imagens de microscopia. Usado como "halo" em volta dos microrganismos.
 */
export function criarMaterialFresnel({ cor = '#9fd3ff', intensidade = 1.0, potencia = 2.5 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCor: { value: new THREE.Color(cor) },
      uIntensidade: { value: intensidade },
      uPotencia: { value: potencia },
      uTempo: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vVisao;
      void main() {
        vec4 posicaoMV = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vVisao = normalize(-posicaoMV.xyz);
        gl_Position = projectionMatrix * posicaoMV;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCor;
      uniform float uIntensidade;
      uniform float uPotencia;
      uniform float uTempo;
      varying vec3 vNormal;
      varying vec3 vVisao;
      void main() {
        float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vVisao)), 0.0), uPotencia);
        float pulso = 0.85 + 0.15 * sin(uTempo * 1.5);
        gl_FragColor = vec4(uCor * uIntensidade * pulso, fresnel * pulso);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Cria a esfera de halo. Ela não recebe cliques (raycast desativado). */
export function criarHalo(raio, opcoes) {
  const halo = new THREE.Mesh(new THREE.SphereGeometry(raio, 64, 48), criarMaterialFresnel(opcoes));
  halo.raycast = () => {};
  halo.renderOrder = 10;
  return halo;
}
