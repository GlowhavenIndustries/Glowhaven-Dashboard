# Apex Dashboard

**Tagline:** “Orchestrate your digital ecosystem—your way.”

Apex Dashboard is a modular, fully customizable web dashboard for connecting and monitoring the digital tools, services, and devices that power your personal or professional ecosystem. It is designed from the ground up to emphasize performance, privacy, and flexibility—no AI required.

## Quick start (recommended)

> **Why:** Opening `index.html` directly can block some features (like imports, local storage, or CORS). Running a tiny local server avoids those issues.

1. **Make sure you have Python installed**
   - macOS/Linux usually ship with Python.
   - Windows: install from https://www.python.org/downloads/.

2. **Start a local server**
   ```bash
   python -m http.server 5173
   ```

3. **Open the app**
   - Visit **http://localhost:5173** in your browser.

That’s it—no build step required.

## Alternate start (if you already use Node.js)

```bash
# from the repo folder
npx serve .
```

Then open the URL shown in your terminal.

## What you can do in the UI

- **Switch dashboards:** Use the dashboard selector at the top (Personal / Team).
- **Change role:** Toggle admin/viewer to see role-based UI changes.
- **Themes:** Try light/dark, neon, and console modes.
- **Export/Import:** Use the export/import buttons to share your layout.
- **Security:** Toggle encryption for local configuration storage.

## Configuration basics

Apex uses a local JSON configuration (stored in `localStorage`). You can export/import it from the UI. A default configuration is bundled in `app.js`.

**Data sources you might want to customize:**

- **Calendar** (GitHub, Google, Outlook)
- **Weather** (Open-Meteo or OpenWeather)
- **GitHub Projects** (personal token + repo list)
- **Server Status** (custom endpoint list)

If a provider needs an API key or token, leave it blank to use the default demo data.

## Plugins

1. Add plugin files under `plugins/`.
2. Register each plugin in `plugins/manifest.json`.
3. Each plugin must export:
   ```js
   export function init(dashboard) {
     // register widgets, data sources, or behaviors
   }
   ```

## Troubleshooting

- **Blank page or errors in console**
  - You likely opened `index.html` directly. Use the local server steps above.
- **Widgets not updating**
  - Make sure your API keys/tokens are valid and have the right permissions.
- **HTTPS/CORS errors**
  - Some APIs block browser requests without a backend. Consider proxying via a small server.

## Tech stack

- **Frontend:** HTML + CSS + JavaScript
- **Backend (optional):** Node.js + Express
- **Storage:** Local JSON config (`localStorage`) with optional AES-GCM encryption
- **Real-time:** WebSockets / Server-Sent Events (optional)

## Tests

```bash
npm test
```

## Experience highlights

- **Widget-based architecture** – Drag, resize, and rearrange modules like calendars, weather, server status, and GitHub projects.
- **Zero-compromise design** – Local storage with optional AES-GCM encryption and no forced logins.
- **Theming system** – Dark/light mode, neon glassmorphism, and a minimalist console mode toggle.
- **Plugin-ready** – Add new modules via the `/plugins` manifest and `init(dashboard)` hooks.
- **Team-ready controls** – Switch between personal/team dashboards with role-based access.
- **Portable configs** – Export and import dashboard configuration JSON.

## Concept

Think “Control Center for Everything,” but built to be fast, local-first, and fully under your control. Apex provides a widget-based architecture that lets you assemble a personalized command center for everything from calendars and weather to server status and pipeline telemetry.

## Why it fits Apex branding

- **Building the future** – Modern, modular, forward-looking design language.
- **On our terms** – Full user control over data, layout, and integrations.
- **Zero-compromise ecosystems** – Everything connected, privacy-first.

## Fun extras (optional)

- Animated futuristic loading screens with holographic-style CSS effects
- Minimalist “console mode” toggle for power users
- GitHub Actions integration for tracking personal project pipelines
