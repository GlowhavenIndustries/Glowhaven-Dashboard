# Glowhaven Dashboard

Glowhaven Dashboard is a secure company operations platform for monitoring, coordination, integrations, and controlled automation.

It provides a shared operational surface for teams while keeping authentication, authorization, credentials, and audit data on the application server.

## Platform capabilities

- Business KPIs from company API endpoints
- Incident monitoring
- Automation inventory and controlled execution
- Team activity feeds
- GitHub Actions repository monitoring
- Service health monitoring
- Calendar integrations
- Weather monitoring
- Multiple operational workspaces
- Search and modular dashboard layout
- Role-aware controls
- Server-backed company settings
- Tamper-evident audit logging

## Security architecture

### Enterprise authentication

Glowhaven supports:

- Local administrator bootstrap with a memory-hard scrypt password hash
- Secure server-side sessions with expiring random session tokens
- Optional OIDC single sign-on with PKCE
- Role mapping for owner, admin, operator, and viewer accounts

The built-in role selector is no longer a security boundary. Protected actions are authorized on the server.

### Server-side secret storage

Integration credentials are never stored in browser localStorage.

Secrets are encrypted on the server using AES-256-GCM with a deployment-specific master key. The browser receives integration metadata and masked configuration only.

Production deployments must provide `GLOWHAVEN_MASTER_KEY` as a 32-byte key encoded as 64 hexadecimal characters.

### Hardened authorization

Mutating API requests require:

- an authenticated session
- an appropriate server-side role
- a matching same-origin request
- a valid CSRF token

Authentication attempts are rate limited.

Remote integration targets are validated. Localhost targets are blocked, and production private-network access is disabled unless the deployment explicitly enables it.

Production responses include security headers and HSTS.

### Audit logging

Administrative changes, authentication events, user creation, integration changes, organization changes, and automation execution are written to a server-side append-only audit log.

Each audit record includes a cryptographic hash linked to the previous record so unexpected changes can be detected.

## Application architecture

```
Browser
  |
  | authenticated session + CSRF protected API
  v
Glowhaven server
  |
  +-- Authentication
  +-- Authorization
  +-- Encrypted secret store
  +-- Audit log
  +-- Integration proxy
  |
  +-- GitHub
  +-- Company APIs
  +-- Service health endpoints
  +-- Calendar providers
  +-- Open-Meteo
```

The browser renders the operational UI. The server owns credentials and protected actions.

## Company setup

Start the server:

```bash
npm start
```

For local development, use `npm run dev`.

Open:

`http://localhost:5173`

On the first launch, Glowhaven asks for the initial administrator account.

Then open **Company settings** to configure:

- company name and timezone
- weather location
- service health URLs
- GitHub repositories and access token
- KPI endpoint
- incident endpoint
- automation endpoint
- activity endpoint
- calendar provider

Credentials entered through Company settings are sent to the authenticated server and stored encrypted there.

## Production configuration

Copy `.env.example` into your deployment environment and provide a strong master key.

For enterprise SSO, configure:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI`

Optional role mapping variables:

- `OIDC_ADMIN_EMAILS`
- `OIDC_ADMIN_GROUPS`

Run behind HTTPS in production.

Persistent application data lives under `GLOWHAVEN_DATA_DIR`, which should be backed by a protected persistent volume.

Docker deployment is included:

```bash
export GLOWHAVEN_MASTER_KEY="$(openssl rand -hex 32)"
docker compose up -d --build
```

Place the service behind an HTTPS reverse proxy in production.

## Roles

**Owner** has full administration access.

**Admin** can manage company settings, users, integrations, and audit access.

**Operator** can execute permitted operational actions.

**Viewer** has read-only operational access.

Role checks are enforced by the backend rather than by the browser.

## Security operations

Administrative actions are visible under Company settings in the Audit trail section.

The server stores password hashes, session records, encrypted integration secrets, and audit records under the configured runtime data directory. Runtime data is excluded from Git.

## Development

Use:

```bash
npm run dev
```

Validation:

```bash
npm test
npm run check
```

GitHub Actions runs the same validation automatically on repository changes.

No frontend framework or bundler is required.

## Deployment

Glowhaven can run as a single Node.js service behind a reverse proxy or load balancer.

For larger deployments, the storage layer can be replaced with managed database and session infrastructure while keeping the same server API boundary.

## Integration contract

Company endpoints should return JSON.

Common response shapes include:

```json
{
  "metrics": [
    {
      "label": "Revenue",
      "value": "$42k",
      "change": "+8%"
    }
  ]
}
```

```json
{
  "incidents": [
    {
      "id": "incident-123",
      "title": "API latency",
      "status": "open",
      "severity": "high"
    }
  ]
}
```

The integration layer is intentionally generic so companies can connect existing internal systems without changing the dashboard UI.

## Project direction

**Monitor. Understand. Coordinate. Act.**

Glowhaven is the operational surface. A company's existing systems provide the business data, events, and actions.
