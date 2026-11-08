uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
varying vec2 vUv;

void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  float splat = exp(-dot(p, p) / radius);
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat * color, 1.0);
}
