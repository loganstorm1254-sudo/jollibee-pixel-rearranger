/**
 * Permute source pixels so they reconstruct a target image.
 * Colors are never invented — only moved.
 *
 * Colorful photos: OKLab 3D-bin greedy in Morton order, then error swaps.
 * Two-color logos: map onto the dark/light axis of the source palette.
 */

export function srgbToOklab(r, g, b) {
  let R = r / 255;
  let G = g / 255;
  let B = b / 255;
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  R = lin(R);
  G = lin(G);
  B = lin(B);
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function colorDist(r, g, b, bg) {
  return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
}

function rgbErr(sr, sg, sb, tr, tg, tb) {
  const dr = sr - tr;
  const dg = sg - tg;
  const db = sb - tb;
  return dr * dr + dg * dg + db * db;
}

function sampleImage(image, maxEdge = 1400) {
  const sw = Math.max(1, image.naturalWidth || image.width);
  const sh = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  return { canvas, data: ctx.getImageData(0, 0, w, h), w, h };
}

function cornerBackground(data, w, h) {
  const d = data.data;
  const pts = [0, w - 1, (h - 1) * w, h * w - 1];
  const acc = [0, 0, 0, 0];
  for (const i of pts) {
    const o = i * 4;
    acc[0] += d[o];
    acc[1] += d[o + 1];
    acc[2] += d[o + 2];
    acc[3] += d[o + 3];
  }
  return [acc[0] / 4, acc[1] / 4, acc[2] / 4, acc[3] / 4];
}

function contentBounds(data, w, h) {
  const d = data.data;
  const bg = cornerBackground(data, w, h);
  const hasAlpha = bg[3] < 250;
  const thresh = hasAlpha ? 28 : 48;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let contentLuma = 0;
  let contentCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const a = d[o + 3];
      const r = d[o];
      const g = d[o + 1];
      const b = d[o + 2];
      const empty = hasAlpha ? a < 16 : a < 16 || colorDist(r, g, b, bg) < thresh;
      if (empty) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      contentLuma += luma(r, g, b);
      contentCount++;
    }
  }

  if (maxX < 0 || contentCount < 16) {
    return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1, fill: [255, 255, 255], contentCount: 0 };
  }

  const fill = contentLuma / contentCount < 140 ? [255, 255, 255] : [0, 0, 0];
  const padX = Math.max(2, Math.round((maxX - minX + 1) * 0.04));
  const padY = Math.max(2, Math.round((maxY - minY + 1) * 0.04));
  return {
    minX: Math.max(0, minX - padX),
    minY: Math.max(0, minY - padY),
    maxX: Math.min(w - 1, maxX + padX),
    maxY: Math.min(h - 1, maxY + padY),
    fill,
    contentCount,
  };
}

export function rasterizeSource(image, size) {
  const sample = sampleImage(image);
  const bounds = contentBounds(sample.data, sample.w, sample.h);
  const cw = bounds.maxX - bounds.minX + 1;
  const ch = bounds.maxY - bounds.minY + 1;
  const trimmedFrac = (cw * ch) / (sample.w * sample.h);
  const hasAlpha = cornerBackground(sample.data, sample.w, sample.h)[3] < 250;
  const isLogo = bounds.contentCount > 0 && (hasAlpha || trimmedFrac < 0.82);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = `rgb(${bounds.fill[0]}, ${bounds.fill[1]}, ${bounds.fill[2]})`;
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (isLogo) {
    const pad = Math.max(4, Math.round(size * 0.03));
    const inner = size - pad * 2;
    const scale = Math.min(inner / cw, inner / ch);
    const dw = cw * scale;
    const dh = ch * scale;
    ctx.drawImage(sample.canvas, bounds.minX, bounds.minY, cw, ch, (size - dw) / 2, (size - dh) / 2, dw, dh);
  } else {
    const scale = Math.max(size / sample.w, size / sample.h);
    const w = sample.w * scale;
    const h = sample.h * scale;
    ctx.drawImage(sample.canvas, (size - w) / 2, (size - h) / 2, w, h);
  }

  return ctx.getImageData(0, 0, size, size);
}

