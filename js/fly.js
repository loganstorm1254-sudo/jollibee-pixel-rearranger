const VERT = `#version 300 es
in vec2 aFrom;
in vec2 aTo;
in vec3 aColor;
in float aDelay;
uniform float uT;
uniform float uPoint;
out vec3 vColor;
void main() {
  float span = max(0.001, 1.0 - aDelay);
  float p = clamp((uT - aDelay) / span, 0.0, 1.0);
  p = p * p * (3.0 - 2.0 * p);
  float lift = sin(p * 3.14159265) * 0.07;
  vec2 pos = mix(aFrom, aTo, p);
  pos.y -= lift;
  gl_Position = vec4(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0);
  gl_PointSize = uPoint;
  vColor = aColor;
}
`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function animateCanvas2d(canvas, { size, packed, from, to, duration }) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const frame = ctx.createImageData(w, h);
  const count = from.length;
  const start = performance.now();
  const sx = w / size;
  const sy = h / size;

  return new Promise((resolve) => {
    const step = (now) => {
      const t = ease(Math.min(1, (now - start) / duration));
      const d = frame.data;
      d.fill(0);
      const stride = count > 90000 ? 2 : 1;
      for (let i = 0; i < count; i += stride) {
        const s = from[i];
        const dest = to[i];
        const x0 = s % size;
        const y0 = (s / size) | 0;
        const x1 = dest % size;
        const y1 = (dest / size) | 0;
        const delay = ((x0 + y0) / (size * 2)) * 0.22;
        let p = (t - delay) / (1 - delay);
        if (p < 0) p = 0;
        if (p > 1) p = 1;
        p = p * p * (3 - 2 * p);
        const x = (x0 + (x1 - x0) * p) * sx;
        const y = (y0 + (y1 - y0) * p) * sy - Math.sin(p * Math.PI) * 0.06 * h;
        const px = Math.max(0, Math.min(w - 1, x | 0));
        const py = Math.max(0, Math.min(h - 1, y | 0));
        const o = (py * w + px) * 4;
        const p4 = i * 4;
        d[o] = packed[p4];
        d[o + 1] = packed[p4 + 1];
        d[o + 2] = packed[p4 + 2];
        d[o + 3] = 255;
      }
      ctx.putImageData(frame, 0, 0);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function flyPixels(glCanvas, opts) {
  const { size, packed, from, to, view } = opts;
  const duration = opts.duration ?? Math.min(2200, 850 + from.length / 90);
  const fallback = view || glCanvas;
  let gl = null;
  try {
    gl = glCanvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  } catch {
    gl = null;
  }
  if (!gl) return animateCanvas2d(fallback, { size, packed, from, to, duration });

  glCanvas.classList.add("is-on");
  const count = from.length;
  const fromXY = new Float32Array(count * 2);
  const toXY = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const delay = new Float32Array(count);
  const inv = 1 / Math.max(1, size - 1);

  for (let i = 0; i < count; i++) {
    const s = from[i];
    const d = to[i];
    const x0 = s % size;
    const y0 = (s / size) | 0;
    fromXY[i * 2] = x0 * inv;
    fromXY[i * 2 + 1] = y0 * inv;
    toXY[i * 2] = (d % size) * inv;
    toXY[i * 2 + 1] = ((d / size) | 0) * inv;
    colors[i * 3] = packed[i * 4] / 255;
    colors[i * 3 + 1] = packed[i * 4 + 1] / 255;
    colors[i * 3 + 2] = packed[i * 4 + 2] / 255;
    delay[i] = ((x0 + y0) * inv) * 0.2;
  }

  let prog;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
  } catch {
    glCanvas.classList.remove("is-on");
    return animateCanvas2d(fallback, { size, packed, from, to, duration });
  }

  const bind = (name, data, n) => {
    const loc = gl.getAttribLocation(prog, name);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
  };

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.useProgram(prog);
  bind("aFrom", fromXY, 2);
  bind("aTo", toXY, 2);
  bind("aColor", colors, 3);
  bind("aDelay", delay, 1);

  const uT = gl.getUniformLocation(prog, "uT");
  const uPoint = gl.getUniformLocation(prog, "uPoint");
  const css = glCanvas.getBoundingClientRect().width || size;
  const point = Math.max(1.2, css / size);
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.disable(gl.DEPTH_TEST);

  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0.08, 0.03, 0.03, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uT, t);
      gl.uniform1f(uPoint, point);
      gl.drawArrays(gl.POINTS, 0, count);
      if (t < 1) requestAnimationFrame(step);
      else {
        glCanvas.classList.remove("is-on");
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}
