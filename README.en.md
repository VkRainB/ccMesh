<div align="center">
  <img src="docs/screenshots/logo.png" width="128" height="128" alt="ccMesh" />
  <h1>ccMesh</h1>

  <p><strong>A lightweight cross-platform AI proxy gateway desktop app.</strong></p>

  <p>
    <img src="https://img.shields.io/github/v/release/VkRainB/ccMesh?label=version&color=blue" alt="version" />
    <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="license" />
    <a href="https://github.com/VkRainB/ccMesh/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/VkRainB/ccMesh/total?style=flat-square&color=6366f1&label=downloads"></a>
    <a href="https://github.com/VkRainB/ccMesh/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/VkRainB/ccMesh?style=flat-square&color=yellow&label=stars"></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows" />
    <img src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white" alt="macOS" />
    <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux" />
  </p>

  <p>
    <a href="https://github.com/VkRainB/ccMesh">GitHub</a>
    ·
    <a href="https://github.com/VkRainB/ccMesh/releases/latest">Download</a>
    ·
    <a href="docs/guides/auto-update-and-release.md">Updates & Release</a>
    ·
    <a href="README.md">中文</a>
  </p>
</div>

---

ccMesh is a desktop AI proxy gateway built with **Tauri 2 + Rust + React 19**. It unifies access to Claude, OpenAI, Codex, and other upstream providers on your machine, with protocol transformation, model mapping, endpoint rotation and circuit breaking, request analytics, and configuration management. Available on Windows, macOS, and Linux.

## Screenshots

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/dashboard/index.png" alt="Dashboard" /><br/><sub>Dashboard: proxy status, token overview, live request monitor</sub></td>
    <td align="center"><img src="docs/screenshots/endpoints/endpoints.png" alt="Endpoints" /><br/><sub>Endpoints: multi-endpoint management, model mapping, connectivity tests</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/config-profiles/profiles.png" alt="Config Profiles" /><br/><sub>Config Profiles: Claude Code / Codex channel management</sub></td>
    <td align="center"><img src="docs/screenshots/statistics/statistics.png" alt="Statistics" /><br/><sub>Statistics: usage summaries and per-endpoint breakdowns</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/sync/sync.png" alt="Sync" /><br/><sub>Sync: backup, restore, and export</sub></td>
    <td align="center"><img src="docs/screenshots/settings/settings.png" alt="Settings" /><br/><sub>Settings: global proxy, UA, and system options</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/screenshots/theme/index_theme_dark.png" alt="Dark theme" /><br/><sub>Dark theme UI</sub></td>
  </tr>
</table>

## Features

### Dashboard

- Start/stop the local proxy and view port status at a glance
- Today's token usage and request overview
- Live request monitor: model, duration, time-to-first-byte, token details

### Endpoints

- Multi-endpoint CRUD, drag-and-drop ordering, list/grid views
- Three transformers: **claude (passthrough)**, **openai (transform)**, **codex (Responses)**
- Model catalog, inbound/outbound model mapping, connectivity testing
- Model-aware rotation and circuit breaking to avoid unrelated endpoint failures

### Config Profiles

- Manage Claude Code `settings.json` and Codex `auth.json` + `config.toml` as channels
- Endpoint write / custom write modes with two-way form ↔ JSON sync
- Separate save vs. apply; automatic backup before overwriting live configs

### Statistics & Sync

- Historical usage by app, endpoint, and model
- Configuration and data backup, restore, and export

### Settings

- Global outbound proxy, Claude/Codex CLI User-Agent
- In-app auto-update via GitHub Releases

## Install

