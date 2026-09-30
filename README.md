# Glowhaven Dashboard

Glowhaven Dashboard is a local-first operations platform for companies that want one customizable workspace for monitoring, coordination, and future automation.

It is designed to be **company-agnostic**: configure your organization, data sources, dashboards, and modules instead of rebuilding the app for every team.

## What it does

Glowhaven brings common operational signals into one command surface:

- **Business KPIs** — a ready-to-connect surface for revenue, orders, tickets, usage, and other company metrics.
- **Incident Center** — keep operational failures and attention items visible.
- **Automation Queue** — a first-class place for repeatable actions and future automation adapters.
- **Team Activity** — lightweight workspace activity and status.
- **GitHub Pipelines** — monitor the latest GitHub Actions run for configured repositories.
- **Service Health** — check configured endpoints for uptime, failures, and latency.
- **Calendar** — show activity from GitHub, Google Calendar, or a compatible Outlook endpoint.
- **Weather** — Open-Meteo support with temperature, conditions, wind, AQI, and UV.
- **Dashboards** — switch between different workspaces such as Operations and Team.
- **Access modes** — admin editing controls and viewer mode.
- **Search + modules** — filter widgets and add/remove modules from a workspace.
- **Import/export** — move workspace configuration between environments as JSON.
- **Themes** — dark/light, neon/minimal, and console presentation modes.
- **Responsive layout** — desktop, tablet, and mobile support without a framework or bundler.

## Architecture

### App shell
A small state-driven dashboard controller manages workspaces, roles, persistence, module registration, and refresh actions.

### Widget system
Widgets are independently loaded ES modules. Current modules include:

- `calendar`
- `weather`
- `serverStatus`
- `githubProjects`
- `kpi`
- `incidents`
- `automations`
- `activity`

The operations widgets are intentionally adapter-ready: the UI exists now, while real company systems can be connected through dedicated data adapters.

### Data layer
`dataSources.js` provides shared request handling, timeouts, retries, normalization, and source-specific fetchers.

### Local-first configuration
Workspace state is stored in browser `localStorage` and can be exported/imported as JSON.

**Important:** local configuration storage is not a substitute for enterprise authentication, authorization, secrets management, or encrypted server-side storage.

## Configure it for a company

Edit the configuration in `app.js` or import a JSON configuration.

Common things to customize:

- organization name
- dashboard layouts
- widget titles and placement
- GitHub repositories
- service health endpoints
- weather location
- calendar provider
- refresh intervals

The default configuration is intentionally generic so the same codebase can be adapted to another organization.

## Run locally

Start a static server from the repository root:

```bash
python -m http.server 5173
```

Then open:

`http://localhost:5173`

A modern browser with ES module support is required.

## Test and validate

Install Node.js, then run:

```bash
npm test
npm run check
```

`npm run check` validates the JavaScript modules for syntax errors.

No framework or bundler is required.

## Roadmap

Glowhaven Dashboard is structured to grow into a broader operations platform. Natural next integrations include:

- Slack / Microsoft Teams notifications
- Jira and Linear workflows
- Google Workspace and Microsoft 365
- Stripe and business KPI adapters
- database and internal API adapters
- real automation execution
- secure authentication and role management
- encrypted secrets handling
- audit logs and organization-level administration

## Project goal

**Glowhaven Dashboard is the operating surface. Your company's systems provide the signals and actions.**

Build the future, on your terms.
