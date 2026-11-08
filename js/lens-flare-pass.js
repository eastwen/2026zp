import * as THREE from '../vendor/three/three.module.js';

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const FLARE_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uEnabled;
  uniform float uIntensity;
  uniform float uThreshold;
  uniform float uStreakScale;
  uniform float uHotspotPower;
  uniform float uGate;
  uniform float uStarRays;
  uniform vec3 uTailColor;

  const float TAIL_MIX = 1.0;
  const float TAIL_START = 0.0;
  const float TAIL_FALLOFF = 0.5;

  varying vec2 vUv;

  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  float brightMask(float lum) {
    float x = max(lum - uThreshold, 0.0);
    float m = x / max(1.0 - uThreshold, 1e-5);
    m = clamp(m, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);

    float hp = max(uHotspotPower, 1.0);
    if (hp > 1.01) {
      m = pow(m, hp);
    }

    float gate = clamp(uGate, 0.0, 1.0);
    float gm = (m - gate) / max(1.0 - gate, 1e-5);
    gm = clamp(gm, 0.0, 1.0);
    return m * gm;
  }

  vec3 sampleBright(vec2 uv) {
    vec3 c = texture2D(tDiffuse, uv).rgb;
    return c * brightMask(luma(c));
  }

  vec3 streak(vec2 dirPx) {
    vec3 acc = vec3(0.0);
    vec2 pixel = floor(vUv * uResolution);
    float h = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    float phase = step(0.5, h) * 0.5;
    for (int i = 1; i <= 8; i++) {
      float fi = float(i);
      float dist = fi * 1.5 + phase;
      float w = 1.0 / (1.0 + dist * 0.22);
      w *= w;

      float t = clamp(dist / 8.0, 0.0, 1.0);
      float start = clamp(TAIL_START, 0.0, 0.95);
      float tt = clamp((t - start) / max(1.0 - start, 1e-5), 0.0, 1.0);
      tt = pow(tt, max(TAIL_FALLOFF, 0.001));
      vec3 ramp = mix(vec3(1.0), uTailColor, clamp(TAIL_MIX, 0.0, 1.0) * tt);

      vec2 o = dirPx * dist;
      acc += sampleBright(vUv + o) * (w * ramp);
      acc += sampleBright(vUv - o) * (w * ramp);
    }
    return acc;
  }

  void main() {
    vec3 flare = vec3(0.0);
    if (uEnabled >= 0.5 && uIntensity > 0.0001) {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 px = (1.0 / max(uResolution, vec2(1.0))) * uStreakScale;

      flare += base * brightMask(luma(base)) * 1.2;

      if (uStarRays >= 7.5) {
        flare += streak(vec2(px.x, 0.0));
        flare += streak(vec2(0.0, px.y));
        const float c45 = 0.70710678;
        flare += streak(vec2(px.x * c45, px.y * c45));
        flare += streak(vec2(px.x * c45, -px.y * c45));
      } else if (uStarRays >= 5.5) {
        flare += streak(vec2(0.0, px.y));
        const float c30 = 0.8660254;
        const float s30 = 0.5;
        flare += streak(vec2(px.x * c30, px.y * s30));
        flare += streak(vec2(px.x * c30, -px.y * s30));
      } else {
        flare += streak(vec2(px.x, 0.0));
        flare += streak(vec2(0.0, px.y));
      }
    }

    flare *= (uIntensity * 0.75);
    gl_FragColor = vec4(flare, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tBase;
  uniform sampler2D tFlare;
  uniform float uEnabled;

  varying vec2 vUv;

  void main() {
    vec4 base = texture2D(tBase, vUv);
    vec3 flare = texture2D(tFlare, vUv).rgb;
    gl_FragColor = vec4(base.rgb + flare * uEnabled, base.a);
  }
`;

function makeMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false,
  });
}

export class LensFlarePass {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.downsample = THREE.MathUtils.clamp(options.flareDownsample ?? 0.5, 0.2, 1);
    this.stride = Math.max(1, Math.floor(options.flareStride ?? 2));
    this.streakScaleBase = options.streakScale ?? 8;
    this.frame = 0;

    this.width = 1;
    this.height = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.flareTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.flareMaterial = makeMaterial(FLARE_FRAGMENT, {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uEnabled: { value: 1 },
      uIntensity: { value: options.intensity ?? 0.7 },
      uThreshold: { value: options.threshold ?? 0.99 },
      uStreakScale: { value: this.streakScaleBase },
      uHotspotPower: { value: options.hotspotPower ?? 32 },
      uGate: { value: options.gate ?? 0.88 },
      uStarRays: { value: options.starRays ?? 6 },
      uTailColor: { value: new THREE.Color(options.tailColor ?? 0xe96039) },
    });
    this.compositeMaterial = makeMaterial(COMPOSITE_FRAGMENT, {
      tBase: { value: null },
      tFlare: { value: null },
      uEnabled: { value: 1 },
    });
  }

  setSize(width, height, cssWidth = width) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.flareTarget.setSize(
      Math.max(1, Math.floor(this.width * this.downsample)),
      Math.max(1, Math.floor(this.height * this.downsample))
    );
    this.flareMaterial.uniforms.uResolution.value.set(this.width, this.height);
    const mobileScale = cssWidth < 768 ? 2 : 1;
    this.flareMaterial.uniforms.uStreakScale.value =
      this.streakScaleBase * (this.width / 1920) * mobileScale;
    this.frame = 0;
  }

  render(renderer, inputTexture, outputTarget = null) {
    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);

    if (this.enabled && this.frame % this.stride === 0) {
      this.flareMaterial.uniforms.tDiffuse.value = inputTexture;
      this.quad.material = this.flareMaterial;
      renderer.setRenderTarget(this.flareTarget);
      renderer.clear();
      renderer.render(this.scene, this.camera);
    }
    this.frame += 1;

    this.compositeMaterial.uniforms.tBase.value = inputTexture;
    this.compositeMaterial.uniforms.tFlare.value = this.flareTarget.texture;
    this.compositeMaterial.uniforms.uEnabled.value = this.enabled ? 1 : 0;
    this.quad.material = this.compositeMaterial;
    renderer.setRenderTarget(outputTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  dispose() {
    this.flareTarget.dispose();
    this.flareMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}
