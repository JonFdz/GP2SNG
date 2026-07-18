# GP2SNG

A Windows desktop tool that converts [Guitar Pro](https://www.guitar-pro.com/) files into `.sng` charts for [YARG (Yet Another Rhythm Game)](https://yarg.in/).

## Download

Grab the latest `GP2SNG-*-portable.exe` from the [Releases](../../releases) page. It's portable — no installation. Double-click to run.

> On first launch Windows SmartScreen may warn about an unrecognized app (the build is unsigned). Click **More info → Run anyway**.

## Build from source

Prefer not to run an unsigned binary? Build your own — the result is byte-for-byte your own compile of this source.

**Prerequisites:** [Node.js](https://nodejs.org/) 20 or newer (includes npm) and [Git](https://git-scm.com/).

```bash
git clone <this repo>
cd GP2SNG
npm install
npm run dist
```

The portable executable lands in `dist/`. To run without packaging, use `npm run dev`.

## Usage

1. Launch GP2SNG.
2. Load a Guitar Pro file (`.gp`, `.gp5`, `.gpx`).
3. Map the drum track to YARG gems and preview the chart.
4. Export the `.sng`.

## License

[GPLv3](LICENSE).
