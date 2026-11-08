uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float dt;
uniform float dissipation;
varying vec2 vUv;

// Velocity is calibrated in UV-space-per-second (see main.js splat scale), so no
// texelSize conversion is needed here — that keeps this pass resolution-independent,
// which matters because uSource is advected at a different resolution than uVelocity
// when this runs against the (higher-res) dye field instead of velocity itself.
void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 coord = vUv - dt * vel;
  vec4 result = texture2D(uSource, coord);
  float decay = 1.0 + dissipation * dt;
  gl_FragColor = result / decay;
}
