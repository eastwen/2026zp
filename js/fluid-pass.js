import * as THREE from '../vendor/three/three.module.js';

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const CURL_FRAGMENT = /* glsl */ `
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    float left = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
    float right = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
    float top = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
    float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
    float value = 0.5 * (right - left - top + bottom);
    gl_FragColor = vec4(value, 0.0, 0.0, 1.0);
  }
`;

const VORTICITY_FRAGMENT = /* glsl */ `
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexelSize;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  uniform vec2 uPointerDelta;
  uniform float uCurlStrength;
  uniform float uSplatRadius;
  uniform float uSplatForce;
  varying vec2 vUv;

  void main() {
    float left = abs(texture2D(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x);
    float right = abs(texture2D(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x);
    float top = abs(texture2D(uCurl, vUv + vec2(0.0, uTexelSize.y)).x);
    float bottom = abs(texture2D(uCurl, vUv - vec2(0.0, uTexelSize.y)).x);
    float center = texture2D(uCurl, vUv).x;

    vec2 force = vec2(top - bottom, right - left);
    float forceLength = length(force);
    if (forceLength > 0.0001) {
      force /= forceLength;
    } else {
      force = vec2(0.0);
    }

    force *= uCurlStrength * center;
    force.y *= -1.0;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * 0.016;
    velocity = clamp(velocity, vec2(-1000.0), vec2(1000.0));

    vec2 mouseUv = uPointer / max(uResolution, vec2(0.0001));
    vec2 diff = vUv - mouseUv;
    diff.x *= uResolution.x / max(uResolution.y, 0.0001);
    float pointerMask = exp(-dot(diff, diff) / max(uSplatRadius, 0.0001));
    velocity += (uPointerDelta / max(uResolution, vec2(0.0001))) * pointerMask * uSplatForce;

    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const DIVERGENCE_FRAGMENT = /* glsl */ `
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    float left = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
    float right = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
    float top = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
    float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
    float divergence = 0.5 * (right - left + top - bottom);
    gl_FragColor = vec4(divergence, 0.0, 0.0, 1.0);
  }
`;

const CLEAR_FRAGMENT = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0);
  }
`;

const PRESSURE_FRAGMENT = /* glsl */ `
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    float left = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float right = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float top = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (left + right + top + bottom - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT_FRAGMENT = /* glsl */ `
  uniform sampler2D uVelocity;
  uniform sampler2D uPressure;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    float left = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float right = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float top = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity -= vec2(right - left, top - bottom);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const ADVECT_FRAGMENT = /* glsl */ `
  uniform sampler2D uProjectedVelocity;
  uniform vec2 uTexelSize;
  uniform float uDissipation;
  varying vec2 vUv;

  void main() {
    vec2 velocity = texture2D(uProjectedVelocity, vUv).xy;
    vec2 coord = clamp(vUv - velocity * uTexelSize * 0.016, 0.0, 1.0);
    vec2 advected = texture2D(uProjectedVelocity, coord).xy;
    advected /= 1.0 + uDissipation * 0.016;
    gl_FragColor = vec4(advected, 0.0, 1.0);
  }
`;

