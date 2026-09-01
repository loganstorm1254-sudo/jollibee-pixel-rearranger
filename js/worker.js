import { rearrangePixels } from "./rearrange.js?v=2";

self.onmessage = (event) => {
  const { source, target, colorWeight } = event.data;
  const result = rearrangePixels(source, target, { colorWeight });
  self.postMessage({
    pixels: result.pixels,
    from: result.from,
    to: result.to,
    meanError: result.meanError,
  });
};