Latest installers are on [Releases](https://github.com/VkRainB/ccMesh/releases/latest). The built-in updater pulls new versions from GitHub (see [`docs/guides/auto-update-and-release.md`](docs/guides/auto-update-and-release.md)).

### Windows

Download `*-setup.exe` (NSIS) or `*.msi` and run the installer.

### macOS (currently unsigned)

Without Apple Developer signing and notarization, Gatekeeper may block the app on first launch. Recommended:

1. Drag ccMesh.app into Applications
2. **Right-click** ccMesh → **Open** → confirm **Open** again

If you see "damaged" errors, run in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/ccMesh.app
```

### Linux

Choose a package for your distro:

- **AppImage (recommended)**

  ```bash
  chmod +x ccMesh_*.AppImage
  ./ccMesh_*.AppImage
  ```

- **deb (Debian/Ubuntu)**

  ```bash
  sudo apt install ./ccMesh_*_amd64.deb
  ```

- **rpm (Fedora/RHEL)**

  ```bash
  sudo dnf install ./ccMesh-*.x86_64.rpm
  ```

<div align="center">
  <img src="docs/screenshots/linux/linux-desktop.png" alt="Linux desktop" height="320" /><br/><sub>ccMesh running on Linux desktop</sub>
</div>

## Build from source

**Prerequisites**

- Rust stable — https://rustup.rs
- Node.js LTS, pnpm 10+
- Tauri prerequisites for your platform — https://tauri.app/start/prerequisites/

**Development**

```bash
pnpm install
pnpm tauri dev      # start desktop dev environment
pnpm test           # frontend unit tests
```

**Production build**

```bash
pnpm tauri build
```

Platform-specific build deps:

- **Windows**: MSVC toolchain + WebView2
- **macOS**: Xcode Command Line Tools (universal binary)
- **Linux** (Ubuntu/Debian build host):

  ```bash
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf
  ```

> If updater signing artifacts are enabled, local `pnpm tauri build` requires `TAURI_SIGNING_PRIVATE_KEY` and related env vars. See [`docs/guides/auto-update-and-release.md`](docs/guides/auto-update-and-release.md).

**Checks**

```bash
pnpm check:front
pnpm check:rust
```

## Tech stack

Tauri 2, Rust, axum, reqwest (rustls), SQLite, React 19, TypeScript, Vite, TanStack Query, Tailwind CSS v4, shadcn/ui, CodeMirror 6.

## License

ccMesh is licensed under the [Apache License 2.0](LICENSE).

## Star History

<div align="center">
  <a href="https://www.star-history.com/?repos=VkRainB%2FccMesh&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=VkRainB/ccMesh&type=date&theme=dark&legend=top-left&sealed_token=OmgnNNQzzclHtZwIuWrOEc8XxKo3xhsRpveK8T6fe0ujcCtBDFp9vTV-0IQwQmf6310YFt_94eHJxLySyo02c1QHWKCUbODCsJu19q9woXAmu3g6VYECt6pvAl2OQypOOpUC66C14v5-kbrs4ZPl5t8CHARbYFiFo_APGYn_WIHs79VX9_78FvLS1xYT" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=VkRainB/ccMesh&type=date&legend=top-left&sealed_token=OmgnNNQzzclHtZwIuWrOEc8XxKo3xhsRpveK8T6fe0ujcCtBDFp9vTV-0IQwQmf6310YFt_94eHJxLySyo02c1QHWKCUbODCsJu19q9woXAmu3g6VYECt6pvAl2OQypOOpUC66C14v5-kbrs4ZPl5t8CHARbYFiFo_APGYn_WIHs79VX9_78FvLS1xYT" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=VkRainB/ccMesh&type=date&legend=top-left&sealed_token=OmgnNNQzzclHtZwIuWrOEc8XxKo3xhsRpveK8T6fe0ujcCtBDFp9vTV-0IQwQmf6310YFt_94eHJxLySyo02c1QHWKCUbODCsJu19q9woXAmu3g6VYECt6pvAl2OQypOOpUC66C14v5-kbrs4ZPl5t8CHARbYFiFo_APGYn_WIHs79VX9_78FvLS1xYT" />
    </picture>
  </a>
</div>
