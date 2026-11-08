import * as THREE from '../vendor/three/three.module.js';

const SIM_RES = 128;
const SPLAT_RADIUS = 0.012;
const SPLAT_VELOCITY_SCALE = 8.2;
const VELOCITY_DISSIPATION = 4.2;
const CURL_STRENGTH = 18;
const PRESSURE_ITERATIONS = 20;
const PRESSURE_COEFFICIENT = 0.06;

const shaderFiles = {
  baseVert: 'base.vert',
  splat: 'splat.frag',
  advection: 'advection.frag',
  divergence: 'divergence.frag',
  pressure: 'pressure.frag',
  gradientSubtract: 'gradientSubtract.frag',
  curl: 'curl.frag',
  vorticity: 'vorticity.frag',
  clear: 'clear.frag',
};

function makeDoubleTarget(width, height) {
  const options = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  };
  let read = new THREE.WebGLRenderTarget(width, height, options);
  let write = new THREE.WebGLRenderTarget(width, height, options);
  return {
    get read() { return read; },
    get write() { return write; },
    swap() { const next = read; read = write; write = next; },
  };
}

function makeTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

async function loadShaders() {
  const entries = await Promise.all(Object.entries(shaderFiles).map(async ([key, file]) => {
    const response = await fetch(`./assets/fluid/shaders/${file}`);
    if (!response.ok) throw new Error(`Fluid shader failed: ${file}`);
    return [key, await response.text()];
  }));
  return Object.fromEntries(entries);
}

export async function createFluidField(renderer) {
  console.log('createFluidField called with:', typeof renderer, renderer);
  const shaders = await loadShaders();
  console.log('Shaders loaded, renderer:', typeof renderer, !!renderer);
  const velocity = makeDoubleTarget(SIM_RES, SIM_RES);
  const pressure = makeDoubleTarget(SIM_RES, SIM_RES);
  const divergence = makeTarget(SIM_RES, SIM_RES);
  const curl = makeTarget(SIM_RES, SIM_RES);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  scene.add(quad);

  function material(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({
      vertexShader: shaders.baseVert,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
  }

  const texelSize = new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES);
  const splatMaterial = material(shaders.splat, {
    texelSize: { value: texelSize },
    uTarget: { value: null },
    aspectRatio: { value: window.innerWidth / window.innerHeight },
    color: { value: new THREE.Vector3() },
    point: { value: new THREE.Vector2(0.5, 0.5) },
    radius: { value: SPLAT_RADIUS * Math.max(1, window.innerWidth / window.innerHeight) },
  });
  const advectionMaterial = material(shaders.advection, {
    texelSize: { value: texelSize },
    uVelocity: { value: null },
    uSource: { value: null },
    dt: { value: 0 },
    dissipation: { value: VELOCITY_DISSIPATION },
  });
  const divergenceMaterial = material(shaders.divergence, {
    texelSize: { value: texelSize },
    uVelocity: { value: null },
  });
  const pressureMaterial = material(shaders.pressure, {
    texelSize: { value: texelSize },
    uPressure: { value: null },
    uDivergence: { value: null },
  });
  const gradientMaterial = material(shaders.gradientSubtract, {
    texelSize: { value: texelSize },
    uPressure: { value: null },
    uVelocity: { value: null },
  });
  const curlMaterial = material(shaders.curl, {
    texelSize: { value: texelSize },
    uVelocity: { value: null },
  });
  const vorticityMaterial = material(shaders.vorticity, {
    texelSize: { value: texelSize },
    uVelocity: { value: null },
    uCurl: { value: null },
    curlStrength: { value: CURL_STRENGTH },
    dt: { value: 0 },
  });
  const clearMaterial = material(shaders.clear, {
    texelSize: { value: texelSize },
    uTexture: { value: null },
    value: { value: PRESSURE_COEFFICIENT },
  });

  if (!renderer) {
    throw new Error('Renderer is undefined in createFluidField');
  }
  const previousAutoClear = renderer.autoClear;
  console.log('About to set renderer.autoClear to false');
  renderer.autoClear = false;
  try {
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(velocity.read);
    renderer.clear();
    renderer.setRenderTarget(velocity.write);
    renderer.clear();
    renderer.setRenderTarget(pressure.read);
    renderer.clear();
    renderer.setRenderTarget(pressure.write);
    renderer.clear();
    renderer.setRenderTarget(null);
  } catch (e) {
    console.error('Error during fluid field initialization:', e);
  }
  renderer.autoClear = previousAutoClear;

  function pass(shaderMaterial, target) {
    quad.material = shaderMaterial;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  }

  function splat(x, y, dx, dy) {
    if (Math.hypot(dx, dy) < 0.00005) return;
    splatMaterial.uniforms.uTarget.value = velocity.read.texture;
    splatMaterial.uniforms.point.value.set(x, y);
    splatMaterial.uniforms.color.value.set(dx * SPLAT_VELOCITY_SCALE, dy * SPLAT_VELOCITY_SCALE, 0);
    pass(splatMaterial, velocity.write);
    velocity.swap();
  }

  function update(dt) {
    const step = Math.min(dt, 1 / 30);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;

    curlMaterial.uniforms.uVelocity.value = velocity.read.texture;
    pass(curlMaterial, curl);

    vorticityMaterial.uniforms.uVelocity.value = velocity.read.texture;
    vorticityMaterial.uniforms.uCurl.value = curl.texture;
    vorticityMaterial.uniforms.dt.value = step;
    pass(vorticityMaterial, velocity.write);
    velocity.swap();

    divergenceMaterial.uniforms.uVelocity.value = velocity.read.texture;
    pass(divergenceMaterial, divergence);

    clearMaterial.uniforms.uTexture.value = pressure.read.texture;
    pass(clearMaterial, pressure.write);
    pressure.swap();

    for (let i = 0; i < PRESSURE_ITERATIONS; i += 1) {
      pressureMaterial.uniforms.uPressure.value = pressure.read.texture;
      pressureMaterial.uniforms.uDivergence.value = divergence.texture;
      pass(pressureMaterial, pressure.write);
      pressure.swap();
    }

    gradientMaterial.uniforms.uPressure.value = pressure.read.texture;
    gradientMaterial.uniforms.uVelocity.value = velocity.read.texture;
    pass(gradientMaterial, velocity.write);
    velocity.swap();

    advectionMaterial.uniforms.uVelocity.value = velocity.read.texture;
    advectionMaterial.uniforms.uSource.value = velocity.read.texture;
    advectionMaterial.uniforms.dt.value = step;
    advectionMaterial.uniforms.dissipation.value = VELOCITY_DISSIPATION;
    pass(advectionMaterial, velocity.write);
    velocity.swap();

    renderer.setRenderTarget(null);
    renderer.autoClear = autoClear;
  }

  function resize() {
    splatMaterial.uniforms.aspectRatio.value = window.innerWidth / window.innerHeight;
    splatMaterial.uniforms.radius.value = SPLAT_RADIUS * Math.max(1, window.innerWidth / window.innerHeight);
  }

  return {
    splat,
    update,
    resize,
    get texture() { return velocity.read.texture; },
  };
}
