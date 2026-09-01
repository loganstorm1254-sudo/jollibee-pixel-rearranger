import { rasterizeSource, rasterizeStretch, rearrangePixels } from "./rearrange.js";

const TARGET_SRC = "./assets/target.png";
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)$/i;

const els = {
  drop: document.getElementById("drop"),
  file: document.getElementById("file"),
  run: document.getElementById("run"),
  download: document.getElementById("download"),
  status: document.getElementById("status"),
  size: document.getElementById("size"),
  colorWeight: document.getElementById("colorWeight"),
  colorWeightValue: document.getElementById("colorWeightValue"),
  animate: document.getElementById("animate"),
  sourceCanvas: document.getElementById("sourceCanvas"),
  targetCanvas: document.getElementById("targetCanvas"),
  resultCanvas: document.getElementById("resultCanvas"),
  filename: document.getElementById("filename"),
  errorMetric: document.getElementById("errorMetric"),
};

let sourceImage = null;
let targetImage = null;
let lastResult = null;
let animFrame = 0;

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.dataset.kind = kind;
}

function isImageFile(file) {
  if (!file) return false;
  if (file.type.startsWith("image/")) return true;
  if (file.type === "application/octet-stream" || file.type === "") {
    return IMAGE_EXT.test(file.name);
  }
  return false;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

async function loadFileAsImage(file) {
  const isSvg = /svg/.test(file.type) || /\.svg$/i.test(file.name);
  let blob = file;
  if (isSvg) {
    let text = await file.text();
    if (!/\swidth\s*=/.test(text) || !/\sheight\s*=/.test(text)) {
      const vb = text.match(/viewBox\s*=\s*["']([^"']+)["']/i);
      const parts = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 1024, 1024];
      const w = parts[2] || 1024;
      const h = parts[3] || 1024;
      text = text.replace(/<svg\b/i, `<svg width="${w}" height="${h}"`);
    }
    blob = new Blob([text], { type: "image/svg+xml" });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    if (!img.width || !img.height) {
      throw new Error("empty image");
    }
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawImageData(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(imageData, 0, 0);
}

function paintImage(canvas, image, mode) {
  const size = Number(els.size.value);
  const data = mode === "source" ? rasterizeSource(image, size) : rasterizeStretch(image, size);
  drawImageData(canvas, data);
  return data;
}

async function refreshPreviews() {
  if (!targetImage) return;
  paintImage(els.targetCanvas, targetImage, "target");
  if (sourceImage) {
    paintImage(els.sourceCanvas, sourceImage, "source");
    els.run.disabled = false;
  }
}

async function onFile(file) {
  if (!isImageFile(file)) {
    setStatus("Use a PNG, JPG, SVG, WEBP, or GIF.", "error");
    return;
  }
  try {
    sourceImage = await loadFileAsImage(file);
    els.filename.textContent = file.name || "image";
    els.download.disabled = true;
    lastResult = null;
    await refreshPreviews();
    setStatus("");
  } catch {
    setStatus("Could not read that image.", "error");
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function animateResult(size, packed, from, to) {
  cancelAnimationFrame(animFrame);
  const canvas = els.resultCanvas;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const frame = ctx.createImageData(size, size);
  const count = from.length;
  const duration = Math.min(1800, 700 + count / 80);
  const start = performance.now();

  const step = (now) => {
    const t = easeInOutCubic(Math.min(1, (now - start) / duration));
    frame.data.fill(0);
    for (let i = 0; i < count; i++) {
      const s = from[i];
      const d = to[i];
      const x0 = s % size;
      const y0 = (s / size) | 0;
      const x1 = d % size;
      const y1 = (d / size) | 0;
      const x = (x0 + (x1 - x0) * t + 0.5) | 0;
      const y = (y0 + (y1 - y0) * t + 0.5) | 0;
      const o = (y * size + x) * 4;
      const p = i * 4;
      frame.data[o] = packed[p];
      frame.data[o + 1] = packed[p + 1];
      frame.data[o + 2] = packed[p + 2];
      frame.data[o + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
    if (t < 1) {
      animFrame = requestAnimationFrame(step);
    } else {
      const final = ctx.createImageData(size, size);
      for (let i = 0; i < count; i++) {
        const d = to[i] * 4;
        const p = i * 4;
        final.data[d] = packed[p];
        final.data[d + 1] = packed[p + 1];
        final.data[d + 2] = packed[p + 2];
        final.data[d + 3] = 255;
      }
      ctx.putImageData(final, 0, 0);
    }
  };

  animFrame = requestAnimationFrame(step);
}

function packedFromMapping(sourceData, from) {
  const count = from.length;
  const packed = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const s = from[i] * 4;
    const p = i * 4;
    packed[p] = sourceData[s];
    packed[p + 1] = sourceData[s + 1];
    packed[p + 2] = sourceData[s + 2];
    packed[p + 3] = 255;
  }
  return packed;
}

function asImageData(pixels, size) {
  const copy = new Uint8ClampedArray(pixels);
  return new ImageData(copy, size, size);
}

function runOnMainThread(sourceData, targetData, colorWeight) {
  return rearrangePixels(sourceData, targetData, { colorWeight });
}

function runInWorker(sourceData, targetData, colorWeight) {
  return new Promise((resolve, reject) => {
    const workerUrl = new URL("./worker.js", import.meta.url);
    workerUrl.searchParams.set("v", "2");
    const worker = new Worker(workerUrl, { type: "module" });
    worker.onmessage = (event) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({
      source: new Uint8ClampedArray(sourceData),
      target: new Uint8ClampedArray(targetData),
      colorWeight,
    });
  });
}

async function rearrange() {
  if (!sourceImage || !targetImage) return;
  const size = Number(els.size.value);
  const colorWeight = Number(els.colorWeight.value);
  els.run.disabled = true;
  els.download.disabled = true;
  setStatus("Matching…");

  const sourceData = rasterizeSource(sourceImage, size);
  const targetData = rasterizeStretch(targetImage, size);
  drawImageData(els.sourceCanvas, sourceData);
  drawImageData(els.targetCanvas, targetData);

  const t0 = performance.now();
  let result;
  try {
    result = await runInWorker(sourceData.data, targetData.data, colorWeight);
  } catch {
    result = runOnMainThread(sourceData.data, targetData.data, colorWeight);
  }
  const ms = Math.round(performance.now() - t0);

  const imageData = asImageData(result.pixels, size);
  lastResult = {
    pixels: imageData.data,
    size,
    meanError: result.meanError,
  };

  els.errorMetric.textContent = `${size}×${size} · ${ms}ms`;

  if (els.animate.checked) {
    const packed = packedFromMapping(sourceData.data, result.from);
    animateResult(size, packed, result.from, result.to);
  } else {
    cancelAnimationFrame(animFrame);
    drawImageData(els.resultCanvas, imageData);
  }

  els.run.disabled = false;
  els.download.disabled = false;
  setStatus("");
}

function downloadResult() {
  if (!lastResult) return;
  const canvas = document.createElement("canvas");
  canvas.width = lastResult.size;
  canvas.height = lastResult.size;
  canvas.getContext("2d").putImageData(asImageData(lastResult.pixels, lastResult.size), 0, 0);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "jollibee-pixels.png";
  a.click();
}

els.drop.addEventListener("click", () => els.file.click());
els.drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.file.click();
  }
});
els.file.addEventListener("change", (e) => onFile(e.target.files[0]));

["dragenter", "dragover"].forEach((type) => {
  els.drop.addEventListener(type, (e) => {
    e.preventDefault();
    els.drop.classList.add("is-over");
  });
});
["dragleave", "drop"].forEach((type) => {
  els.drop.addEventListener(type, (e) => {
    e.preventDefault();
    els.drop.classList.remove("is-over");
  });
});
els.drop.addEventListener("drop", (e) => onFile(e.dataTransfer.files[0]));

window.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.items || [])]
    .find((item) => item.type.startsWith("image/"))
    ?.getAsFile();
  if (file) onFile(file);
});

els.run.addEventListener("click", rearrange);
els.download.addEventListener("click", downloadResult);
els.size.addEventListener("change", refreshPreviews);
els.colorWeight.addEventListener("input", () => {
  els.colorWeightValue.textContent = Number(els.colorWeight.value).toFixed(2);
});

async function boot() {
  try {
    targetImage = await loadImage(TARGET_SRC);
    await refreshPreviews();
    setStatus("");
  } catch {
    setStatus("Could not load the target image.", "error");
  }
}

boot();
