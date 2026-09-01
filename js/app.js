import { rasterizeSource, rasterizeStretch, rearrangePixels } from "./rearrange.js";
import { flyPixels } from "./fly.js";

const TARGET_SRC = "./assets/target.png";
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)$/i;

const els = {
  drop: document.getElementById("drop"),
  file: document.getElementById("file"),
  run: document.getElementById("run"),
  download: document.getElementById("download"),
  status: document.getElementById("status"),
  size: document.getElementById("size"),
  animate: document.getElementById("animate"),
  sourceCanvas: document.getElementById("sourceCanvas"),
  targetCanvas: document.getElementById("targetCanvas"),
  view: document.getElementById("view"),
  fly: document.getElementById("fly"),
  frame: document.getElementById("frame"),
  filename: document.getElementById("filename"),
  errorMetric: document.getElementById("errorMetric"),
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
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

function paintCanvas(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  drawImageData(canvas, imageData, false);
}

function refreshPreviews() {
  if (!targetImage) return;
  const size = Number(els.size.value);
  targetPreview = rasterizeStretch(targetImage, size);
  paintCanvas(els.targetCanvas, targetPreview);
  if (sourceImage) {
    paintCanvas(els.sourceCanvas, rasterizeSource(sourceImage, size));
    els.run.disabled = false;
  }
}

async function rearrange() {
  if (!sourceImage || !targetImage || running) return;
  running = true;
  els.run.disabled = true;
  els.download.disabled = true;
  setStatus("Matching pixels…");

  const size = Number(els.size.value);
  const sourceData = rasterizeSource(sourceImage, size);
  const targetData = rasterizeStretch(targetImage, size);
  targetPreview = targetData;
  paintCanvas(els.sourceCanvas, sourceData);
  paintCanvas(els.targetCanvas, targetData);
  paintCanvas(els.view, sourceData);

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

  els.fly.width = size;
  els.fly.height = size;
  if (els.animate.checked) {
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
  }

  paintCanvas(els.view, imageData);
  els.run.disabled = false;
  els.download.disabled = false;
  running = false;
  setStatus("Done. Same pixels, new places.", "ok");
  els.errorMetric.textContent = `${size}×${size} · ${ms}ms · hold the result to compare`;
}

async function onFile(file) {
  if (!file) return;
  if (!isImageFile(file)) {
    setStatus("Use a PNG, JPG, SVG, WEBP, or GIF.", "error");
    return;
  }
  try {
    sourceImage = await loadFileAsImage(file);
    els.filename.textContent = file.name || "image";
    lastResult = null;
    refreshPreviews();
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
  paintCanvas(els.view, on ? targetPreview : lastResult.imageData);
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
window.addEventListener("drop", (e) => {
  if (e.target.closest?.("#drop")) return;
  e.preventDefault();
  onFile(e.dataTransfer.files[0]);
});
window.addEventListener("dragover", (e) => e.preventDefault());

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

els.run.addEventListener("click", rearrange);
els.download.addEventListener("click", downloadResult);
els.size.addEventListener("change", () => {
  refreshPreviews();
  if (sourceImage) rearrange();
});

async function boot() {
  try {
    targetImage = await loadImage(TARGET_SRC);
    refreshPreviews();
    setStatus("Drop any photo to begin.");
  } catch {
    setStatus("Could not load the target image.", "error");
  }
}

boot();
