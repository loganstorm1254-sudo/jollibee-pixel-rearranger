/**
 * Permute source pixels so they reconstruct a target image.
 * Source pixels are never recoloured — only moved.
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

function sampleImage(image, maxEdge = 1024) {
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
  return { canvas, ctx, data: ctx.getImageData(0, 0, w, h), w, h };
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
      const empty = hasAlpha
        ? a < 16
        : a < 16 || colorDist(r, g, b, bg) < thresh;
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

  const avg = contentCount ? contentLuma / contentCount : 128;
  const fill = avg < 140 ? [255, 255, 255] : [0, 0, 0];
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
    const pad = Math.max(4, Math.round(size * 0.04));
    const inner = size - pad * 2;
    const scale = Math.min(inner / cw, inner / ch);
    const dw = cw * scale;
    const dh = ch * scale;
    ctx.drawImage(
      sample.canvas,
      bounds.minX,
      bounds.minY,
      cw,
      ch,
      (size - dw) / 2,
      (size - dh) / 2,
      dw,
      dh
    );
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
  ctx.drawImage(image, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

function paletteSpread(pixels, count) {
  let minL = 1;
  let maxL = 0;
  let chroma = 0;
  const bins = new Set();
  const step = Math.max(1, (count / 4000) | 0);
  let n = 0;
  for (let i = 0; i < count; i += step) {
    const o = i * 4;
    const r = pixels[o];
    const g = pixels[o + 1];
    const b = pixels[o + 2];
    const lab = srgbToOklab(r, g, b);
    if (lab.L < minL) minL = lab.L;
    if (lab.L > maxL) maxL = lab.L;
    chroma += Math.abs(lab.a) + Math.abs(lab.b);
    bins.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4));
    n++;
  }
  return {
    lumaRange: maxL - minL,
    meanChroma: chroma / Math.max(1, n),
    uniqueBins: bins.size,
  };
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

export function rearrangePixels(source, target, options = {}) {
  const { colorWeight = 0.18, seed = 1 } = options;
  const count = source.length >> 2;
  const spread = paletteSpread(source, count);
  const limited = spread.uniqueBins < 28 || spread.meanChroma < 0.08;
  const weight = limited ? 0 : colorWeight;
  const axis = limited ? axisColors(source, count) : null;

  const srcKeys = new Float64Array(count);
  const tgtKeys = new Float64Array(count);
  const srcOrder = new Uint32Array(count);
  const tgtOrder = new Uint32Array(count);

  let rng = seed || 1;
  const rand = () => {
    rng = (rng * 16807) % 2147483647;
    return rng / 2147483647;
  };

  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (limited) {
      const key = (r, g, b) =>
        dist2(r, g, b, axis.light) - dist2(r, g, b, axis.dark) + i * 1e-6;
      srcKeys[i] = key(source[o], source[o + 1], source[o + 2]);
      tgtKeys[i] = key(target[o], target[o + 1], target[o + 2]);
    } else {
      const sLab = srgbToOklab(source[o], source[o + 1], source[o + 2]);
      const tLab = srgbToOklab(target[o], target[o + 1], target[o + 2]);
      const pack = (lab) => {
        const lumaKey = lab.L * 100;
        const chromaKey = (lab.a + 0.4) * 40 + (lab.b + 0.4);
        const lumaScale = 1 + 24 * (1 - weight);
        const chromaScale = 1 + 18 * weight;
        return lumaKey * lumaScale * 1e4 + chromaKey * chromaScale * 10 + rand() * 0.8;
      };
      srcKeys[i] = pack(sLab);
      tgtKeys[i] = pack(tLab);
    }
    srcOrder[i] = i;
    tgtOrder[i] = i;
  }

  srcOrder.sort((a, b) => srcKeys[a] - srcKeys[b]);
  tgtOrder.sort((a, b) => tgtKeys[a] - tgtKeys[b]);

  const pixels = new Uint8ClampedArray(source.length);
  const from = new Uint32Array(count);
  const to = new Uint32Array(count);

  let errorAcc = 0;
  for (let k = 0; k < count; k++) {
    const srcI = srcOrder[k];
    const tgtI = tgtOrder[k];
    const s = srcI * 4;
    const t = tgtI * 4;
    pixels[t] = source[s];
    pixels[t + 1] = source[s + 1];
    pixels[t + 2] = source[s + 2];
    pixels[t + 3] = 255;
    from[k] = srcI;
    to[k] = tgtI;

    const dr = source[s] - target[t];
    const dg = source[s + 1] - target[t + 1];
    const db = source[s + 2] - target[t + 2];
    errorAcc += dr * dr + dg * dg + db * db;
  }

  return {
    pixels,
    from,
    to,
    meanError: Math.sqrt(errorAcc / count),
  };
}
