uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curlStrength;
uniform float dt;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;

  vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
  force *= 1.0 / (length(force) + 0.0001) * curlStrength * C;

  vec2 vel = texture2D(uVelocity, vUv).xy;
  vel += force * dt;
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