export function rasterizeStretch(image, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

function paletteSpread(pixels, count) {
  const bins = new Set();
  let chroma = 0;
  let n = 0;
  const step = Math.max(1, (count / 5000) | 0);
  for (let i = 0; i < count; i += step) {
    const o = i * 4;
    const r = pixels[o];
    const g = pixels[o + 1];
    const b = pixels[o + 2];
    const lab = srgbToOklab(r, g, b);
    chroma += Math.abs(lab.a) + Math.abs(lab.b);
    bins.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    n++;
  }
  return { meanChroma: chroma / Math.max(1, n), uniqueBins: bins.size };
}

function axisColors(pixels, count) {
  let minL = Infinity;
  let maxL = -Infinity;
  let dark = [0, 0, 0];
  let light = [255, 255, 255];
  const step = Math.max(1, (count / 8000) | 0);
  for (let i = 0; i < count; i += step) {
    const o = i * 4;
    const r = pixels[o];
    const g = pixels[o + 1];
    const b = pixels[o + 2];
    const y = luma(r, g, b);
    if (y < minL) {
      minL = y;
      dark = [r, g, b];
    }
    if (y > maxL) {
      maxL = y;
      light = [r, g, b];
    }
  }
  return { dark, light };
}

function dist2(r, g, b, color) {
  const dr = r - color[0];
  const dg = g - color[1];
  const db = b - color[2];
  return dr * dr + dg * dg + db * db;
}

function part1by1(n) {
  n &= 0x1ff;
  n = (n | (n << 8)) & 0x00ff00ff;
  n = (n | (n << 4)) & 0x0f0f0f0f;
  n = (n | (n << 2)) & 0x33333333;
  n = (n | (n << 1)) & 0x55555555;
  return n;
}

function morton2(x, y) {
  return (part1by1(y) << 1) | part1by1(x);
}

function mulberry(seed) {
  let t = seed | 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sortAssign(srcKeys, tgtKeys, count) {
  const srcOrder = new Uint32Array(count);
  const tgtOrder = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    srcOrder[i] = i;
    tgtOrder[i] = i;
  }
  srcOrder.sort((a, b) => srcKeys[a] - srcKeys[b]);
  tgtOrder.sort((a, b) => tgtKeys[a] - tgtKeys[b]);
  const srcAt = new Uint32Array(count);
  for (let k = 0; k < count; k++) srcAt[tgtOrder[k]] = srcOrder[k];
  return srcAt;
}

function limitedAssign(source, target, count) {
  const axis = axisColors(source, count);
  const srcKeys = new Float64Array(count);
  const tgtKeys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    srcKeys[i] =
      dist2(source[o], source[o + 1], source[o + 2], axis.light) -
      dist2(source[o], source[o + 1], source[o + 2], axis.dark);
    tgtKeys[i] =
      dist2(target[o], target[o + 1], target[o + 2], axis.light) -
      dist2(target[o], target[o + 1], target[o + 2], axis.dark);
  }
  return sortAssign(srcKeys, tgtKeys, count);
}

function labArrays(pixels, count) {
  const L = new Float32Array(count);
  const A = new Float32Array(count);
  const B = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const lab = srgbToOklab(pixels[o], pixels[o + 1], pixels[o + 2]);
    L[i] = lab.L;
    A[i] = lab.a;
    B[i] = lab.b;
  }
  return { L, A, B };
}

