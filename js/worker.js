import { rearrangePixels } from "./rearrange.js?v=3";

self.onmessage = (event) => {
  const { source, target, size } = event.data;
  const result = rearrangePixels(source, target, { size });
  self.postMessage({
    pixels: result.pixels,
    from: result.from,
    to: result.to,
    meanError: result.meanError,
  });
};
