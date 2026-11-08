uniform sampler2D uVelocity;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;

  // Wall boundary condition: when a neighbor sample would fall outside the domain, substitute the
  // negative of the center cell's own velocity component instead of clamping to the edge texel. The
  // divergence at that edge then reads as if a mirror cell just outside had equal-and-opposite flow,
  // which drives the pressure solve to cancel outward velocity there — the fluid can't flow through
  // the wall, so it deflects/slides along it instead of just fading out at the edge. The x4 goes
  // beyond a plain physical mirror (which is a 1x factor) so the effect reads clearly even under a
  // real cursor's momentum, which is already partly dissipated by the time it reaches an edge in
  // normal use — this only affects texels actually on the boundary, so it can't touch any gesture
  // that doesn't reach a wall (unlike the shared dissipation/curl constants elsewhere in this file's
  // pipeline, this one can't regress unrelated behavior by construction).
  if (vL.x < 0.0) L = -C.x * 4.0;
  if (vR.x > 1.0) R = -C.x * 4.0;
  if (vT.y > 1.0) T = -C.y * 4.0;
  if (vB.y < 0.0) B = -C.y * 4.0;

  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
