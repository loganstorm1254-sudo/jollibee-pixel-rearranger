import { rasterizeSource, rasterizeStretch, rearrangePixels } from "./rearrange.js";
import { flyPixels } from "./fly.js";

const TARGET_SRC = "./assets/target.png";
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)$/i;

const els = {
  app: document.getElementById("app"),
  frame: document.getElementById("frame"),
  view: document.getElementById("view"),
  fly: document.getElementById("fly"),
  drop: document.getElementById("drop"),
  file: document.getElementById("file"),
  download: document.getElementById("download"),
  status: document.getElementById("status"),
  size: document.getElementById("size"),
  sourceCanvas: document.getElementById("sourceCanvas"),
  targetCanvas: document.getElementById("targetCanvas"),
};

let sourceImage = null;
let targetImage = null;
let lastResult = null;
let targetPreview = null;
let running = false;
let comparing = false;

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
      text = text.replace(/<svg\b/i, `<svg width="${parts[2] || 1024}" height="${parts[3] || 1024}"`);
    }
    blob = new Blob([text], { type: "image/svg+xml" });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    if (!img.width || !img.height) throw new Error("empty image");
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawImageData(canvas, imageData, smooth = false) {
  const ctx = canvas.getContext("2d");
  if (canvas.width === imageData.width && canvas.height === imageData.height) {
    ctx.putImageData(imageData, 0, 0);
    return;
  }
  const tmp = document.createElement("canvas");
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext("2d").putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}

function fitSquareCanvas(canvas, pixels) {
  const css = canvas.getBoundingClientRect().width || pixels;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const dim = Math.max(pixels, Math.round(css * dpr));
  if (canvas.width !== dim || canvas.height !== dim) {
    canvas.width = dim;
    canvas.height = dim;
  }
}

function asImageData(pixels, size) {
  return new ImageData(new Uint8ClampedArray(pixels), size, size);
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

function runOnMainThread(sourceData, targetData, size) {
  return rearrangePixels(sourceData, targetData, { size });
}

function runInWorker(sourceData, targetData, size) {
  return new Promise((resolve, reject) => {
    const workerUrl = new URL("./worker.js", import.meta.url);
    workerUrl.searchParams.set("v", "3");
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
      size,
    });
  });
}

function showResult(imageData) {
  fitSquareCanvas(els.view, imageData.width);
  drawImageData(els.view, imageData, false);
}

function paintThumb(canvas, image, mode, size = 96) {
  const data = mode === "source" ? rasterizeSource(image, size) : rasterizeStretch(image, size);
  canvas.width = size;
  canvas.height = size;
  drawImageData(canvas, data, false);
  return data;
}

async function rearrange() {
  if (!sourceImage || !targetImage || running) return;
  running = true;
  els.download.disabled = true;
  els.frame.classList.remove("is-empty");
  setStatus("Matching…");

  const size = Number(els.size.value);
  const previewSize = 128;
  const sourcePreview = rasterizeSource(sourceImage, previewSize);
  const targetSmall = rasterizeStretch(targetImage, previewSize);
  paintThumb(els.sourceCanvas, sourceImage, "source");
  targetPreview = rasterizeStretch(targetImage, size);
  paintThumb(els.targetCanvas, targetImage, "target");

  fitSquareCanvas(els.view, previewSize);
  showResult(sourcePreview);

  try {
    const preview = runOnMainThread(sourcePreview.data, targetSmall.data, previewSize);
    showResult(asImageData(preview.pixels, previewSize));
  } catch {
    /* preview is optional */
  }

  const sourceData = rasterizeSource(sourceImage, size);
  const targetData = targetPreview;
  paintThumb(els.sourceCanvas, sourceImage, "source");

  const t0 = performance.now();
  let result;
  try {
    result = await runInWorker(sourceData.data, targetData.data, size);
  } catch {
    result = runOnMainThread(sourceData.data, targetData.data, size);
  }
  const ms = Math.round(performance.now() - t0);
  const imageData = asImageData(result.pixels, size);
  lastResult = { pixels: imageData.data, size, imageData };

  fitSquareCanvas(els.fly, size);
  try {
    await flyPixels(els.fly, {
      size,
      packed: packedFromMapping(sourceData.data, result.from),
      from: result.from,
      to: result.to,
      view: els.view,
    });
  } catch {
    /* still show the still */
  }
  showResult(imageData);
  els.download.disabled = false;
  running = false;
  setStatus(`${size}×${size} · ${ms}ms · hold to compare`);
}

async function onFile(file) {
  if (!isImageFile(file)) {
    setStatus("Use a PNG, JPG, SVG, WEBP, or GIF.", "error");
    return;
  }
  try {
    sourceImage = await loadFileAsImage(file);
    lastResult = null;
    await rearrange();
  } catch {
    setStatus("Could not read that image.", "error");
  }
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

function setComparing(on) {
  if (!lastResult || !targetPreview || running) return;
  comparing = on;
  showResult(on ? targetPreview : lastResult.imageData);
}

els.drop.addEventListener("click", () => els.file.click());
els.sourceCanvas.addEventListener("click", () => els.file.click());
els.file.addEventListener("change", (e) => onFile(e.target.files[0]));

["dragenter", "dragover"].forEach((type) => {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    els.frame.classList.add("is-over");
  });
});
window.addEventListener("dragleave", () => els.frame.classList.remove("is-over"));
window.addEventListener("drop", (e) => {
  e.preventDefault();
  els.frame.classList.remove("is-over");
  onFile(e.dataTransfer.files[0]);
});

window.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.items || [])]
    .find((item) => item.type.startsWith("image/"))
    ?.getAsFile();
  if (file) onFile(file);
});

els.frame.addEventListener("pointerdown", () => setComparing(true));
window.addEventListener("pointerup", () => setComparing(false));
els.frame.addEventListener("pointerleave", () => {
  if (comparing) setComparing(false);
});

els.download.addEventListener("click", downloadResult);
els.size.addEventListener("change", () => {
  if (sourceImage) rearrange();
});

async function boot() {
  try {
    targetImage = await loadImage(TARGET_SRC);
    paintThumb(els.targetCanvas, targetImage, "target");
    fitSquareCanvas(els.view, 512);
    drawImageData(els.view, rasterizeStretch(targetImage, 512), false);
  } catch {
    setStatus("Could not load the target image.", "error");
  }
}

boot();