const DISPLAY_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D uVelocity;
  uniform vec2 uSimSize;
  uniform float uDisplacementStrength;
  uniform float uChromaticBoost;
  uniform float uEffectEnabled;
  uniform vec3 uSpectrumA;
  uniform vec3 uSpectrumB;
  uniform vec3 uSpectrumC;

  vec3 spectrum(float x) {
    float t = clamp(x, 0.0, 1.0);
    return t < 0.5
      ? mix(uSpectrumA, uSpectrumB, t * 2.0)
      : mix(uSpectrumB, uSpectrumC, (t - 0.5) * 2.0);
  }

  vec4 getFluidDisplayColor(vec2 uv) {
    vec2 velocity = texture2D(uVelocity, uv).xy;
    float effectEnabled = step(0.5, uEffectEnabled);
    vec2 displacement = velocity / max(uSimSize, vec2(1.0)) * uDisplacementStrength * effectEnabled;
    float velocityMagnitude = length(displacement);

    const int samples = 4;
    vec4 color = vec4(0.0);
    vec3 weightSum = vec3(0.0);

    for (int index = 0; index < samples; index++) {
      float t = float(index) / float(samples - 1);
      vec3 weight = max(vec3(0.0), cos((t - vec3(0.0, 0.5, 1.0)) * 3.14159 * 0.5));
      vec4 sampleColor = texture2D(
        tDiffuse,
        clamp(uv - displacement * 0.3 * (t + 0.3) * velocityMagnitude, 0.0, 1.0)
      );
      color.rgb += sampleColor.rgb * weight;
      color.a += sampleColor.a * (weight.r + weight.g + weight.b) / 3.0;
      weightSum += weight;
    }

    color.rgb /= max(weightSum, vec3(0.0001));
    color.a /= max((weightSum.r + weightSum.g + weightSum.b) / 3.0, 0.0001);

    vec3 spectralHighlight = spectrum(sin(velocityMagnitude * 2.0) * 0.4 + 0.6);
    color.rgb += spectralHighlight * smoothstep(0.2, 0.8, velocityMagnitude) * 0.5 * uChromaticBoost * effectEnabled;

    return color;
  }

  varying vec2 vUv;

  void main() {
    gl_FragColor = getFluidDisplayColor(vUv);
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

export class FluidPass {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.simResolution = options.simResolution || 160;
    this.pressureIterations = options.pressureIterations || 4;
    this.strength = options.strength ?? 0.3;
    this.radius = options.radius ?? 1.5;
    this.velocityScale = options.velocityScale ?? 1;
    this.chromaticStrength = options.chromaticStrength ?? 0.002;
    this.curlStrength = options.curlStrength ?? 0;
    this.velocityDissipation = options.velocityDissipation ?? 3;
    this.enabled = true;

    this.viewportWidth = 1;
    this.viewportHeight = 1;
    this.simWidth = this.simResolution;
    this.simHeight = this.simResolution;

    this.pointer = new THREE.Vector2(-1, -1);
    this.pointerDelta = new THREE.Vector2(0, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.velocityRead = this.createTarget();
    this.velocityWrite = this.createTarget();
    this.curlTarget = this.createTarget();
    this.vortTarget = this.createTarget();
    this.divergenceTarget = this.createTarget();
    this.pressureA = this.createTarget();
    this.pressureB = this.createTarget();
    this.projectedVelocityTarget = this.createTarget();

    this.curlMaterial = makeMaterial(CURL_FRAGMENT, {
      uVelocity: { value: null },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
    });
    this.vorticityMaterial = makeMaterial(VORTICITY_FRAGMENT, {
      uVelocity: { value: null },
      uCurl: { value: null },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPointer: { value: this.pointer },
      uPointerDelta: { value: this.pointerDelta },
      uCurlStrength: { value: this.curlStrength },
      uSplatRadius: { value: Math.max(0.002 * this.radius, 5e-4) },
      uSplatForce: { value: Math.max(3000 * this.velocityScale, 0) },
    });
    this.divergenceMaterial = makeMaterial(DIVERGENCE_FRAGMENT, {
      uVelocity: { value: null },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
    });
    this.clearMaterial = makeMaterial(CLEAR_FRAGMENT, {});
    this.pressureMaterial = makeMaterial(PRESSURE_FRAGMENT, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
    });
    this.gradientMaterial = makeMaterial(GRADIENT_FRAGMENT, {
      uVelocity: { value: null },
      uPressure: { value: null },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
    });
    this.advectMaterial = makeMaterial(ADVECT_FRAGMENT, {
      uProjectedVelocity: { value: null },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uDissipation: { value: this.velocityDissipation },
    });
    this.displayMaterial = makeMaterial(DISPLAY_FRAGMENT, {
      tDiffuse: { value: null },
      uVelocity: { value: null },
      uSimSize: { value: new THREE.Vector2(this.simWidth, this.simHeight) },
      uDisplacementStrength: { value: Math.max(this.strength / 0.3, 0) },
      uChromaticBoost: { value: Math.max(this.chromaticStrength / 0.004, 0) },
      uSpectrumA: { value: new THREE.Color(0xffc247) },
      uSpectrumB: { value: new THREE.Color(0xff5a24) },
      uSpectrumC: { value: new THREE.Color(0xf02f55) },
      uEffectEnabled: { value: 1 },
    });
  }

  createTarget() {
    const supportsHalfFloat = this.renderer.capabilities.isWebGL2;
    return new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
  }

  setSize(width, height) {
    this.viewportWidth = Math.max(1, Math.floor(width));
    this.viewportHeight = Math.max(1, Math.floor(height));
    const aspect = this.viewportWidth / this.viewportHeight;
    const resolution = this.simResolution;
    if (aspect > 1) {
      this.simWidth = Math.round(resolution * aspect);
      this.simHeight = resolution;
    } else {
      this.simWidth = resolution;
      this.simHeight = Math.round(resolution / Math.max(aspect, 1e-4));
    }

    const targets = [
      this.velocityRead,
      this.velocityWrite,
      this.curlTarget,
      this.vortTarget,
      this.divergenceTarget,
      this.pressureA,
      this.pressureB,
      this.projectedVelocityTarget,
    ];
    for (const target of targets) {
      target.setSize(this.simWidth, this.simHeight);
    }

    const texelX = 1 / this.simWidth;
    const texelY = 1 / this.simHeight;
    const texelMaterials = [
      this.curlMaterial,
      this.vorticityMaterial,
      this.divergenceMaterial,
      this.pressureMaterial,
      this.gradientMaterial,
      this.advectMaterial,
    ];
    for (const material of texelMaterials) {
      material.uniforms.uTexelSize.value.set(texelX, texelY);
    }

    this.vorticityMaterial.uniforms.uResolution.value.set(
      this.viewportWidth,
      this.viewportHeight
    );
    this.displayMaterial.uniforms.uSimSize.value.set(this.simWidth, this.simHeight);
  }

  updatePointer(uv, active, delta) {
    const pixelX = uv.x * this.viewportWidth;
    const pixelY = uv.y * this.viewportHeight;
    this.pointerDelta.set(
      pixelX - this.pointer.x,
      pixelY - this.pointer.y
    );
    if (this.pointer.x < 0 || !active) this.pointerDelta.set(0, 0);
    this.pointer.set(pixelX, pixelY);
  }

  setEffectEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.displayMaterial.uniforms.uEffectEnabled.value = this.enabled ? 1 : 0;
  }

  setSpectrum(colors) {
    if (!this.displayMaterial || !colors) return;
    this.displayMaterial.uniforms.uSpectrumA.value.fromArray(colors[0]);
    this.displayMaterial.uniforms.uSpectrumB.value.fromArray(colors[1]);
    this.displayMaterial.uniforms.uSpectrumC.value.fromArray(colors[2]);
  }

  render(renderer, inputTexture, outputTarget = null) {
    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);

    if (this.enabled) {
      this.curlMaterial.uniforms.uVelocity.value = this.velocityRead.texture;
      this.renderMaterial(this.curlMaterial, this.curlTarget);

      this.vorticityMaterial.uniforms.uVelocity.value = this.velocityRead.texture;
      this.vorticityMaterial.uniforms.uCurl.value = this.curlTarget.texture;
      this.renderMaterial(this.vorticityMaterial, this.vortTarget);

      this.divergenceMaterial.uniforms.uVelocity.value = this.vortTarget.texture;
      this.renderMaterial(this.divergenceMaterial, this.divergenceTarget);

      this.renderMaterial(this.clearMaterial, this.pressureA);
      let pressureSource = this.pressureA;
      let pressureDest = this.pressureB;
      for (let iteration = 0; iteration < this.pressureIterations; iteration += 1) {
        this.pressureMaterial.uniforms.uPressure.value = pressureSource.texture;
        this.pressureMaterial.uniforms.uDivergence.value = this.divergenceTarget.texture;
        this.renderMaterial(this.pressureMaterial, pressureDest);
        const swap = pressureSource;
        pressureSource = pressureDest;
        pressureDest = swap;
      }

      this.gradientMaterial.uniforms.uVelocity.value = this.vortTarget.texture;
      this.gradientMaterial.uniforms.uPressure.value = pressureSource.texture;
      this.renderMaterial(this.gradientMaterial, this.projectedVelocityTarget);

      this.advectMaterial.uniforms.uProjectedVelocity.value = this.projectedVelocityTarget.texture;
      this.renderMaterial(this.advectMaterial, this.velocityWrite);
      const swap = this.velocityRead;
      this.velocityRead = this.velocityWrite;
      this.velocityWrite = swap;
    }

    this.displayMaterial.uniforms.tDiffuse.value = inputTexture;
    this.displayMaterial.uniforms.uVelocity.value = this.velocityRead.texture;
    this.quad.material = this.displayMaterial;
    renderer.setRenderTarget(outputTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  renderMaterial(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    const targets = [
      this.velocityRead,
      this.velocityWrite,
      this.curlTarget,
      this.vortTarget,
      this.divergenceTarget,
      this.pressureA,
      this.pressureB,
      this.projectedVelocityTarget,
    ];
    for (const target of targets) target.dispose();
    const materials = [
      this.curlMaterial,
      this.vorticityMaterial,
      this.divergenceMaterial,
      this.clearMaterial,
      this.pressureMaterial,
      this.gradientMaterial,
      this.advectMaterial,
      this.displayMaterial,
    ];
    for (const material of materials) material.dispose();
  }
}
