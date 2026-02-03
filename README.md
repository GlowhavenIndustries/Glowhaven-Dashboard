# Glowhaven Dashboard

**Tagline:** “Glowhaven Dashboard — Orchestrate your global digital ecosystem with precision.”

Glowhaven Dashboard is a fully modular command center for orchestrating digital ecosystems at personal, team, or enterprise scale. Built for flawless control, high-speed operation, and total security, it delivers zero-compromise engineering with extensibility at its core. Configure with JSON, integrate any API-enabled service, and keep every signal under Glowhaven-grade authority.

## Quick start (recommended)

Glowhaven Dashboard runs as a static web app. For full telemetry access, serve it from a local or managed web server.

1. **Start a local server**
   ```bash
   python -m http.server 5173
   ```

2. **Open the app**
   - Visit **http://localhost:5173** in your browser.

No build step required.

## Alternate start (Node.js)

```bash
# from the repo folder
npx serve .
```

Then open the URL shown in your terminal.

## Command experience highlights

- **Switch dashboards:** Personal and Team layouts with role-aware controls.
- **Role-based access:** Admins can rearrange; Viewers receive a read-only experience.
- **Themes:** Light/dark plus Glowhaven glow and minimalist console modes.
- **Export/Import:** Share or archive layouts with encrypted configuration exports.
- **Security:** AES-GCM encryption is enforced for local configuration storage.

## Configuration basics

Glowhaven Dashboard uses a local JSON configuration (stored in `localStorage`) and can export/import it from the UI. A default configuration is bundled in `app.js`, encrypted with AES-GCM.

**Data sources you might want to customize:**

- **Calendar** (GitHub, Google, Outlook)
- **Weather** (Open-Meteo or OpenWeather)
- **GitHub Projects** (token + repo list)
- **Global telemetry** (custom status endpoints)

If a provider needs an API key or token, set it in the config to activate production-ready connections.

## Plugins

1. Add plugin files under `plugins/`.
2. Register each plugin in `plugins/manifest.json`.
3. Assign allowed roles (`admin` / `viewer`) per plugin in the manifest.
4. Each plugin must export:
   ```js
   export function init(dashboard) {
     // register widgets, data sources, or behaviors
   }
   ```

## Operations notes

- **Telemetry delays** may indicate missing API keys/tokens or CORS limitations for browser-only calls.
- **Remote backups** can be enabled in `app.js` by setting a secure endpoint under `remoteBackup`.

## Tech stack

- **Frontend:** HTML + CSS + JavaScript
- **Backend (optional):** Node.js + Express (for proxying restricted APIs)
- **Storage:** Local JSON config (`localStorage`) with AES-GCM encryption
- **Real-time:** WebSockets / Server-Sent Events (optional)

## Tests

```bash
npm test
```

## Experience highlights

- **Widget-based architecture** – Drag, resize, and rearrange modules like calendars, weather, global telemetry, and pipeline oversight.
- **Zero-compromise design** – AES-GCM encryption, role-based access control, and optional secure remote backups.
- **Theming system** – Dark/light mode, Glowhaven glow accents, and a minimalist console mode.
- **Plugin-ready** – Add new modules via the `/plugins` manifest with role-based permissions.
- **Optional AI orchestration** – Integrate the Glowhaven AI Orchestrator plugin for anomaly alerts and layout recommendations.
- **Team-ready controls** – Switch between personal/team dashboards with role-based access.
- **Portable configs** – Export and import encrypted configuration JSON.

## Concept

Think “Control Center for Everything,” with Glowhaven-grade authority: fast, local-first, and fully under your control. Glowhaven Dashboard provides a modular command architecture that lets you assemble a personalized control center for everything from calendars and weather to server status and pipeline telemetry.
