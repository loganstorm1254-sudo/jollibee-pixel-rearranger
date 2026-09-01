/**
 * Permute source pixels so they reconstruct a target image.
 *
 * Every output pixel is a pixel that existed in the source. Nothing is
 * recoloured — we only change where each source pixel sits.
 *
 * Matching: convert RGB → OKLab, then sort both images by (L, a, b).
 * Luminance carries the target's shapes; a/b carry hue so reds, whites,
 * and blacks from the photo land on the matching regions of the target.
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

export function sortKey(r, g, b, jitter = 0) {
  const lab = srgbToOklab(r, g, b);
  return lab.L * 1e8 + (lab.a + 0.5) * 1e4 + (lab.b + 0.5) * 1e2 + jitter;
}

export function rearrangePixels(source, target, options = {}) {
  const { colorWeight = 0.18, seed = 1 } = options;
  const count = source.length >> 2;

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
    const sJitter = rand() * 0.8;
    const tJitter = rand() * 0.8;

    const sLab = srgbToOklab(source[o], source[o + 1], source[o + 2]);
    const tLab = srgbToOklab(target[o], target[o + 1], target[o + 2]);

    const pack = (lab, jitter) => {
      const luma = lab.L * 100;
      const chroma = (lab.a + 0.4) * 40 + (lab.b + 0.4);
      const lumaScale = 1 + 24 * (1 - colorWeight);
      const chromaScale = 1 + 18 * colorWeight;
      return luma * lumaScale * 1e4 + chroma * chromaScale * 10 + jitter;
    };

    srcKeys[i] = pack(sLab, sJitter);
    tgtKeys[i] = pack(tLab, tJitter);
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

export function rasterizeCover(image, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const scale = Math.max(size / image.width, size / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
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
