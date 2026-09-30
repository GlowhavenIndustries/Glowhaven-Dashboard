import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkIntegrationAccess } from '../server/security.js';
import { extractGroups, roleForClaims } from '../server/oidc.js';
import { fetchAwsSecret, fetchVaultSecret, fetchAzureKeyVaultSecret, resolveExternalMasterKey } from '../server/secretManager.js';

test('enterprise features: user lifecycle, API keys, audit search/CSV, and SSO domain policy', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glowhaven-ent-test-'));
  const oldDir = process.env.GLOWHAVEN_DATA_DIR;
  const oldKey = process.env.GLOWHAVEN_MASTER_KEY;

  try {
    process.env.GLOWHAVEN_DATA_DIR = dir;
    process.env.GLOWHAVEN_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const storage = await import('../server/storage.js?' + Date.now());
    const security = await import('../server/security.js?' + Date.now());
    const auth = await import('../server/auth.js?' + Date.now());

    const state = await storage.loadState();
    state.users = [];
    state.sessions = {};
    state.apiKeys = [];
    state.securityPolicy = { enforceSso: false, ssoDomains: [], minPasswordLength: 12 };

    const ownerRes = await auth.setupOwner(state, { socket: { remoteAddress: '127.0.0.1' } }, 'owner@enterprise.com', 'SuperSecurePassword123!');
    assert.ok(ownerRes.token);

    const newUser = {
      id: 'u-123',
      email: 'operator@enterprise.com',
      role: 'operator',
      password: security.hashPassword('OperatorPassword123!'),
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    state.users.push(newUser);

    const userLogin = await auth.login(state, { socket: { remoteAddress: '127.0.0.1' } }, 'operator@enterprise.com', 'OperatorPassword123!');
    assert.ok(userLogin.token);

    const req = { headers: { cookie: `gh_session=${userLogin.token}` }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(auth.sessionUser(state, req)?.email, 'operator@enterprise.com');

    newUser.status = 'disabled';
    auth.revokeUserSessions(state, newUser.id);

    assert.equal(auth.sessionUser(state, req), null);

    await assert.rejects(
      () => auth.login(state, { socket: { remoteAddress: '127.0.0.1' } }, 'operator@enterprise.com', 'OperatorPassword123!'),
      /Account is disabled/
    );

    const rawKeyToken = 'gh_ak_' + security.randomToken(32);
    const keyHash = security.hashToken(rawKeyToken);
    state.apiKeys.push({
      id: 'key-1',
      name: 'CI Bot',
      role: 'operator',
      keyHash,
      prefix: rawKeyToken.slice(0, 12) + '...',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      createdBy: 'owner@enterprise.com',
    });

    const apiKeyReq = { headers: { 'x-api-key': rawKeyToken }, socket: { remoteAddress: '127.0.0.1' } };
    const apiUser = auth.sessionUser(state, apiKeyReq);
    assert.ok(apiUser);
    assert.equal(apiUser.role, 'operator');
    assert.equal(apiUser.isApiKey, true);

    const bearerReq = { headers: { authorization: `Bearer ${rawKeyToken}` }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(auth.sessionUser(state, bearerReq)?.role, 'operator');

    state.apiKeys = [];
    assert.equal(auth.sessionUser(state, apiKeyReq), null);

    state.securityPolicy = { enforceSso: true, ssoDomains: ['enterprise.com'], minPasswordLength: 12 };
    await assert.rejects(
      () => auth.login(state, { socket: { remoteAddress: '127.0.0.1' } }, 'owner@enterprise.com', 'SuperSecurePassword123!'),
      /Single Sign-On \(SSO\) is required for enterprise.com/
    );

  } finally {
    if (oldDir === undefined) delete process.env.GLOWHAVEN_DATA_DIR;
    else process.env.GLOWHAVEN_DATA_DIR = oldDir;
    if (oldKey === undefined) delete process.env.GLOWHAVEN_MASTER_KEY;
    else process.env.GLOWHAVEN_MASTER_KEY = oldKey;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('fine-grained RBAC on integration secrets by workspace and execution group', () => {
  const adminUser = { id: 'u-admin', email: 'admin@co.com', role: 'admin' };
  const operatorUser = { id: 'u-op1', email: 'op@co.com', role: 'operator', workspaceId: 'finsec', executionGroups: ['secops'] };
  const rogueOperator = { id: 'u-op2', email: 'rogue@co.com', role: 'operator', workspaceId: 'marketing', executionGroups: ['analytics'] };

  const restrictedIntegration = {
    id: 'automations',
    kind: 'automations',
    workspaceId: 'finsec',
    executionGroups: ['secops', 'sre'],
  };

  // Admin bypasses workspace/group restriction
  assert.equal(checkIntegrationAccess(restrictedIntegration, adminUser, {}), true);

  // Matching workspace & execution group operator passes
  assert.equal(checkIntegrationAccess(restrictedIntegration, operatorUser, {}), true);

  // Mismatched workspace operator fails
  assert.throws(
    () => checkIntegrationAccess(restrictedIntegration, rogueOperator, {}),
    /Access to integration secrets is restricted to workspace: finsec/
  );

  // Matching workspace but mismatched execution group fails
  const wrongGroupOperator = { id: 'u-op3', email: 'op3@co.com', role: 'operator', workspaceId: 'finsec', executionGroups: ['payroll'] };
  assert.throws(
    () => checkIntegrationAccess(restrictedIntegration, wrongGroupOperator, {}),
    /Access to integration secrets is restricted to execution groups: secops, sre/
  );
});

test('formalized OIDC group mapping with deeply nested groups and JSON mapping', () => {
  const oldMapping = process.env.OIDC_GROUP_MAPPING;
  const oldAdmin = process.env.OIDC_ADMIN_GROUPS;
  const oldOp = process.env.OIDC_OPERATOR_GROUPS;
  const oldView = process.env.OIDC_VIEWER_GROUPS;

  try {
    process.env.OIDC_GROUP_MAPPING = JSON.stringify({
      admin: ['Corp-Admins', 'SecOps-Lead'],
      operator: ['SRE-Core', 'DevOps-Team'],
      viewer: ['Company-All'],
    });

    const complexClaims = {
      email: 'user@okta.example.com',
      groups: [
        'Company-All',
        ['SRE-Core', { name: 'NestedGroup1' }],
      ],
      memberOf: [
        { displayName: 'Azure-SecGroup' },
        { group: { cn: 'DevOps-Team' } },
      ],
      realm_access: {
        roles: ['Keycloak-Role', 'SecOps-Lead'],
      },
    };

    const extracted = extractGroups(complexClaims);
    assert.ok(extracted.includes('Company-All'));
    assert.ok(extracted.includes('SRE-Core'));
    assert.ok(extracted.includes('Azure-SecGroup'));
    assert.ok(extracted.includes('DevOps-Team'));
    assert.ok(extracted.includes('SecOps-Lead'));

    // Highest precedence group ('SecOps-Lead' -> admin)
    const role = roleForClaims(complexClaims);
    assert.equal(role, 'admin');

    // Claims with only operator groups
    const operatorClaims = {
      email: 'dev@example.com',
      groups: ['Company-All', { name: 'DevOps-Team' }],
    };
    assert.equal(roleForClaims(operatorClaims), 'operator');

    // Claims with only viewer groups
    const viewerClaims = {
      email: 'viewer@example.com',
      groups: ['Company-All'],
    };
    assert.equal(roleForClaims(viewerClaims), 'viewer');

  } finally {
    if (oldMapping === undefined) delete process.env.OIDC_GROUP_MAPPING;
    else process.env.OIDC_GROUP_MAPPING = oldMapping;
    if (oldAdmin === undefined) delete process.env.OIDC_ADMIN_GROUPS;
    else process.env.OIDC_ADMIN_GROUPS = oldAdmin;
    if (oldOp === undefined) delete process.env.OIDC_OPERATOR_GROUPS;
    else process.env.OIDC_OPERATOR_GROUPS = oldOp;
    if (oldView === undefined) delete process.env.OIDC_VIEWER_GROUPS;
    else process.env.OIDC_VIEWER_GROUPS = oldView;
  }
});

test('external secret manager integration (AWS, Vault, Azure)', async () => {
  process.env.MOCK_SECRET_MANAGER = '1';
  process.env.MOCK_AWS_SECRET_VALUE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.MOCK_VAULT_SECRET_VALUE = '1111111111111111111111111111111111111111111111111111111111111111';
  process.env.MOCK_AZURE_SECRET_VALUE = '2222222222222222222222222222222222222222222222222222222222222222';

  try {
    process.env.AWS_SECRET_NAME = 'glowhaven/masterkey';
    const awsKey = await fetchAwsSecret('glowhaven/masterkey');
    assert.equal(awsKey, process.env.MOCK_AWS_SECRET_VALUE);

    const resolvedAws = await resolveExternalMasterKey();
    assert.equal(resolvedAws, process.env.MOCK_AWS_SECRET_VALUE);

    delete process.env.AWS_SECRET_NAME;

    process.env.VAULT_ADDR = 'https://vault.example.com:8200';
    process.env.VAULT_TOKEN = 's.mocktoken';
    process.env.VAULT_SECRET_PATH = 'secret/data/glowhaven';

    const vaultKey = await fetchVaultSecret();
    assert.equal(vaultKey, process.env.MOCK_VAULT_SECRET_VALUE);

    const resolvedVault = await resolveExternalMasterKey();
    assert.equal(resolvedVault, process.env.MOCK_VAULT_SECRET_VALUE);

    delete process.env.VAULT_ADDR;
    delete process.env.VAULT_TOKEN;
    delete process.env.VAULT_SECRET_PATH;

    process.env.AZURE_KEYVAULT_URL = 'https://myvault.vault.azure.net';
    process.env.AZURE_SECRET_NAME = 'glowhaven-masterkey';

    const azureKey = await fetchAzureKeyVaultSecret();
    assert.equal(azureKey, process.env.MOCK_AZURE_SECRET_VALUE);

    const resolvedAzure = await resolveExternalMasterKey();
    assert.equal(resolvedAzure, process.env.MOCK_AZURE_SECRET_VALUE);

  } finally {
    delete process.env.MOCK_SECRET_MANAGER;
    delete process.env.MOCK_AWS_SECRET_VALUE;
    delete process.env.MOCK_VAULT_SECRET_VALUE;
    delete process.env.MOCK_AZURE_SECRET_VALUE;
    delete process.env.AWS_SECRET_NAME;
    delete process.env.VAULT_ADDR;
    delete process.env.VAULT_TOKEN;
    delete process.env.VAULT_SECRET_PATH;
    delete process.env.AZURE_KEYVAULT_URL;
    delete process.env.AZURE_SECRET_NAME;
  }
});
