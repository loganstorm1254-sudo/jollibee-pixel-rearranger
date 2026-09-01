# Pixel Bee

Upload any photo. The app **rearranges that photo's own pixels** until they reconstruct the Jollibee mascot. No recoloring — every output pixel came from the upload.

Works as a static site on Vercel. All matching runs in the browser.

## GitHub

https://github.com/loganstorm1254-sudo/jollibee-pixel-rearranger

## Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import `loganstorm1254-sudo/jollibee-pixel-rearranger`.
2. Leave the defaults:
   - Framework preset: **Other**
   - Build command: empty
   - Output directory: empty (root)
3. Hit **Deploy**.

## Run locally

```bash
python3 -m http.server 4173
```

Open http://localhost:4173

A plain file open (`file://`) will not work, because the matcher runs in an ES-module worker.

## How the algorithm works

1. Center-crop the upload to a square and scale it to the same grid as the target (128–512).
2. Convert every pixel to [OKLab](https://bottosson.github.io/posts/oklab/).
3. Give each pixel a sort key: **luminance first**, then green–red / blue–yellow chroma. A small jitter breaks banding.
4. Sort the source pixels and the target positions by that key, then zip them. That pairing is a permutation of the source.
5. Dark source pixels land on outlines, bright ones on the hat and muzzle, and the rest fill the red.

The **Color match** slider trades shape (luminance) against hue. Lower is a clearer silhouette; higher pulls reds, whites, and blacks from the photo onto the matching regions of the mascot.

## Repo layout

```
index.html          UI
css/styles.css
js/app.js           upload, preview, animation, download
js/rearrange.js     OKLab permutation
js/worker.js        runs the matcher off the main thread
assets/target.png   the Jollibee target
vercel.json
```
