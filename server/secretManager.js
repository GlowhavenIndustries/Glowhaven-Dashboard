import { requestJson } from './security.js';

export async function fetchAwsSecret(secretName, region = process.env.AWS_REGION || 'us-east-1') {
  if (!secretName) throw new Error('AWS secret name is required');
  const endpoint = process.env.AWS_SECRETS_MANAGER_ENDPOINT || `https://secretsmanager.${region}.amazonaws.com`;

  try {
    const data = await requestJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'secretsmanager.GetSecretValue',
      },
      body: JSON.stringify({ SecretId: secretName }),
    });
    return data.SecretString || (data.SecretBinary ? Buffer.from(data.SecretBinary, 'base64').toString('utf8') : '');
  } catch (err) {
    if (process.env.MOCK_SECRET_MANAGER === '1') {
      return process.env.MOCK_AWS_SECRET_VALUE || '';
    }
    throw err;
  }
}

export async function fetchVaultSecret(vaultAddr = process.env.VAULT_ADDR, token = process.env.VAULT_TOKEN, path = process.env.VAULT_SECRET_PATH) {
  if (!vaultAddr || !token || !path) throw new Error('Vault address, token, and secret path are required');
  const cleanAddr = vaultAddr.replace(/\/$/, '');
  const url = `${cleanAddr}/v1/${path.replace(/^\//, '')}`;

  try {
    const data = await requestJson(url, {
      headers: { 'X-Vault-Token': token },
    });
    const secretData = data?.data?.data || data?.data || {};
    return secretData.masterKey || secretData.value || JSON.stringify(secretData);
  } catch (err) {
    if (process.env.MOCK_SECRET_MANAGER === '1') {
      return process.env.MOCK_VAULT_SECRET_VALUE || '';
    }
    throw err;
  }
}

export async function fetchAzureKeyVaultSecret(vaultUrl = process.env.AZURE_KEYVAULT_URL, secretName = process.env.AZURE_SECRET_NAME) {
  if (!vaultUrl || !secretName) throw new Error('Azure Key Vault URL and secret name are required');
  const cleanUrl = vaultUrl.replace(/\/$/, '');
  const url = `${cleanUrl}/secrets/${encodeURIComponent(secretName)}?api-version=7.4`;

  try {
    const headers = {};
    if (process.env.AZURE_BEARER_TOKEN) {
      headers.Authorization = `Bearer ${process.env.AZURE_BEARER_TOKEN}`;
    }
    const data = await requestJson(url, { headers });
    return data.value || '';
  } catch (err) {
    if (process.env.MOCK_SECRET_MANAGER === '1') {
      return process.env.MOCK_AZURE_SECRET_VALUE || '';
    }
    throw err;
  }
}

export async function resolveExternalMasterKey() {
  if (process.env.AWS_SECRET_NAME) {
    const val = await fetchAwsSecret(process.env.AWS_SECRET_NAME);
    if (val) return val.trim();
  }

  if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN && process.env.VAULT_SECRET_PATH) {
    const val = await fetchVaultSecret();
    if (val) return val.trim();
  }

  if (process.env.AZURE_KEYVAULT_URL && process.env.AZURE_SECRET_NAME) {
    const val = await fetchAzureKeyVaultSecret();
    if (val) return val.trim();
  }

  return process.env.GLOWHAVEN_MASTER_KEY || null;
}
