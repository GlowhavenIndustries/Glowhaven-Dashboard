# Glowhaven Dashboard

Glowhaven Dashboard is a local-first, modular command center for Glowhaven Industries.

## v2 architecture

- **App shell:** state-driven dashboard controller with isolated widget modules.
- **Responsive UI:** desktop, tablet, and mobile layouts without a framework or build step.
- **Data layer:** shared timeout/retry/normalization utilities in `dataSources.js`.
- **Widgets:** calendar, weather, server health, and GitHub Actions are independently loaded.
- **Local persistence:** versioned configuration in localStorage with safe fallback on corrupt data.
- **Workspace controls:** dashboard switching, role-aware editing, module search, add/remove modules, import/export, themes, visual mode, and console mode.
- **Telemetry:** polling stream with subscriber-based updates.
- **Plugin foundation:** versioned manifest ready for isolated extensions.

## Run

```bash
python -m http.server 5173
```

Open `http://localhost:5173`.

## Test

```bash
npm test
npm run check
```

No framework or bundler is required.