function binGreedyAssign(source, target, count, size) {
  const N = 20;
  const binCount = N * N * N;
  const srcLab = labArrays(source, count);
  const tgtLab = labArrays(target, count);
  const heads = new Int32Array(binCount).fill(-1);
  const next = new Int32Array(count);

  const toBin = (L, a, b) => {
    const li = Math.min(N - 1, Math.max(0, (L * N) | 0));
    const ai = Math.min(N - 1, Math.max(0, (((a + 0.45) / 0.9) * N) | 0));
    const bi = Math.min(N - 1, Math.max(0, (((b + 0.45) / 0.9) * N) | 0));
    return (li * N + ai) * N + bi;
  };

  for (let i = 0; i < count; i++) {
    const id = toBin(srcLab.L[i], srcLab.A[i], srcLab.B[i]);
    next[i] = heads[id];
    heads[id] = i;
  }

  const nonempty = [];
  for (let id = 0; id < binCount; id++) if (heads[id] >= 0) nonempty.push(id);

  const pop = (id) => {
    const i = heads[id];
    heads[id] = next[i];
    return i;
  };

  const popNearest = (L, a, b) => {
    const li = Math.min(N - 1, Math.max(0, (L * N) | 0));
    const ai = Math.min(N - 1, Math.max(0, (((a + 0.45) / 0.9) * N) | 0));
    const bi = Math.min(N - 1, Math.max(0, (((b + 0.45) / 0.9) * N) | 0));
    for (let r = 0; r <= 6; r++) {
      const l0 = Math.max(0, li - r);
      const l1 = Math.min(N - 1, li + r);
      const a0 = Math.max(0, ai - r);
      const a1 = Math.min(N - 1, ai + r);
      const b0 = Math.max(0, bi - r);
      const b1 = Math.min(N - 1, bi + r);
      for (let l = l0; l <= l1; l++) {
        for (let aa = a0; aa <= a1; aa++) {
          for (let bb = b0; bb <= b1; bb++) {
            if (r > 0 && l > l0 && l < l1 && aa > a0 && aa < a1 && bb > b0 && bb < b1) continue;
            const id = (l * N + aa) * N + bb;
            if (heads[id] >= 0) return pop(id);
          }
        }
      }
    }
    while (nonempty.length) {
      const id = nonempty[nonempty.length - 1];
      if (heads[id] >= 0) return pop(id);
      nonempty.pop();
    }
    return 0;
  };

  const visit = new Uint32Array(count);
  const mortonKeys = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    visit[i] = i;
    mortonKeys[i] = morton2(i % size, (i / size) | 0);
  }
  visit.sort((a, b) => mortonKeys[a] - mortonKeys[b]);

  const srcAt = new Uint32Array(count);
  for (let v = 0; v < count; v++) {
    const t = visit[v];
    srcAt[t] = popNearest(tgtLab.L[t], tgtLab.A[t], tgtLab.B[t]);
  }
  return srcAt;
}

function refineSwaps(source, target, srcAt, count, passes, rand) {
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < count; i++) {
      const j = (rand() * count) | 0;
      if (j === i) continue;
      const a = srcAt[i] * 4;
      const b = srcAt[j] * 4;
      const t0 = i * 4;
      const t1 = j * 4;
      const before =
        rgbErr(source[a], source[a + 1], source[a + 2], target[t0], target[t0 + 1], target[t0 + 2]) +
        rgbErr(source[b], source[b + 1], source[b + 2], target[t1], target[t1 + 1], target[t1 + 2]);
      const after =
        rgbErr(source[b], source[b + 1], source[b + 2], target[t0], target[t0 + 1], target[t0 + 2]) +
        rgbErr(source[a], source[a + 1], source[a + 2], target[t1], target[t1 + 1], target[t1 + 2]);
      if (after < before) {
        const tmp = srcAt[i];
        srcAt[i] = srcAt[j];
        srcAt[j] = tmp;
      }
    }
  }
}

function packResult(source, target, srcAt, count) {
  const pixels = new Uint8ClampedArray(count * 4);
  const from = new Uint32Array(count);
  const to = new Uint32Array(count);
  let errorAcc = 0;
  for (let t = 0; t < count; t++) {
    const s = srcAt[t] * 4;
    const o = t * 4;
    pixels[o] = source[s];
    pixels[o + 1] = source[s + 1];
    pixels[o + 2] = source[s + 2];
    pixels[o + 3] = 255;
    from[t] = srcAt[t];
    to[t] = t;
    errorAcc += rgbErr(source[s], source[s + 1], source[s + 2], target[o], target[o + 1], target[o + 2]);
  }
  return { pixels, from, to, meanError: Math.sqrt(errorAcc / count) };
}

export function rearrangePixels(source, target, options = {}) {
  const { seed = 1, size = Math.sqrt(source.length >> 2) | 0 } = options;
  const count = source.length >> 2;
  const spread = paletteSpread(source, count);
  const limited = spread.uniqueBins < 28 || spread.meanChroma < 0.08;
  const srcAt = limited
    ? limitedAssign(source, target, count)
    : binGreedyAssign(source, target, count, size);

  if (!limited) {
    const passes = count > 160000 ? 1 : 2;
    refineSwaps(source, target, srcAt, count, passes, mulberry(seed));
  }

  return packResult(source, target, srcAt, count);
}
