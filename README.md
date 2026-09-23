# GP2SNG

A Windows and macOS desktop tool that converts drum parts from [Guitar Pro](https://www.guitar-pro.com/) files into `.sng` drum charts for [YARG (Yet Another Rhythm Game)](https://yarg.in/).

## Download

Published builds are available from the [Releases](../../releases) page. Manually generated development artifacts are available from completed **Build artifacts** runs under the repository's **Actions** tab for one day.

- Windows: `GP2SNG-*-portable.exe` (portable; no installation).
- macOS Apple Silicon: `GP2SNG-*-arm64.dmg` or `GP2SNG-*-arm64-mac.zip`.
- macOS Intel: `GP2SNG-*-x64.dmg` or `GP2SNG-*-x64-mac.zip`.

Windows and macOS builds are currently unsigned. Windows SmartScreen may warn about an unrecognized app. On macOS, Gatekeeper may block the first launch; use **Open** from the app's Finder context menu or approve it in **System Settings → Privacy & Security** if you trust the downloaded build.

## Build from source

**Prerequisites:** [Node.js](https://nodejs.org/) 24 LTS or newer (includes npm) and [Git](https://git-scm.com/).

```bash
git clone https://github.com/JonFdz/GP2SNG.git
cd GP2SNG
npm ci
```

Build the portable Windows artifact on Windows with `npm run dist:win` (the existing `npm run dist` command remains an alias). On macOS, use `npm run dist:mac:arm64` on Apple Silicon or `npm run dist:mac:x64` on Intel. `npm run dist:mac` builds both architectures without creating a Universal binary. Artifacts land in `dist/`; use `npm run dev` to run without packaging.

To generate all platform artifacts manually in GitHub Actions, open **Actions → Build artifacts → Run workflow**. The workflow uses native Windows, Apple Silicon macOS, and Intel macOS runners, and runs tests, lint, and a production build before packaging.

## Usage

1. Launch GP2SNG.
2. Load a supported Guitar Pro file (`.gp`, using the GP7/GP8 ZIP/GPIF format).
3. Map the drum track to YARG gems and preview the chart.
4. Export the `.sng`.

## License

GP2SNG is free software licensed under [GNU GPL version 3 or later](LICENSE). The corresponding source is available in this repository. Bundled third-party notices are in [`THIRD_PARTY_LICENSES/`](THIRD_PARTY_LICENSES/).

Originally created by Alexander Celeste.

Currently maintained and developed by Jon Fernández.
