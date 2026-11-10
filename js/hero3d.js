// hero3d.js - Majiabin-style liquid hero
// 3D scene is rendered to a texture, then warped in screen space with
// the reference site's sine + swirl distortion around the smoothed cursor.

import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { FluidPass } from './fluid-pass.js';
import { LensFlarePass } from './lens-flare-pass.js';

const CONFIG = {
  composition: {
    zoom: 0.76,
    desktopCameraZ: 22,
    mobileCameraZ: 24,
    mobileBaseFov: 38,
  },
  hello: {
    rotation: [0, 4, 0],
    widthRatio: 0.814,
    heightRatio: 0.495,
    yOffsetRatio: 0.055,
    compactWidthRatio: 0.81,
    compactHeightRatio: 0.46,
    compactYOffsetRatio: 0.003,
  },
  cursor: {
    position: [11.6, -4.2, -3],
    axisTilt: [0, 0, 45],
    scrollSpinDegrees: 720,
    scale: 0.1,
    scaleRatio: 0.1595,
    compactWorldSize: 2.48,
    compactPosition: [6.6, -5.6, -3],
    xRatio: 0.36,
    yRatio: -0.24,
  },
  hyperspace: {
    z: 2.2,
    restScale: 0.1,
    autoPeakPadding: 1.64,
    axisTilt: [0, 0, 45],
    spinDegrees: 360,
    scaleSmoothing: 32,
  },
  post: {
    resolutionScale: 1,
    smoothing: 0.1,
    leaveSmoothing: 0.05,
    sine: { mixRadius: 0.1, frequency: 0.42, amplitude: 0.32, rotation: 0 },
    swirl: { radius: 0.055, angle: 0.05, phase: 0, mix: 0.12 },
  },
};

const stickerFiles = [
  's_01.png', 's_02.png', 's_03.png', 's_04.png',
  's_05.png', 's_06.png', 's_07.png', 's_08.png',
  's_09.png', 's_10.png', 's_11.png', 's_12.png',
];

const pointer = {
  uv: new THREE.Vector2(0.5, 0.5),
  targetUv: new THREE.Vector2(0.5, 0.5),
  previousUv: new THREE.Vector2(0.5, 0.5),
  velocity: new THREE.Vector2(0, 0),
  inside: false,
  hover: 0,
};

const state = {
  renderer: null,
  scene: null,
  camera: null,
  canvas: null,
  hello: null,
  cursor: null,
  cursorTilt: null,
  cursorSpin: null,
  cursorCounterTilt: null,
  cursorSpinAngle: 0,
  floatingStickers: [],
  stickersStarted: false,
  stickersStartAt: 0,
  sceneTarget: null,
  dotOverlay: null,
  dotOverlayMaterial: null,
  refractionTarget: null,
  glassMaterial: null,
  cursorMaterial: null,
  hyperspaceArrow: null,
  hyperspaceArrowMaterial: null,
  hyperspaceArrowRadius: 0,
  hyperspaceTilt: null,
  hyperspaceSpin: null,
  hyperspaceCounterTilt: null,
  hyperspaceScale: 0.1,
  hyperspaceScaleStarted: false,
  hyperspaceSpinAngle: 0,
  hyperspaceStages: [],
  hyperspaceRings: [],
  hyperspaceStageGroup: '',
  hyperspaceStageValue: -1,
  helloSize: null,
  cursorSize: null,
  lightAngle: Math.atan2(9, 4),
  lightTargetAngle: Math.atan2(9, 4),
  cursorLightAngle: Math.atan2(9, 4),
  cursorLightRaycaster: new THREE.Raycaster(),
  cursorLightPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  cursorLightPoint: new THREE.Vector3(),
  cursorLightNdc: new THREE.Vector2(),
  scrollY: 0,
  scrollWrapper: null,
  heroSection: null,
  heroStage: null,
  spaceSection: null,
  hyperspaceSection: null,
  postScene: null,
  postCamera: null,
  postMaterial: null,
  postTarget: null,
  dotInputTarget: null,
  flareTarget: null,
  finalScene: null,
  finalCamera: null,
  finalMaterial: null,
  lensFlarePass: null,
  fluidPass: null,
  clock: null,
  running: false,
  readyShown: false,
  resizeObserver: null,
};

const postVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const dotOverlayFragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPixelSize;
  uniform float uRadiusScale;
  uniform vec2 uResolution;

  void main() {
    float opacity = clamp(uOpacity, 0.0, 1.0);

    vec2 normalizedPixelSize = vec2(
      uPixelSize / max(uResolution.x, 1.0),
      uPixelSize / max(uResolution.y, 1.0)
    );
    vec2 safePixelSize = max(normalizedPixelSize, vec2(1e-6));
    vec2 cellUv = fract(vUv / safePixelSize);

    float radius = uRadiusScale * opacity;
    float distanceFromCenter = distance(cellUv, vec2(0.5));
    float aa = fwidth(distanceFromCenter) * 1.5;
    float circleMask = smoothstep(radius, radius - aa, distanceFromCenter);

    gl_FragColor = vec4(uColor, circleMask);
    #include <colorspace_fragment>
  }
