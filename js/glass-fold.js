// Adapted from GradFlow's fold shader (MIT): github.com/meerbahadin/gradflow
(() => {
    const canvas = document.querySelector("[data-glass-fold]");
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance"
    });
    if (!gl) return;

    const vertexSource = `
        attribute vec2 position;
        varying vec2 vUv;

        void main() {
            vUv = position * 0.5 + 0.5;
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `;

    const fragmentSource = `
        #ifdef GL_FRAGMENT_PRECISION_HIGH
            precision highp float;
        #else
            precision mediump float;
        #endif

        uniform float u_time;
        uniform vec3 u_color1;
        uniform vec3 u_color2;
        uniform vec3 u_color3;
        uniform vec3 u_highlight;
        uniform float u_scale;
        uniform float u_noise;
        uniform vec2 u_resolution;

        varying vec2 vUv;

        float noise(vec2 st) {
            return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
        }

        mat2 Rot(float a) {
            float s = sin(a);
            float c = cos(a);
            return mat2(c, -s, s, c);
        }

        vec2 centered(vec2 uv) {
            vec2 p = uv - 0.5;
            p.x *= u_resolution.x / max(u_resolution.y, 1.0);
            return p;
        }

        vec3 foldGradient(vec2 uv, float time) {
            vec2 q = Rot(0.6) * centered(uv) * 2.0 * u_scale;
            float t = time * 0.6;
            float pixel = 2.0 * u_scale / max(u_resolution.y, 1.0);

            vec3 color = mix(
                u_color2,
                u_color2 * 0.45,
                clamp(length(centered(uv)) * 1.3, 0.0, 1.0)
            );

            for (int i = 0; i < 6; i++) {
                float fi = float(i);
                float bend = mod(fi, 2.0) * 2.0 - 1.0;

                float crease = (fi - 2.5) * 0.4
                    + 0.26 * sin(q.x * (1.05 + 0.12 * fi) + fi * 1.9 + t * (0.25 + 0.05 * fi))
                    + 0.1 * bend * q.x * q.x;
                float s = q.y - crease;
                float pane = smoothstep(-pixel, pixel, s);
                float back = max(s, 0.0);

                float body = exp(-back * 1.7);
                float fresnel = exp(-back * 8.0);
                float rim = exp(-back * 80.0);
                float innerD = (back - 0.045) / 0.014;
                float inner = exp(-innerD * innerD);
                float bloom = exp(-abs(s) * 20.0);

                vec3 tint = mix(
                    u_color1,
                    u_color3,
                    clamp(
                        fresnel * 0.6 + 0.08 + 0.14 * sin(fi * 2.1 + q.x * 0.8 + t * 0.2),
                        0.0,
                        1.0
                    )
                );
                vec3 light = tint * pane * (body * 0.42 + fresnel * 0.4)
                    + u_highlight * (pane * (rim * 0.6 + inner * 0.12) + bloom * 0.1);

                color += light * (1.0 - color);
            }

            return clamp(color, 0.0, 1.0);
        }

        void main() {
            vec3 color = foldGradient(vUv, u_time);
            float grain = noise(vUv * 200.0 + u_time * 0.1);
            color *= 1.0 - u_noise * 0.4 + u_noise * grain * 0.4;
            gl_FragColor = vec4(color, 1.0);
        }
    `;

    function compile(type, source) {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    let program = null;
    let buffer = null;
    let locations = null;

    function setup() {
        const vertex = compile(gl.VERTEX_SHADER, vertexSource);
        const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
        program = gl.createProgram();
        if (!vertex || !fragment || !program) return;

        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.bindAttribLocation(program, 0, "position");
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program);
            program = null;
            return;
        }

        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.useProgram(program);
        locations = {
            time: gl.getUniformLocation(program, "u_time"),
            color1: gl.getUniformLocation(program, "u_color1"),
            color2: gl.getUniformLocation(program, "u_color2"),
            color3: gl.getUniformLocation(program, "u_color3"),
            highlight: gl.getUniformLocation(program, "u_highlight"),
            scale: gl.getUniformLocation(program, "u_scale"),
            noise: gl.getUniformLocation(program, "u_noise"),
            resolution: gl.getUniformLocation(program, "u_resolution")
        };
    }

    const palettes = {
        warm: {
            color1: [1.0, 28 / 255, 0],
            color2: [3 / 255, 3 / 255, 2 / 255],
            color3: [243 / 255, 134 / 255, 14 / 255],
            highlight: [1.0, 0.94, 0.92]
        },
        cool: {
            color1: [0.14, 0.68, 1.0],
            color2: [2 / 255, 8 / 255, 13 / 255],
            color3: [0.28, 0.38, 1.0],
            highlight: [0.74, 0.93, 1.0]
        }
    };

    const settings = {
        color1: palettes.warm.color1,
        color2: palettes.warm.color2,
        color3: palettes.warm.color3,
        highlight: palettes.warm.highlight,
        speed: 0.5,
        scale: 1,
        noise: 0.12
    };

    const size = {
        width: 1,
        height: 1,
        cssWidth: 1,
        cssHeight: 1
    };
    let elapsed = 0;
    let lastFrame = null;
    let rafId = 0;
    let inView = false;
    let pageVisible = !document.hidden;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function render() {
        if (!program || !locations || size.width < 2 || size.height < 2) return;
        gl.viewport(0, 0, size.width, size.height);
        gl.uniform1f(locations.time, elapsed);
        gl.uniform3fv(locations.color1, settings.color1);
        gl.uniform3fv(locations.color2, settings.color2);
        gl.uniform3fv(locations.color3, settings.color3);
        gl.uniform3fv(locations.highlight, settings.highlight);
        gl.uniform1f(locations.scale, settings.scale);
        gl.uniform1f(locations.noise, settings.noise);
        gl.uniform2f(locations.resolution, size.cssWidth, size.cssHeight);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function applyTheme(theme) {
        const next = palettes[theme] || palettes.warm;
        settings.color1 = next.color1;
        settings.color2 = next.color2;
        settings.color3 = next.color3;
        settings.highlight = next.highlight;
        render();
    }

    function resize() {
        const parent = canvas.parentElement;
        if (!parent) return;
        const width = parent.clientWidth;
        const height = parent.clientHeight;
        if (!width || !height) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        size.cssWidth = width;
        size.cssHeight = height;
        size.width = Math.max(Math.round(width * dpr), 1);
        size.height = Math.max(Math.round(height * dpr), 1);
        canvas.width = size.width;
        canvas.height = size.height;
        render();
    }

    function animate(now) {
        const delta = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.1);
        lastFrame = now;
        elapsed += delta * settings.speed;
        render();
        rafId = requestAnimationFrame(animate);
    }

    function sync() {
        const shouldRun = inView && pageVisible && !reducedMotion.matches;
        if (shouldRun && !rafId) {
            lastFrame = null;
            rafId = requestAnimationFrame(animate);
        } else if (!shouldRun && rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
            render();
        }
    }

    canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        program = null;
        locations = null;
    });

    canvas.addEventListener("webglcontextrestored", () => {
        setup();
        render();
    });

    if ("ResizeObserver" in window) {
        new ResizeObserver(resize).observe(canvas.parentElement);
    } else {
        window.addEventListener("resize", resize, { passive: true });
    }

    if ("IntersectionObserver" in window) {
        new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            sync();
        }).observe(canvas);
    } else {
        inView = true;
    }

    document.addEventListener("visibilitychange", () => {
        pageVisible = !document.hidden;
        sync();
    });

    if (typeof reducedMotion.addEventListener === "function") {
        reducedMotion.addEventListener("change", sync);
    }

    window.addEventListener("themechange", (event) => {
        applyTheme(event.detail && event.detail.theme);
    });

    applyTheme(
        document.documentElement.classList.contains("cool") ? "cool" : "warm"
    );
    setup();
    resize();
    sync();
})();
