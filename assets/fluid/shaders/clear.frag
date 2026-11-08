uniform sampler2D uTexture;
uniform float value;
varying vec2 vUv;

// Decays a field toward zero by `value` before it's used as a Jacobi warm-start. Applied to the
// pressure field once per frame, before the pressure solve — without this, pressure from previous
// frames carries forward at full strength indefinitely, which is what caused runaway-looking
// spreading in earlier tuning attempts (confirmed by comparing against a known-working reference
// implementation, which always includes this step).
void main() {
  gl_FragColor = value * texture2D(uTexture, vUv);
}