`;

const glassVertexShader = /* glsl */ `
  varying vec3 worldNormal;
  varying vec3 eyeVector;
  varying float modelLocalY;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    worldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    eyeVector = normalize(worldPos.xyz - cameraPosition);
    modelLocalY = position.y;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const glassFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uScreenResolutionPx;
  uniform vec2 uTintLocalYRange;
  uniform vec2 uPointerScreen;
  uniform vec3 uLight;
  uniform vec3 uFresnelSideDir;
  uniform float uRefractPower;
  uniform float uChromaticAberration;
  uniform float uSaturation;
  uniform float uPointerEnergy;
  uniform float uTime;
  varying vec3 worldNormal;
  varying vec3 eyeVector;
  varying float modelLocalY;

  float random(vec2 p) {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 sat(vec3 rgb, float adjustment) {
    vec3 intensity = vec3(dot(rgb, vec3(0.2125, 0.7154, 0.0721)));
    return mix(intensity, rgb, adjustment);
  }

  void main() {
    vec2 screenUv = gl_FragCoord.xy / uScreenResolutionPx.xy;
    vec3 normal = normalize(worldNormal);
    vec3 eyeDir = normalize(eyeVector);
    vec3 refractR = refract(eyeDir, normal, 1.0 / 1.15);
    vec3 refractY = refract(eyeDir, normal, 1.0 / 1.16);
    vec3 refractG = refract(eyeDir, normal, 1.0 / 1.18);
    vec3 refractC = refract(eyeDir, normal, 1.0 / 1.22);
    vec3 refractB = refract(eyeDir, normal, 1.0 / 1.22);
    vec3 refractP = refract(eyeDir, normal, 1.0 / 1.22);
    vec3 refracted = vec3(0.0);
    float noise = random(screenUv) * 0.025;

    for (int i = 0; i < 6; i++) {
      float slide = float(i) / 6.0 * 0.1 + noise;
      float offsetR = (uRefractPower + slide) * uChromaticAberration;
      float offsetY = (uRefractPower + slide) * uChromaticAberration;
      float offsetG = (uRefractPower + slide * 2.0) * uChromaticAberration;
      float offsetC = (uRefractPower + slide * 2.5) * uChromaticAberration;
      float offsetB = (uRefractPower + slide * 3.0) * uChromaticAberration;
      float offsetP = (uRefractPower + slide) * uChromaticAberration;

      float r = texture2D(uTexture, screenUv + refractR.xy * offsetR).x * 0.5;
      vec3 ySample = texture2D(uTexture, screenUv + refractY.xy * offsetY).xyz;
      float y = (ySample.x * 2.0 + ySample.y * 2.0 - ySample.z) / 6.0;
      float g = texture2D(uTexture, screenUv + refractG.xy * offsetG).y * 0.5;
      vec3 cSample = texture2D(uTexture, screenUv + refractC.xy * offsetC).xyz;
      float c = (cSample.y * 2.0 + cSample.z * 2.0 - cSample.x) / 6.0;
      float b = texture2D(uTexture, screenUv + refractB.xy * offsetB).z * 0.5;
      vec3 pSample = texture2D(uTexture, screenUv + refractP.xy * offsetP).xyz;
      float p = (pSample.z * 2.0 + pSample.x * 2.0 - pSample.y) / 6.0;

      refracted.r += r + (2.0 * p + 2.0 * y - c) / 3.0;
      refracted.g += g + (2.0 * y + 2.0 * c - p) / 3.0;
      refracted.b += b + (2.0 * c + 2.0 * p - y) / 3.0;
    }
    refracted = sat(refracted / 6.0, uSaturation);

    float gradientY = clamp(
      (modelLocalY - uTintLocalYRange.x) / max(uTintLocalYRange.y - uTintLocalYRange.x, 0.0001),
      0.0,
      1.0
    );
    vec3 bottomColor = vec3(1.0, 0.61, 0.065);
    vec3 topColor = vec3(0.88, 0.17, 0.105);
    float gradientMix = gradientY * gradientY * (3.0 - 2.0 * gradientY);
    vec3 gradient = mix(bottomColor, topColor, gradientMix);

    vec3 lightVector = normalize(-uLight);
    vec3 halfVector = normalize(eyeDir + lightVector);
    float kDiffuse = max(dot(normal, lightVector), 0.0);
    float kSpecular = pow(abs(dot(normal, halfVector)), 40.0);
    float fresnel = pow(1.0 - abs(dot(eyeDir, normal)), 3.0);
    vec3 sideDir = normalize(uFresnelSideDir);
    float sideMask = smoothstep(-0.5, 0.5, dot(normal, sideDir));
    vec3 keyHalf = normalize(eyeDir + sideDir);
    float keySpec = pow(max(dot(normal, keyHalf), 0.0), 40.0);
    float keyDiffuse = max(dot(normal, sideDir), 0.0);
    float specBoost = 1.0 + uPointerEnergy * 0.35;

    float aspect = uScreenResolutionPx.x / max(uScreenResolutionPx.y, 1.0);
    float pointerDistance = distance(
      screenUv * vec2(aspect, 1.0),
      uPointerScreen * vec2(aspect, 1.0)
    );
    vec3 spectralShift = 0.5 + 0.5 * cos(
      6.2831853 * (
        vec3(0.0, 0.33, 0.67) +
        pointerDistance * 2.2 +
        normal.xyx * 0.12 -
        uTime * 0.02
      )
    );

    vec3 color = gradient * (0.92 + kDiffuse * 0.1);
    color += refracted * gradient * 2.2;
    vec3 specColor = mix(vec3(1.0, 0.96, 0.9), spectralShift, 0.28);
    color += kSpecular * specColor * 1.2 * specBoost;
    color += keySpec * vec3(1.0, 0.82, 0.54) * 0.9;
    color += fresnel * sideMask * vec3(1.0, 0.91, 0.74) * 1.3;
    color *= 0.92 + keyDiffuse * 0.08;
    color *= 1.045;
    color = sat(color, 1.04);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cursorVertexShader = /* glsl */ `
  varying vec3 worldNormal;
  varying vec3 eyeVector;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    worldNormal = normalize(mat3(modelMatrix) * normal);
    eyeVector = normalize(worldPos.xyz - cameraPosition);
  }
`;

const cursorFragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uLight;
  uniform vec3 uFixedLightDir;
  uniform vec3 uFresnelSideDir;
  uniform float uDiffuseness;
  uniform float uShininess;
  uniform float uSpecularStrength;
  uniform float uFresnelPower;
  uniform float uFresnelStrength;

  varying vec3 worldNormal;
  varying vec3 eyeVector;

  float fresnel(vec3 eyeDir, vec3 normal, float power) {
    float facing = abs(dot(eyeDir, normal));
    return pow(1.0 - facing, power);
  }

  float specular(vec3 light, vec3 normal, vec3 eyeDir, float shininess, float diffuseness) {
    vec3 lightVector = normalize(-light);
    vec3 halfVector = normalize(eyeDir + lightVector);
    float diffuse = max(dot(normal, lightVector), 0.0);
    float highlight = pow(abs(dot(normal, halfVector)), shininess);
    return highlight + diffuse * diffuseness;
  }

  void main() {
    vec3 normal = normalize(worldNormal);
    if (!gl_FrontFacing) normal = -normal;
    vec3 eyeDir = normalize(eyeVector);

    vec3 fixedLight = normalize(uFixedLightDir);
    vec3 fixedHalf = normalize(eyeDir + fixedLight);
    float fixedDiffuse = max(dot(normal, fixedLight), 0.0);
    float fixedSpecular = pow(max(dot(normal, fixedHalf), 0.0), 42.0);
    float fixedSheen = pow(max(dot(normal, fixedHalf), 0.0), 10.0);

    float movingSpecular = specular(
      uLight,
      normal,
      eyeDir,
      uShininess,
      uDiffuseness
    );

    float fresnelAmount = fresnel(eyeDir, normal, uFresnelPower);
    float sideMask = smoothstep(-0.5, 0.5, dot(normal, normalize(uFresnelSideDir)));

    vec3 color = uBaseColor * (0.92 + fixedDiffuse * 0.2);
    color += movingSpecular * uSpecularStrength * vec3(1.0, 0.93, 0.86);
    color += fixedSpecular * vec3(1.0, 0.82, 0.7) * 1.12;
    color += fixedSheen * vec3(1.0, 0.6, 0.46) * 0.16;
    color += fresnelAmount * sideMask * uFresnelStrength * vec3(0.95, 0.66, 0.58);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const hyperspaceVertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vEyeVector;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vEyeVector = normalize(worldPos.xyz - cameraPosition);
  }
`;

const hyperspaceFragmentShader = /* glsl */ `
  uniform vec3 iResolution;
  uniform float iTime;
  uniform float uScrollDuration;

  uniform vec3 uAccentColor;
  uniform vec3 uStripeColorA;
  uniform vec3 uStripeColorB;
  uniform float uStripeReveal;

  uniform float uOpacity;
  uniform vec3 uLight;
  uniform float uShininess;
  uniform float uDiffuseness;
  uniform float uSpecularStrength;
  uniform float uFresnelPower;
  uniform float uFresnelStrength;
  uniform vec3 uFresnelSideDir;

  varying vec3 vWorldNormal;
  varying vec3 vEyeVector;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 sampleHyperspace(vec2 fragCoord) {
    vec2 R = iResolution.xy;
    float baseScale = max(1.0, min(R.x, R.y));
    vec2 u = (fragCoord * 2.0 - R) / baseScale;

    float dur = max(uScrollDuration, 1e-4);
    float time = clamp(iTime, 0.0, dur);
    float t = clamp(time / dur, 0.0, 1.0);

    const float cellDensity = 100.0;
    vec2 polar = vec2(atan(u.y, u.x) / 3.0, length(u));
    float angleCoord = (6.0 - polar.x) * cellDensity;
    float angleId = floor(angleCoord) + 0.5;
    float angleCell = abs(fract(angleCoord) - 0.5);
    float radialCoord = (6.0 - polar.y) * cellDensity;
    vec2 q = vec2(angleId, radialCoord);

    float travel = smoothstep(0.0, 1.0, t);
    float keepProbability = mix(0.18, 1.0, travel);
    float scrollSpeed = mix(0.7, 3.6, travel);
    float trailLength = mix(2.7, 0.975, travel);
    float raySeq = fract((angleId + 0.5) * 0.61803398875);
    float keepEdge = 0.025;
    float keepMask = 1.0 - smoothstep(keepProbability - keepEdge, keepProbability + keepEdge, raySeq);

    float phaseBase = (q.y * 0.02 + q.x * 0.4) * fract(q.x * 0.61);
    vec4 spark = max(
      1.0 - fract(vec4(7.0, 6.0, 4.0, 0.0) * 0.02 + phaseBase + time * scrollSpeed) * trailLength,
      0.0
    );

    float channelMix = max(max(spark.r, spark.g), spark.b);
    float edge = max(fwidth(channelMix) * 1.5, 2.0 / max(iResolution.y, 1.0));
    float star = smoothstep(0.12 - edge, 0.12 + edge, channelMix);

    const float starThinness = 0.13;
    float thinEdge = max(fwidth(angleCell) * 1.5, 0.002);
    float thinMask = 1.0 - smoothstep(starThinness - thinEdge, starThinness + thinEdge, angleCell);
    star *= thinMask * keepMask;

    float radialBoost = pow(smoothstep(0.1, 1.0, polar.y), 1.25);
    float intensity = mix(0.0, 6.5, t * 1.2);

    float stripeBlend = hash21(vec2(angleId, 19.713));
    vec3 stripeRgb = mix(uStripeColorA, uStripeColorB, stripeBlend);

    vec3 hsvA = rgb2hsv(max(uStripeColorA, vec3(1e-5)));
    vec3 hsvB = rgb2hsv(max(uStripeColorB, vec3(1e-5)));
    float dh = abs(hsvA.x - hsvB.x);
    dh = min(dh, 1.0 - dh);
    float hueBand = clamp(dh * 1.25 + 0.04, 0.07, 0.24);

    vec3 hsv = rgb2hsv(max(stripeRgb, vec3(1e-5)));
    float idHash = hash21(vec2(angleId, 6.18));
    float idHash2 = hash21(vec2(angleId, 91.7));

    float scrollPhase = time * scrollSpeed;
    float hueAnim =
      sin(scrollPhase * 0.52 + angleId * 0.29 + idHash * 6.2831853) * (hueBand * 0.85);
    float hueStripe = (idHash - 0.5) * hueBand * 2.0;

    hsv.x = fract(hsv.x + hueStripe + hueAnim);
    hsv.y = clamp(hsv.y * mix(0.96, 1.06, idHash2), 0.0, 1.0);
    hsv.z = clamp(hsv.z * mix(0.97, 1.05, idHash), 0.0, 1.0);

    vec3 sparkColor = hsv2rgb(hsv);
    float pulse = mix(0.78, 1.0, smoothstep(0.14, 0.5, channelMix));
    sparkColor *= pulse;

    return intensity * radialBoost * sparkColor * star;
  }

  float fresnel(vec3 eyeDir, vec3 normal, float power) {
    float fresnelFactor = abs(dot(eyeDir, normal));
    float inversefresnelFactor = 1.0 - fresnelFactor;
    return pow(inversefresnelFactor, power);
  }

  float specular(vec3 light, vec3 normal, vec3 eyeDir, float shininess, float diffuseness) {
    vec3 lightVector = normalize(-light);
    vec3 halfVector = normalize(eyeDir + lightVector);

    float NdotL = dot(normal, lightVector);
    float NdotH = abs(dot(normal, halfVector));
    float kDiffuse = max(0.0, NdotL);

    float kSpecular = pow(NdotH, shininess);
    return kSpecular + kDiffuse * diffuseness;
  }

  void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec3 stripes = sampleHyperspace(fragCoord);

    float reveal = clamp(uStripeReveal, 0.0, 1.0);

    float stripeLuma = dot(stripes, vec3(0.299, 0.587, 0.114));
    float darken = smoothstep(0.0, 0.88, reveal);
    vec3 darkBase = mix(uAccentColor, vec3(0.0), darken);
    float gapMask = (1.0 - smoothstep(0.035, 0.12, stripeLuma)) * reveal;
    float crackGuard = 1.0 - smoothstep(0.68, 0.94, reveal);
    vec3 rgb = darkBase + stripes * reveal + uAccentColor * gapMask * 0.07 * crackGuard;

    vec3 normal = normalize(vWorldNormal);
    if (!gl_FrontFacing) {
      normal = -normal;
    }
    vec3 eyeDir = normalize(vEyeVector);

    float glossMask = mix(1.0, smoothstep(0.1, 0.48, stripeLuma), reveal);

    float specularLight = specular(uLight, normal, eyeDir, uShininess, uDiffuseness);
    rgb += specularLight * uSpecularStrength * glossMask;

    float f = fresnel(eyeDir, normal, uFresnelPower);
    float sideDot = dot(normal, normalize(uFresnelSideDir));
    float sideMask = smoothstep(-0.5, 0.5, sideDot);
    rgb += f * sideMask * vec3(uFresnelStrength) * glossMask;

    float alpha = clamp(uOpacity, 0.0, 1.0);
    if (alpha <= 0.0001) discard;

    gl_FragColor = vec4(rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const postFragmentShader = /* glsl */ `
  precision mediump float;
  precision mediump int;

  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec2 uPos;
  uniform vec2 uMousePos;
  uniform float uTrackMouse;
  uniform float uSineMixRadius;
  uniform float uSineFrequency;
  uniform float uSineAmplitude;
  uniform float uSineRotation;
  uniform float uSwirlRadius;
  uniform float uSwirlAngle;
  uniform float uSwirlPhase;
  uniform float uSwirlMix;
  uniform vec2 uPointerVelocity;
  uniform float uPointerActive;

  void main() {
    vec2 uv = vUv;
    if (uPointerActive < 0.003) {
      gl_FragColor = texture2D(tInput, vUv);
      return;
    }
    float aspectRatio = uResolution.x / uResolution.y;

    vec2 velocity = uPointerVelocity * vec2(aspectRatio, 1.0);
    float velocityLength = length(velocity);
    float movementStrength = smoothstep(0.00015, 0.006, velocityLength);
    if (velocityLength > 0.0) {
      vec2 velocityDir = velocity / velocityLength;
      vec2 pointerAspect = uMousePos * vec2(aspectRatio, 1.0);
      vec2 pointAspect = uv * vec2(aspectRatio, 1.0);
      vec2 toPointer = pointAspect - pointerAspect;
      float projected = dot(toPointer, velocityDir);
      vec2 closest = velocityDir * clamp(projected / max(velocityLength, 0.0001), 0.0, 1.0);
      float trailDistance = length(toPointer - closest * min(velocityLength, 1.0));
      float trailInfluence = exp(-(trailDistance * trailDistance) / (2.0 * 0.04 * 0.04));
      float dragStrength = min(velocityLength * 7.0, 0.08) * uPointerActive * movementStrength;
      uv -= velocityDir * trailInfluence * dragStrength;
    }

    vec2 waveCoord = uv * 2.0 - 1.0;
    float waveTime = uTime * 0.25;
    float waveFrequency = 20.0 * uSineFrequency;
    float waveAmplitude = uSineAmplitude * 0.2 * movementStrength;
    float waveX = sin((waveCoord.y + uPos.y) * waveFrequency + waveTime) * waveAmplitude;
    float waveY = sin((waveCoord.x - uPos.x) * waveFrequency + waveTime) * waveAmplitude;
    waveCoord += vec2(mix(waveX, 0.0, uSineRotation), mix(0.0, waveY, uSineRotation));
    vec2 sineUv = waveCoord * 0.5 + 0.5;

    vec2 mousePos = uPos + mix(vec2(0.0), uMousePos - 0.5, uTrackMouse);
    float pointerDistance = distance(uv * vec2(aspectRatio, 1.0), mousePos * vec2(aspectRatio, 1.0));
    float sineDist = exp(-(pointerDistance * pointerDistance) / (2.0 * 0.042 * 0.042)) * uPointerActive * movementStrength;
    uv = mix(uv, sineUv, sineDist);

    vec2 originalUv = uv;
    vec2 swirlUv = uv;
    swirlUv -= uMousePos;
    vec2 radiusVector = vec2(swirlUv.x * aspectRatio, swirlUv.y);
    float swirlDistance = length(radiusVector);

    if (swirlDistance <= uSwirlRadius) {
      float rotation = atan(radiusVector.y, radiusVector.x) + uSwirlAngle * 10.0 * smoothstep(uSwirlRadius, 0.0, swirlDistance);
      swirlUv = vec2(cos(rotation + uTime / 20.0 + uSwirlPhase * 6.2831853), sin(rotation + uTime / 20.0 + uSwirlPhase * 6.2831853));
      swirlUv = swirlDistance * swirlUv + uMousePos;
    }

    float swirlFade = smoothstep(0.0, uSwirlRadius, swirlDistance);
    vec2 mixedSwirlUv = mix(swirlUv, originalUv, swirlFade);
    uv = mix(uv, mixedSwirlUv, uSwirlMix * uPointerActive * movementStrength);

    gl_FragColor = texture2D(tInput, uv);
  }
`;

function createRenderTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
}

function setupRenderer(canvasEl) {
  const width = Math.max(1, canvasEl.clientWidth);
  const height = Math.max(1, canvasEl.clientHeight);

  state.renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.renderer.setSize(width, height, false);
  state.renderer.setClearColor(0x030302, 0);
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.08;
}

function setupScene() {
  state.scene = new THREE.Scene();
  state.camera = new THREE.PerspectiveCamera(38, state.canvas.clientWidth / state.canvas.clientHeight, 0.1, 1000);
  applyCameraComposition();
  state.scene.add(new THREE.AmbientLight(0xffffff, 0.78));

  const keyLight = new THREE.DirectionalLight(0xffe3b8, 3.15);
  keyLight.position.set(-8, 5, 7);
  state.scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffa673, 0.42);
  fillLight.position.set(-3, 1.5, 4);
  state.scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xfff1d8, 0.55);
  rimLight.position.set(-4, 2, -5);
  state.scene.add(rimLight);

  state.dotOverlayMaterial = new THREE.ShaderMaterial({
    vertexShader: postVertexShader,
    fragmentShader: dotOverlayFragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(0x0f0e0b) },
      uOpacity: { value: 0 },
      uPixelSize: { value: 5 },
      uRadiusScale: { value: 0.9 },
      uResolution: {
        value: new THREE.Vector2(1, 1),
      },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  state.dotOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    state.dotOverlayMaterial
  );
  state.dotOverlay.frustumCulled = false;
  state.dotOverlay.renderOrder = 10;
  state.dotOverlay.visible = false;
}

