import { rearrangePixels } from "./rearrange.js";

self.onmessage = (event) => {
  const { source, target, colorWeight } = event.data;
  const result = rearrangePixels(source, target, { colorWeight });
  self.postMessage(
    {
      pixels: result.pixels,
      from: result.from,
      to: result.to,
      meanError: result.meanError,
    },
    [result.pixels.buffer, result.from.buffer, result.to.buffer]
  );
};
