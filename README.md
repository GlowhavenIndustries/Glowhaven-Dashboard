# Glowhaven Dashboard

Glowhaven Dashboard is a local-first operations platform for companies that want one customizable workspace for monitoring, coordination, and future automation.

It is designed to be company-agnostic. Configure your organization, data sources, dashboards, and modules instead of rebuilding the app for every team.

## Current platform

Glowhaven combines common operational signals into one command surface:

- **Business KPIs** for revenue, orders, tickets, usage, and other company metrics
- **Incident Center** for operational failures and attention items
- **Automation Queue** for repeatable actions and future automation adapters
- **Team Activity** for shared workspace activity
- **GitHub Pipelines** for monitoring configured GitHub Actions repositories
- **Service Health** for endpoint uptime, failures, and latency
- **Calendar** with GitHub, Google Calendar, and compatible Outlook support
- **Weather** with Open-Meteo support, including temperature, conditions, wind, AQI, and UV
- **Dashboards** for separate workspaces such as Operations and Team
- **Access modes** with local admin editing and viewer UI modes
- **Search and modules** for filtering and extending workspaces
- **Import and export** for portable JSON configuration
- **Themes** with dark, light, neon, minimal, and console presentation modes
- **Responsive layout** for desktop, tablet, and mobile

## Why it exists

Most companies spread important information across separate dashboards, monitoring tools, project systems, calendars, and internal pages.

Glowhaven provides a single operational surface where teams can bring those signals together and eventually take action from the same workspace.

The goal is not to replace every specialized system. The goal is to give a company one place to understand what is happening.

## Architecture

### App shell

A state-driven dashboard controller manages:

- organization configuration
- workspaces
- roles
- module registration
- local persistence
- refresh actions
- configuration import and export

### Widget system

Widgets are independently loaded ES modules.

Current widget types:

- `calendar`
- `weather`
- `serverStatus`
- `githubProjects`
- `kpi`
- `incidents`
- `automations`
- `activity`

The operations widgets are adapter-ready. The interface is available now, while real company systems can be connected through dedicated data adapters.

### Data layer

`dataSources.js` provides shared:

- request timeouts
- retries
- response handling
- normalization
- source-specific fetchers

### Local-first configuration

Workspace configuration is stored in browser `localStorage` and can be exported or imported as JSON.

Local storage is not a replacement for enterprise authentication, authorization, secrets management, or encrypted server-side storage. The built-in admin/viewer selector is a UI mode, not enterprise authentication.

## Configure Glowhaven for a company

The default configuration is intentionally unconfigured for company data. Connect your own systems from Settings.

Customize:

- organization name
- dashboards
- widget layout
- GitHub repositories
- service health endpoints
- weather location
- calendar provider
- refresh intervals

Configuration can be changed in `app.js` or imported through the dashboard.

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

`npm run check` validates JavaScript syntax across the application modules.

No framework or bundler is required.

## Roadmap

Glowhaven is structured to grow into a broader operations platform.

Planned integration areas include:

- Slack and Microsoft Teams
- Jira and Linear
- Google Workspace and Microsoft 365
- Stripe and business KPI systems
- databases and internal APIs
- real automation execution
- secure authentication
- organization-level permissions
- encrypted secrets handling
- audit logs
- plugin and integration management

## Product direction

**Monitor. Understand. Coordinate. Act.**

Glowhaven Dashboard is the operating surface. A company's existing systems provide the signals and actions.

Built for teams that want a flexible command center they can shape around the way they work.