function isMobileViewport() {
  return window.innerWidth < 1024;
}

function applyCameraComposition() {
  if (!state.camera || !state.canvas) return;
  const width = Math.max(1, state.canvas.clientWidth);
  const height = Math.max(1, state.canvas.clientHeight);
  const aspect = width / height;
  const mobile = isMobileViewport();

  state.camera.aspect = aspect;
  state.camera.position.z = mobile
    ? CONFIG.composition.mobileCameraZ
    : CONFIG.composition.desktopCameraZ;

  if (mobile) {
    const baseFov = THREE.MathUtils.degToRad(CONFIG.composition.mobileBaseFov);
    const verticalFov = 2 * Math.atan(Math.tan(baseFov / 2) / aspect);
    state.camera.fov = THREE.MathUtils.radToDeg(verticalFov);
    state.camera.zoom = 1;
  } else {
    state.camera.fov = CONFIG.composition.mobileBaseFov;
    state.camera.zoom = CONFIG.composition.zoom;
  }

  state.camera.updateProjectionMatrix();
}

function setupPost() {
  const width = Math.max(1, Math.floor(state.canvas.clientWidth * CONFIG.post.resolutionScale));
  const height = Math.max(1, Math.floor(state.canvas.clientHeight * CONFIG.post.resolutionScale));
  state.sceneTarget = createRenderTarget(width, height);
  state.refractionTarget = createRenderTarget(width, height);
  state.postTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  state.dotInputTarget = state.postTarget.clone();
  state.dotOverlayMaterial.uniforms.uResolution.value.set(
    state.canvas.clientWidth,
    state.canvas.clientHeight
  );
  state.flareTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  state.lensFlarePass = new LensFlarePass(state.renderer, {
    starRays: 6,
    intensity: 0.8,
    threshold: 0.9,
    streakScale: 10,
    hotspotPower: 16,
    gate: 0.72,
    tailColor: 0xe96039,
  });
  state.lensFlarePass.enabled = true;
  state.lensFlarePass.setSize(
    state.renderer.domElement.width,
    state.renderer.domElement.height,
    state.canvas.clientWidth
  );
  state.fluidPass = new FluidPass(state.renderer);
  state.fluidPass.setSize(state.canvas.clientWidth, state.canvas.clientHeight);

  state.postScene = new THREE.Scene();
  state.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  state.postMaterial = new THREE.ShaderMaterial({
    vertexShader: postVertexShader,
    fragmentShader: postFragmentShader,
    uniforms: {
      tInput: { value: state.sceneTarget.texture },
      uResolution: { value: new THREE.Vector2(width, height) },
      uTime: { value: 0 },
      uPos: { value: new THREE.Vector2(0.5, 0.5) },
      uMousePos: { value: pointer.uv.clone() },
      uTrackMouse: { value: 1 },
      uSineMixRadius: { value: CONFIG.post.sine.mixRadius },
      uSineFrequency: { value: CONFIG.post.sine.frequency },
      uSineAmplitude: { value: CONFIG.post.sine.amplitude },
      uSineRotation: { value: CONFIG.post.sine.rotation },
      uSwirlRadius: { value: CONFIG.post.swirl.radius },
      uSwirlAngle: { value: CONFIG.post.swirl.angle },
      uSwirlPhase: { value: CONFIG.post.swirl.phase },
      uSwirlMix: { value: CONFIG.post.swirl.mix },
      uPointerVelocity: { value: new THREE.Vector2(0, 0) },
      uPointerActive: { value: 0 },
    },
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), state.postMaterial);
  state.postScene.add(quad);

  state.finalScene = new THREE.Scene();
  state.finalCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  state.finalMaterial = new THREE.ShaderMaterial({
    vertexShader: postVertexShader,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;
      uniform sampler2D tDiffuse;

      void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
      }
    `,
    uniforms: {
      tDiffuse: { value: state.dotInputTarget.texture },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const finalQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), state.finalMaterial);
  finalQuad.renderOrder = 0;
  state.finalScene.add(finalQuad);

  state.finalScene.add(state.dotOverlay);
}

function createGlassMaterial(localYRange) {
  return new THREE.ShaderMaterial({
    vertexShader: glassVertexShader,
    fragmentShader: glassFragmentShader,
    uniforms: {
      uTexture: { value: state.refractionTarget.texture },
      uScreenResolutionPx: { value: new THREE.Vector2(state.sceneTarget.width, state.sceneTarget.height) },
      uTintLocalYRange: { value: localYRange },
      uPointerScreen: { value: new THREE.Vector2(0.5, 0.5) },
      uLight: { value: new THREE.Vector3(4, 9, 0.5) },
      uFresnelSideDir: { value: new THREE.Vector3(-1, 1, -1).normalize() },
      uRefractPower: { value: 0.72 },
      uChromaticAberration: { value: 0.14 },
      uSaturation: { value: 1.2 },
      uPointerEnergy: { value: 0.6 },
      uTime: { value: 0 },
    },
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

function fitHello() {
  if (!state.hello || !state.helloSize) return;
  const height = viewportHeight();
  const width = height * state.camera.aspect;
  const compact = isCompactViewport();
  const widthRatio = compact
    ? CONFIG.hello.compactWidthRatio
    : CONFIG.hello.widthRatio;
  const heightRatio = compact
    ? CONFIG.hello.compactHeightRatio
    : CONFIG.hello.heightRatio;
  const yOffsetRatio = compact
    ? CONFIG.hello.compactYOffsetRatio
    : CONFIG.hello.yOffsetRatio;
  const scale = Math.min(
    width * widthRatio / state.helloSize.x,
    height * heightRatio / state.helloSize.y
  );
  state.hello.scale.setScalar(scale);
  state.hello.position.y = height * yOffsetRatio;
}

function isCompactViewport() {
  return isMobileViewport();
}

function fitCursor() {
  if (!state.cursor || !state.cursorSize) return;
  const height = viewportHeight();
  const width = height * state.camera.aspect;
  const compact = isCompactViewport();
  const maxDimension = Math.max(
    state.cursorSize.x,
    state.cursorSize.y,
    state.cursorSize.z,
    0.01
  );
  const cursorScale = compact
    ? CONFIG.cursor.compactWorldSize / maxDimension
    : height * CONFIG.cursor.scaleRatio / maxDimension;
  state.cursor.scale.setScalar(cursorScale);
  state.cursor.position.set(
    compact ? CONFIG.cursor.compactPosition[0] : width * CONFIG.cursor.xRatio,
    compact ? CONFIG.cursor.compactPosition[1] : height * CONFIG.cursor.yRatio,
    compact ? CONFIG.cursor.compactPosition[2] : 3.5
  );
}

function stickerViewportAtZ(z) {
  const distance = Math.max(0.1, state.camera.position.z - z);
  const height =
    (2 * Math.tan(THREE.MathUtils.degToRad(state.camera.fov / 2)) * distance) /
    Math.max(state.camera.zoom, 0.001);
  return {
    height,
    width: height * state.camera.aspect,
  };
}

function createLaneRatio(lane, laneCount) {
  const center = (lane + 0.5) / Math.max(laneCount, 1) - 0.5;
  return center + THREE.MathUtils.randFloatSpread(0.8 / Math.max(laneCount, 1));
}

function loadStickers() {
  const loader = new THREE.TextureLoader();
  const isMobile = isMobileViewport();
  const particleCount = isMobile ? 9 : 14;
  for (let index = 0; index < particleCount; index += 1) {
    const file = stickerFiles[index % stickerFiles.length];
    loader.load(
      `./assets/reference/stickers/${file}`,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image ? texture.image.width / texture.image.height : 1;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        const worldHeight = viewportHeight();
        const sizeFactor = 0.72 + Math.random() * 0.62;
        const size = (isMobile ? worldHeight * 0.075 : 2.4) * sizeFactor;
        const spawnWidthRatio = isMobile ? 1.12 : 1;
        const depth = THREE.MathUtils.randFloat(-8, -3.5);
        const viewport = stickerViewportAtZ(depth);
        const spawnWidth = viewport.width * spawnWidthRatio;
        const baseXLane = createLaneRatio(index, particleCount);
        const baseX = baseXLane * spawnWidth;
        const spawnY =
          viewport.height * 0.5 +
          0.6 +
          Math.random() * viewport.height * 0.72;
        mesh.scale.set(size * aspect, size, 1);
        mesh.position.set(baseX, spawnY, depth);
        mesh.rotation.z = THREE.MathUtils.randFloatSpread(Math.PI);
        material.opacity = 0;

        const speed =
          (isMobile ? worldHeight * 0.07 : 1) *
          THREE.MathUtils.randFloat(1.1, 2.5);
        state.floatingStickers.push({
          mesh,
          baseX,
          baseXLane,
          lane: index,
          laneCount: particleCount,
          spawnWidth,
          spawnWidthRatio,
          spawnHeight: worldHeight,
          speed,
          speedScreenRatio: speed / worldHeight,
          sway: THREE.MathUtils.randFloat(0.45, 1.35),
          swayPhase: Math.random() * Math.PI * 2,
          spin: THREE.MathUtils.randFloat(-0.24, 0.24),
          aspect,
          sizeScreenRatio: size / worldHeight,
        });
        mesh.visible = state.stickersStarted;
        state.scene.add(mesh);
      },
      undefined,
      () => {}
    );
  }
}

function layoutFloatingStickers() {
  if (!state.floatingStickers.length) return;
  const worldHeight = viewportHeight();

  state.floatingStickers.forEach((item) => {
    const size = worldHeight * item.sizeScreenRatio;
    const viewport = stickerViewportAtZ(item.mesh.position.z);
    item.mesh.scale.set(size * item.aspect, size, 1);
    item.spawnWidth = viewport.width * (item.spawnWidthRatio || 1);
    item.baseX = item.baseXLane * item.spawnWidth;
    item.spawnHeight = worldHeight;
    item.speed = worldHeight * item.speedScreenRatio;
  });
}

function loadHello() {
  new GLTFLoader().load('./assets/models/hello.gltf', (gltf) => {
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    state.helloSize = size.clone();
    const tintYMin = { value: Infinity };
    const tintYMax = { value: -Infinity };

    model.position.sub(center);
    model.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      tintYMin.value = Math.min(tintYMin.value, child.geometry.boundingBox.min.y);
      tintYMax.value = Math.max(tintYMax.value, child.geometry.boundingBox.max.y);
    });
    state.hello = new THREE.Group();
    state.hello.add(model);
    state.hello.position.z = 2;
    fitHello();
    state.glassMaterial = createGlassMaterial(new THREE.Vector2(tintYMin.value, tintYMax.value));
    model.traverse((child) => {
      if (child.isMesh) child.material = state.glassMaterial;
    });
    state.hello.rotation.set(
      THREE.MathUtils.degToRad(CONFIG.hello.rotation[0]),
      THREE.MathUtils.degToRad(CONFIG.hello.rotation[1]),
      THREE.MathUtils.degToRad(CONFIG.hello.rotation[2])
    );
    state.hello.visible = !hasHeroLeftViewport();
    state.scene.add(state.hello);
  }, undefined, () => {});
}

function createArrowMaterial(baseColor, side, fixedLightDir = new THREE.Vector3(-1, 0.3, 1)) {
  return new THREE.ShaderMaterial({
    vertexShader: cursorVertexShader,
    fragmentShader: cursorFragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uLight: { value: new THREE.Vector3(4, 9, 0.5) },
      uFixedLightDir: { value: fixedLightDir.clone().normalize() },
      uFresnelSideDir: { value: new THREE.Vector3(-1, 0.3, 1).normalize() },
      uDiffuseness: { value: 0.1 },
      uShininess: { value: 40 },
      uSpecularStrength: { value: 1.2 },
      uFresnelPower: { value: 6 },
      uFresnelStrength: { value: 1 },
    },
    side,
  });
}

function createHyperspaceMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: hyperspaceVertexShader,
    fragmentShader: hyperspaceFragmentShader,
    uniforms: {
      iResolution: { value: new THREE.Vector3(1, 1, 1) },
      iTime: { value: 0 },
      uScrollDuration: { value: 2 },
      uOpacity: { value: 1 },
      uAccentColor: { value: new THREE.Color(0xffd600) },
      uStripeColorA: { value: new THREE.Color(0xffd600) },
      uStripeColorB: { value: new THREE.Color(0xffb000) },
      uStripeReveal: { value: 0 },
      uLight: { value: new THREE.Vector3(4, 9, 0.5) },
      uShininess: { value: 40 },
      uDiffuseness: { value: 0.1 },
      uSpecularStrength: { value: 1.2 },
      uFresnelPower: { value: 6 },
      uFresnelStrength: { value: 1 },
      uFresnelSideDir: { value: new THREE.Vector3(-1, 0.3, 1).normalize() },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function loadCursor() {
  new GLTFLoader().load('./assets/models/cursor.glb', (gltf) => {
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    state.cursorSize = size.clone();
    model.position.sub(center);

    const hyperspaceModel = model.clone(true);
    state.cursorMaterial = createArrowMaterial(0xde2f28, THREE.FrontSide);
    state.hyperspaceArrowMaterial = createHyperspaceMaterial();
    model.traverse((child) => {
      if (child.isMesh) child.material = state.cursorMaterial;
    });
    hyperspaceModel.traverse((child) => {
      if (child.isMesh) child.material = state.hyperspaceArrowMaterial;
    });
    const arrowSphere = new THREE.Box3()
      .setFromObject(model)
      .getBoundingSphere(new THREE.Sphere());
    state.hyperspaceArrowRadius = Math.max(arrowSphere.radius, 0.001);

    const tiltAngle = THREE.MathUtils.degToRad(CONFIG.cursor.axisTilt[2]);
    state.cursor = new THREE.Group();
    state.cursorTilt = new THREE.Group();
    state.cursorSpin = new THREE.Group();
    state.cursorCounterTilt = new THREE.Group();
    state.cursorTilt.rotation.z = tiltAngle;
    state.cursorCounterTilt.rotation.z = -tiltAngle;
    state.cursorCounterTilt.add(model);
    state.cursorSpin.add(state.cursorCounterTilt);
    state.cursorTilt.add(state.cursorSpin);
    state.cursor.add(state.cursorTilt);
    state.cursor.visible = !hasHeroLeftViewport();
    state.scene.add(state.cursor);
    fitCursor();

    const hyperspaceTiltAngle = THREE.MathUtils.degToRad(
      CONFIG.hyperspace.axisTilt[2]
    );
    state.hyperspaceArrow = new THREE.Group();
    state.hyperspaceTilt = new THREE.Group();
    state.hyperspaceSpin = new THREE.Group();
    state.hyperspaceCounterTilt = new THREE.Group();
    state.hyperspaceTilt.rotation.z = hyperspaceTiltAngle;
    state.hyperspaceCounterTilt.rotation.z = -hyperspaceTiltAngle;
    state.hyperspaceCounterTilt.add(hyperspaceModel);
    state.hyperspaceSpin.add(state.hyperspaceCounterTilt);
    state.hyperspaceTilt.add(state.hyperspaceSpin);
    state.hyperspaceArrow.add(state.hyperspaceTilt);
    state.hyperspaceArrow.position.z = CONFIG.hyperspace.z;
    state.hyperspaceArrow.scale.setScalar(CONFIG.hyperspace.restScale);
    state.hyperspaceArrow.visible = false;
    state.hyperspaceScale = CONFIG.hyperspace.restScale;
    state.hyperspaceScaleStarted = false;
    state.scene.add(state.hyperspaceArrow);
  }, undefined, () => {});
}

function updatePointerFromEvent(event) {
  const rect = state.canvas.getBoundingClientRect();
  const normalizedX = event.clientX / Math.max(1, window.innerWidth);
  const normalizedY = event.clientY / Math.max(1, window.innerHeight);
  pointer.targetUv.set(
    normalizedX,
    1 - normalizedY
  );
  pointer.targetUv.x = THREE.MathUtils.clamp(pointer.targetUv.x, 0, 1);
  pointer.targetUv.y = THREE.MathUtils.clamp(pointer.targetUv.y, 0, 1);
  pointer.inside = true;
  const ellipseX = (normalizedX - 0.5) / 0.44;
  const ellipseY = (normalizedY - 0.44) / 0.32;
  const inHelloArea = ellipseX * ellipseX + ellipseY * ellipseY < 1;
  pointer.hover = inHelloArea ? 1 : 0;
}

function setupHyperspaceOverlay() {
  if (!state.hyperspaceSection) return;

  state.hyperspaceStages = Array.from(
    state.hyperspaceSection.querySelectorAll('[data-hs-stage]')
  );
  state.hyperspaceRings = Array.from(
    state.hyperspaceSection.querySelectorAll('[data-hs-ring]')
  );

  state.hyperspaceSection.querySelectorAll('[data-hs-line]').forEach((line, lineIndex) => {
    if (line.dataset.hsSplit === 'true') return;

    const text = line.textContent || '';
    const characters = Array.from(text);
    line.textContent = '';
    line.dataset.hsSplit = 'true';

    characters.forEach((character, characterIndex) => {
      const span = document.createElement('span');
      const noise = Math.abs(
        Math.sin((characterIndex + 1) * 12.9898 + (lineIndex + 1) * 78.233)
      );
      const spread =
        characterIndex / Math.max(1, characters.length - 1);
      const delay = Math.round(spread * 115 + noise * 175 + lineIndex * 70);

      span.className = 'hs-char';
      span.textContent = character === ' ' ? '\u00a0' : character;
      span.style.setProperty('--hs-delay', `${delay}ms`);
      line.appendChild(span);
    });
  });
}

function bindEvents() {
  window.addEventListener('pointermove', updatePointerFromEvent, { passive: true });
  window.addEventListener('pointerleave', () => {
    pointer.inside = false;
    pointer.targetUv.set(0.5, 0.5);
    pointer.hover = 0;
  }, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  state.heroSection = document.querySelector('.hero');
  state.heroStage = document.querySelector('.hero-stage');
  state.spaceSection = document.querySelector('[data-space]') || document.querySelector('.manifesto');
  state.hyperspaceSection = document.querySelector('[data-hyperspace]');
  setupHyperspaceOverlay();
  state.scrollWrapper = document.querySelector('[data-scroll-wrapper]') || window;
  state.scrollWrapper.addEventListener('scroll', () => {
    state.scrollY = state.scrollWrapper.scrollTop || window.scrollY || 0;
  }, { passive: true });
}

function resize() {
  if (!state.renderer || !state.canvas) return;
  const width = Math.max(1, state.canvas.clientWidth);
  const height = Math.max(1, state.canvas.clientHeight);

  applyCameraComposition();
  state.renderer.setSize(width, height, false);

  const targetWidth = Math.max(1, Math.floor(width * CONFIG.post.resolutionScale));
  const targetHeight = Math.max(1, Math.floor(height * CONFIG.post.resolutionScale));
  state.sceneTarget.setSize(targetWidth, targetHeight);
  state.refractionTarget.setSize(targetWidth, targetHeight);
  if (state.postTarget) state.postTarget.setSize(targetWidth, targetHeight);
  if (state.dotInputTarget) state.dotInputTarget.setSize(targetWidth, targetHeight);
  if (state.flareTarget) state.flareTarget.setSize(targetWidth, targetHeight);
  if (state.lensFlarePass) {
    state.lensFlarePass.setSize(
      state.renderer.domElement.width,
      state.renderer.domElement.height,
      width
    );
  }
  if (state.fluidPass) state.fluidPass.setSize(width, height);
  if (state.dotOverlayMaterial) {
    state.dotOverlayMaterial.uniforms.uResolution.value.set(width, height);
  }
  state.postMaterial.uniforms.uResolution.value.set(targetWidth, targetHeight);
  if (state.glassMaterial) {
    state.glassMaterial.uniforms.uScreenResolutionPx.value.set(targetWidth, targetHeight);
  }
  fitHello();
  fitCursor();
  layoutFloatingStickers();
}

function updateStickers(elapsed, delta) {
  if (!state.stickersStarted) {
    if (document.getElementById('boot')) {
      state.floatingStickers.forEach((item) => {
        item.mesh.material.opacity = 0;
      });
      return;
    }
    state.stickersStarted = true;
    state.stickersStartAt = elapsed + 0.35;
  }

  if (elapsed < state.stickersStartAt) {
    state.floatingStickers.forEach((item) => {
      item.mesh.material.opacity = 0;
    });
    return;
  }

  const scrollProgress = THREE.MathUtils.clamp(
    (state.scrollWrapper?.scrollTop || window.scrollY || 0) / Math.max(window.innerHeight, 1),
    0,
    1
  );
  const scrollFade = 1 - 0.45 * scrollProgress;

  state.floatingStickers.forEach((item) => {
    const viewport = stickerViewportAtZ(item.mesh.position.z);
    const halfHeight = viewport.height * 0.5;
    const centerY = state.camera.position.y;
    const lowerBound = centerY - halfHeight;
    const upperBound = centerY + halfHeight;

    item.mesh.position.y -= item.speed * delta;
    item.mesh.position.x = item.baseX + Math.sin(elapsed * item.sway + item.swayPhase) * item.sway;
    item.mesh.rotation.z += item.spin * delta;

    const normalizedY = THREE.MathUtils.clamp((item.mesh.position.y - lowerBound) / (upperBound - lowerBound), 0, 1);
    const edgeFade = THREE.MathUtils.smoothstep(normalizedY, 0, 0.16) * (1 - THREE.MathUtils.smoothstep(normalizedY, 0.76, 1));
    item.mesh.material.opacity = edgeFade * scrollFade;

    if (item.mesh.position.y < lowerBound - 1) {
      item.mesh.position.y =
        upperBound + 1 + Math.random() * (upperBound - lowerBound) * 0.9;
      item.baseXLane = createLaneRatio(item.lane, item.laneCount);
      item.baseX = item.baseXLane * item.spawnWidth;
      item.swayPhase = Math.random() * Math.PI * 2;
      item.mesh.rotation.z = THREE.MathUtils.randFloatSpread(Math.PI);
    }
  });
}

function updateScene(elapsed, delta) {
  const currentScrollY = state.scrollWrapper?.scrollTop || window.scrollY || 0;
  const scrollProgress = THREE.MathUtils.clamp(currentScrollY / Math.max(window.innerHeight, 1), 0, 1);
  const heroMotionProgress = THREE.MathUtils.smoothstep(scrollProgress, 0, 1);
  if (state.hello) {
    const compact = isCompactViewport();
    const yOffsetRatio = compact
      ? CONFIG.hello.compactYOffsetRatio
      : CONFIG.hello.yOffsetRatio;
    const baseRotationY = THREE.MathUtils.degToRad(CONFIG.hello.rotation[1]);
    const scrollRotationY = THREE.MathUtils.degToRad(86) * scrollProgress;
    state.hello.rotation.y = THREE.MathUtils.damp(
      state.hello.rotation.y,
      baseRotationY + scrollRotationY,
      6,
      delta
    );
    state.hello.position.y =
      viewportHeight() * yOffsetRatio +
      heroMotionProgress * viewportHeight() +
      Math.sin(elapsed * 0.65) * 0.16;
    state.hello.rotation.x = Math.sin(elapsed * 0.42) * 0.035;
  }

  if (state.cursor) {
    const targetSpin =
      THREE.MathUtils.degToRad(CONFIG.cursor.scrollSpinDegrees) *
      THREE.MathUtils.smoothstep(scrollProgress, 0, 1);
    state.cursorSpinAngle = THREE.MathUtils.damp(
      state.cursorSpinAngle,
      targetSpin,
      7,
      delta
    );
    if (state.cursorSpin) {
      state.cursorSpin.rotation.x = 0;
      state.cursorSpin.rotation.y = state.cursorSpinAngle;
      state.cursorSpin.rotation.z = 0;
    }
    const height = viewportHeight();
    const width = height * state.camera.aspect;
    const compact = isCompactViewport();
    state.cursor.position.x =
      compact ? CONFIG.cursor.compactPosition[0] : width * CONFIG.cursor.xRatio;
    state.cursor.position.y =
      (compact ? CONFIG.cursor.compactPosition[1] : height * CONFIG.cursor.yRatio) +
      heroMotionProgress * height * 1.35;
    state.cursor.position.z = compact ? CONFIG.cursor.compactPosition[2] : 3.5;
  }
}

function hasHeroLeftViewport() {
  if (!state.heroSection) return false;
  return state.heroSection.getBoundingClientRect().bottom <= 0;
}

function hasSpaceReachedViewport() {
  if (!state.spaceSection) return false;
  return state.spaceSection.getBoundingClientRect().top <= 0;
}

function updateCameraAndLight(delta) {
  const mobile = isMobileViewport();
  const targetX = mobile ? 0 : (0.5 - pointer.uv.x) * 2.8;
  const targetY = mobile ? 0 : (0.5 - pointer.uv.y) * 1.68;
  const smoothing = 1 - Math.exp(-6 * delta);
  state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, targetX, smoothing);
  state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, targetY, smoothing);
  state.camera.lookAt(-targetX * 0.12, -targetY * 0.12, 0);
  state.camera.updateMatrixWorld();

  if (state.glassMaterial) {
    if (mobile) {
      state.lightTargetAngle = Math.atan2(9, 4);
    } else {
      const dirX = pointer.uv.x - 0.5;
      const dirY = pointer.uv.y - 0.5;
      if (dirX * dirX + dirY * dirY > 0.0016) {
        state.lightTargetAngle = Math.atan2(-dirY, -dirX);
      }
    }
    const angleDelta = Math.atan2(
      Math.sin(state.lightTargetAngle - state.lightAngle),
      Math.cos(state.lightTargetAngle - state.lightAngle)
    );
    const lightSmoothing = 1 - Math.exp(-6 * delta);
    state.lightAngle += angleDelta * lightSmoothing;
    const radius = Math.hypot(4, 9);
    state.glassMaterial.uniforms.uLight.value.set(
      radius * Math.cos(state.lightAngle),
      radius * Math.sin(state.lightAngle),
      0.5
    );
  }

}

function updateCursorLight(delta) {
  if (!state.cursorMaterial && !state.hyperspaceArrowMaterial) return;

  state.cursorLightNdc.set(pointer.uv.x * 2 - 1, pointer.uv.y * 2 - 1);
  state.cursorLightRaycaster.setFromCamera(state.cursorLightNdc, state.camera);
  const hit = state.cursorLightRaycaster.ray.intersectPlane(
    state.cursorLightPlane,
    state.cursorLightPoint
  );
  const active = pointer.inside && !isMobileViewport() && hit !== null;
  const defaultAngle = Math.atan2(9, 4);
  let targetAngle = defaultAngle;

  if (active) {
    const x = -state.cursorLightPoint.x;
    const y = -state.cursorLightPoint.y;
    if (x * x + y * y > 1e-6) targetAngle = Math.atan2(y, x);
  }

  const angleDelta = Math.atan2(
    Math.sin(targetAngle - state.cursorLightAngle),
    Math.cos(targetAngle - state.cursorLightAngle)
  );
  state.cursorLightAngle += angleDelta * (1 - Math.exp(-6 * delta));

  const radius = Math.hypot(4, 9);
  const lightX = radius * Math.cos(state.cursorLightAngle);
  const lightY = radius * Math.sin(state.cursorLightAngle);
  [state.cursorMaterial, state.hyperspaceArrowMaterial].forEach((material) => {
    if (!material) return;
    material.uniforms.uLight.value.set(lightX, lightY, 0.5);
  });
}

function setHyperspaceStage(group) {
  if (state.hyperspaceStageGroup === group) return;
  state.hyperspaceStageGroup = group;
  state.hyperspaceStages.forEach((stage) => {
    stage.classList.toggle(
      'is-active',
      stage.dataset.hsStage === group
    );
  });
}

function hyperspaceRingRadius(distance) {
  const offset = distance - 150;
  const radiusSquared = 22500 - offset * offset;
  return radiusSquared > 0 ? Math.sqrt(radiusSquared) : 0;
}

function updateHyperspaceRings(progress) {
  if (!state.hyperspaceRings.length) return;

  state.hyperspaceRings.forEach((ring) => {
    ring.setAttribute('visibility', 'hidden');
  });
  if (state.hyperspaceStageGroup !== 'rings') return;

  const enterSpan = 300;
  const cycleDistance = 300;
  const totalDistance = 945;
  const travel = THREE.MathUtils.clamp(progress, 0, 1) * totalDistance;
  const mode = travel <= enterSpan ? 0 : travel <= enterSpan + cycleDistance ? 1 : 2;
  const localTravel = travel - (mode === 0 ? 0 : enterSpan + (mode - 1) * cycleDistance);
  const passIndex = mode === 0 ? Math.floor(localTravel / 50) : 0;
  const usedDistances = [];

  state.hyperspaceRings.forEach((ring, index) => {
    let distance = 0;

    if (mode === 0) {
      if (localTravel < index * 50) return;
      distance =
        localTravel -
        (Math.min(passIndex, 6) - index) * 50;
    } else if (mode === 1) {
      distance =
        ((localTravel + index * 50) % cycleDistance + cycleDistance) %
        cycleDistance;
    } else {
      distance = localTravel + index * 50;
    }

    if (distance <= 0 || distance >= 300) return;

    const radius = hyperspaceRingRadius(distance);
    if (radius <= 0) return;
    if (usedDistances.some((used) => Math.abs(used - distance) < 0.5)) {
      return;
    }
    usedDistances.push(distance);

    ring.setAttribute('visibility', 'visible');
    ring.setAttribute('cx', '172');
    ring.setAttribute('cy', String(22 + distance));
    ring.setAttribute('rx', String(radius));
    ring.setAttribute('ry', String(radius * 0.1));
  });
}

function updateHyperspaceOverlay() {
  if (!state.hyperspaceSection) return;

  const rect = state.hyperspaceSection.getBoundingClientRect();
  const viewportHeightPx = Math.max(window.innerHeight, 1);
  const visible = rect.top <= viewportHeightPx * 0.2 && rect.bottom > 0;
  const stage = THREE.MathUtils.clamp(
    Math.floor(-rect.top / viewportHeightPx),
    0,
    7
  );

  if (state.hyperspaceStageValue !== stage) {
    state.hyperspaceStageValue = stage;
    state.hyperspaceSection.dataset.stage = String(stage);
  }

  let group = '';
  if (visible) {
    if (stage <= 1) group = 'primary';
    else if (stage <= 3) group = 'secondary';
    else if (stage <= 5) group = 'rings';
    else group = 'end';
  }
  setHyperspaceStage(group);

  const ringProgress = THREE.MathUtils.clamp(
    (-rect.top - viewportHeightPx * 4) / (viewportHeightPx * 2),
    0,
    1
  );
  updateHyperspaceRings(ringProgress);
}

function updateHyperspaceArrow(elapsed, delta) {
  if (
    !state.hyperspaceArrow ||
    !state.hyperspaceSection ||
    !state.hyperspaceArrowRadius ||
    !state.hyperspaceArrowMaterial
  ) {
    return;
  }

  const rect = state.hyperspaceSection.getBoundingClientRect();
  const viewportHeightPx = Math.max(window.innerHeight, 1);
  const active = rect.top < viewportHeightPx && rect.bottom > 0;
  state.hyperspaceArrow.visible = active;

  if (!active) {
    state.hyperspaceScale = CONFIG.hyperspace.restScale;
    state.hyperspaceSpinAngle = 0;
    state.hyperspaceScaleStarted = false;
    state.hyperspaceArrow.scale.setScalar(CONFIG.hyperspace.restScale);
    state.hyperspaceSpin.rotation.y = 0;
    state.hyperspaceArrowMaterial.uniforms.uStripeReveal.value = 0;
    return;
  }

  const progress = THREE.MathUtils.clamp(
    (viewportHeightPx - rect.top) / Math.max(rect.height, 1),
    0,
    1
  );
  const entryProgress = THREE.MathUtils.clamp(
    (viewportHeightPx * 0.5 - rect.top) / (viewportHeightPx * 1.45),
    0,
    1
  );
  const sectionTravel = Math.max(0, -rect.top);
  const shrinkStart = Math.max(0, rect.height - viewportHeightPx * 1.62);
  const shrinkEnd = Math.max(
    shrinkStart + 1,
    rect.height - viewportHeightPx * 0.62
  );
  const grow = THREE.MathUtils.smoothstep(entryProgress, 0, 1);
  const shrink = THREE.MathUtils.smoothstep(
    sectionTravel,
    shrinkStart,
    shrinkEnd
  );
  const scaleT = grow * (1 - shrink);

  const worldViewport = stickerViewportAtZ(CONFIG.hyperspace.z);
  const maxScale =
    (Math.hypot(worldViewport.width, worldViewport.height) *
      CONFIG.hyperspace.autoPeakPadding) /
    state.hyperspaceArrowRadius;
  const scaleRatio = Math.max(maxScale / CONFIG.hyperspace.restScale, 1);
  const targetScale =
    CONFIG.hyperspace.restScale * Math.pow(scaleRatio, scaleT);

  if (!state.hyperspaceScaleStarted) {
    state.hyperspaceScale = targetScale;
    state.hyperspaceScaleStarted = true;
  } else {
    state.hyperspaceScale = THREE.MathUtils.damp(
      state.hyperspaceScale,
      targetScale,
      CONFIG.hyperspace.scaleSmoothing,
      delta
    );
  }
  state.hyperspaceArrow.scale.setScalar(state.hyperspaceScale);

  const targetSpin =
    THREE.MathUtils.degToRad(CONFIG.hyperspace.spinDegrees) * (grow + shrink);
  state.hyperspaceSpinAngle = THREE.MathUtils.damp(
    state.hyperspaceSpinAngle,
    targetSpin,
    14,
    delta
  );
  state.hyperspaceSpin.rotation.y = state.hyperspaceSpinAngle;

  const reveal = THREE.MathUtils.smoothstep(scaleT, 0.55, 0.95);
  const uniforms = state.hyperspaceArrowMaterial.uniforms;
  uniforms.uStripeReveal.value = reveal;
  uniforms.iTime.value = progress * 2;
  uniforms.iResolution.value.set(
    state.sceneTarget.width,
    state.sceneTarget.height,
    1
  );

  const arrowY = THREE.MathUtils.lerp(
    -worldViewport.height * (isMobileViewport() ? 0.36 : 0.26),
    -worldViewport.height * 0.025,
    grow
  );
  state.hyperspaceArrow.position.set(0, arrowY, CONFIG.hyperspace.z);
}

function viewportHeight() {
  return 2 * Math.tan(THREE.MathUtils.degToRad(state.camera.fov / 2)) * state.camera.position.z;
}

function render() {
  const delta = Math.min(state.clock.getDelta(), 0.05);
  const elapsed = state.clock.elapsedTime;

  const targetSmoothing = pointer.inside ? CONFIG.post.smoothing : CONFIG.post.leaveSmoothing;
  pointer.uv.lerp(pointer.targetUv, targetSmoothing);
  const instantVelocity = pointer.uv.clone().sub(pointer.previousUv);
  pointer.previousUv.copy(pointer.uv);
  pointer.velocity.lerp(instantVelocity, 0.28);
  const targetActive = pointer.hover
    ? THREE.MathUtils.clamp(pointer.velocity.length() * 65, 0, 0.8)
    : 0;
  const activeUniform = state.postMaterial.uniforms.uPointerActive;
  activeUniform.value += (targetActive - activeUniform.value) * 0.18;
  state.postMaterial.uniforms.uPointerVelocity.value.copy(pointer.velocity);
  state.postMaterial.uniforms.uMousePos.value.copy(pointer.uv);
  state.postMaterial.uniforms.uTime.value = elapsed;
  if (state.glassMaterial) {
    const glassUniforms = state.glassMaterial.uniforms;
    glassUniforms.uPointerScreen.value.copy(pointer.uv);
    glassUniforms.uTime.value = elapsed;
    const pointerEnergy = THREE.MathUtils.clamp(
      0.55 + pointer.velocity.length() * 45,
      0.55,
      1
    );
    glassUniforms.uPointerEnergy.value +=
      (pointerEnergy - glassUniforms.uPointerEnergy.value) * 0.16;
  }

  updateScene(elapsed, delta);
  updateStickers(elapsed, delta);
  updateCameraAndLight(delta);
  updateCursorLight(delta);
  updateHyperspaceArrow(elapsed, delta);
  updateHyperspaceOverlay();

  const heroLeftViewport = hasHeroLeftViewport();
  const spaceReachedViewport = hasSpaceReachedViewport();
  const stickersActive =
    state.stickersStarted &&
    elapsed >= state.stickersStartAt;
  if (state.hello) state.hello.visible = !heroLeftViewport;
  if (state.cursor) state.cursor.visible = !heroLeftViewport;
  state.heroStage?.classList.toggle(
    'is-hyperspace',
    Boolean(state.hyperspaceArrow?.visible)
  );
  if (state.lensFlarePass) {
    state.lensFlarePass.enabled = !state.hyperspaceArrow?.visible;
  }
  state.floatingStickers.forEach((item) => {
    item.mesh.visible = stickersActive;
  });

  const currentScrollY = state.scrollWrapper?.scrollTop || window.scrollY || 0;
  const dotProgress = THREE.MathUtils.clamp(
    currentScrollY / Math.max(window.innerHeight * 0.85, 1),
    0,
    1
  );
  if (state.dotOverlayMaterial) {
    state.dotOverlayMaterial.uniforms.uOpacity.value =
      THREE.MathUtils.smoothstep(dotProgress, 0, 1) * 0.46;
  }
  if (state.dotOverlay) {
    state.dotOverlay.visible =
      dotProgress > 0.0001 &&
      !spaceReachedViewport &&
      !state.hyperspaceArrow?.visible;
  }
  if (state.glassMaterial) {
    state.glassMaterial.uniforms.uTexture.value = state.refractionTarget.texture;
  }

  const helloWasVisible = Boolean(state.hello?.visible);
  if (state.hello) state.hello.visible = false;
  state.floatingStickers.forEach((item) => {
    item.wasVisibleForRefraction = item.mesh.visible;
    item.mesh.visible = false;
  });
  state.renderer.setRenderTarget(state.refractionTarget);
  state.renderer.clear();
  state.renderer.render(state.scene, state.camera);

  if (state.hello) state.hello.visible = helloWasVisible;
  state.floatingStickers.forEach((item) => {
    item.mesh.visible = item.wasVisibleForRefraction !== false;
  });
  state.renderer.setRenderTarget(state.sceneTarget);
  state.renderer.clear();
  state.renderer.render(state.scene, state.camera);

  state.renderer.setRenderTarget(state.postTarget);
  state.renderer.clear();
  state.renderer.render(state.postScene, state.postCamera);

  state.lensFlarePass.render(
    state.renderer,
    state.postTarget.texture,
    state.flareTarget
  );
  state.fluidPass.updatePointer(pointer.targetUv, pointer.inside, delta);
  state.fluidPass.render(
    state.renderer,
    state.flareTarget.texture,
    state.dotInputTarget
  );
  state.renderer.setRenderTarget(null);
  state.renderer.clear();
  state.renderer.render(state.finalScene, state.finalCamera);

  if (!state.readyShown) {
    state.readyShown = true;
    state.canvas.parentElement?.classList.add('is-ready');
  }
}

function animate() {
  if (!state.running) return;
  render();
  requestAnimationFrame(animate);
}

export function initHero3D(canvasEl) {
  if (!canvasEl || state.running) return;

  state.canvas = canvasEl;
  state.clock = new THREE.Clock();
  setupRenderer(canvasEl);
  setupScene();
  setupPost();
  loadHello();
  loadCursor();
  loadStickers();
  bindEvents();

  state.running = true;
  animate();

  state.resizeObserver = new ResizeObserver(() => resize());
  state.resizeObserver.observe(canvasEl);
  state.resizeObserver.observe(canvasEl.parentElement || canvasEl);
}

function bootstrapHero3D() {
  const host = document.querySelector('[data-hero-canvas]');
  if (!host) return;

  const existingCanvas = host.querySelector('canvas');
  const canvas = existingCanvas || document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  if (!canvas.parentElement) host.prepend(canvas);
  initHero3D(canvas);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapHero3D, { once: true });
} else {
  bootstrapHero3D();
}
