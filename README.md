# Pixel Bee

Drop a photo. Its pixels fly into the Jollibee mascot. Nothing is recoloured.

Static site for Vercel. Matching runs in the browser.

## GitHub

https://github.com/loganstorm1254-sudo/jollibee-pixel-rearranger

## Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import `loganstorm1254-sudo/jollibee-pixel-rearranger`.
2. Leave Framework **Other**, build command empty, output directory empty.
3. Deploy.

## Run locally

```bash
python3 -m http.server 4173
```

Open http://localhost:4173

## How it works

Colorful photos are matched in OKLab with a 3D-bin greedy assignment (Morton order for spatial coherence), then pairwise swaps cut remaining error. Two-color logos (Apple, etc.) map onto the source palette’s dark/light axis so the mascot stays readable. Hold the result to compare with the target.
