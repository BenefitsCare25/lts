// =============================================================
// SharePoint storage — Microsoft Graph API via ROPC delegated auth.
//
// Pattern ported from sister-project PAD (`src/lib/sharepoint.ts`).
// Files live in the service account's OneDrive at
//   /me/drive/root:/lts-placement-slips/<tenantSlug>/<clientId>/<filename>
// Folders are created on demand via `ensureFolder`.
//
// Auth: ROPC (Resource Owner Password Credentials) with a service
// account whose MFA is disabled. Same trade-off as PAD: simpler
// than client-credentials with site-level admin consent, at the
// cost of needing one human-attached service account.
//
// Required env vars:
//   AZURE_TENANT_ID
//   AZURE_CLIENT_ID
//   AZURE_CLIENT_SECRET
//   AZURE_SERVICE_ACCOUNT_USERNAME
//   AZURE_SERVICE_ACCOUNT_PASSWORD
// =============================================================

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const {
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    AZURE_SERVICE_ACCOUNT_USERNAME,
    AZURE_SERVICE_ACCOUNT_PASSWORD,
  } = process.env;

  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
    throw new Error(
      'Azure AD credentials not configured (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET).',
    );
  }
  if (!AZURE_SERVICE_ACCOUNT_USERNAME || !AZURE_SERVICE_ACCOUNT_PASSWORD) {
    throw new Error(
      'Service account credentials not configured (AZURE_SERVICE_ACCOUNT_USERNAME, AZURE_SERVICE_ACCOUNT_PASSWORD).',
    );
  }

  const url = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    username: AZURE_SERVICE_ACCOUNT_USERNAME,
    password: AZURE_SERVICE_ACCOUNT_PASSWORD,
    scope: 'https://graph.microsoft.com/Files.ReadWrite.All offline_access',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SharePoint ROPC auth failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

async function graphFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getGraphToken();
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

export function isSharePointConfigured(): boolean {
  return Boolean(
    process.env.AZURE_TENANT_ID &&
      process.env.AZURE_CLIENT_ID &&
      process.env.AZURE_CLIENT_SECRET &&
      process.env.AZURE_SERVICE_ACCOUNT_USERNAME &&
      process.env.AZURE_SERVICE_ACCOUNT_PASSWORD,
  );
}

// Create every segment of `folderPath` if it doesn't exist.
// Idempotent — Graph returns 200 when the folder already exists.
export async function ensureFolder(folderPath: string): Promise<void> {
  const segments = folderPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const res = await graphFetch(`/me/drive/root:/${encodeURIComponent(currentPath)}`);
    if (res.ok) continue;

    const parentPath = currentPath.includes('/')
      ? `/me/drive/root:/${encodeURIComponent(currentPath.substring(0, currentPath.lastIndexOf('/')))}:/children`
      : '/me/drive/root/children';

    const createRes = await graphFetch(parentPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: segment,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });

    if (!createRes.ok && createRes.status !== 409) {
      const body = await createRes.text();
      throw new Error(`Failed to create folder "${currentPath}": ${body}`);
    }
  }
}

export async function uploadFile(
  folderPath: string,
  fileName: string,
  buffer: Buffer,
): Promise<{ id: string; webUrl: string; path: string }> {
  const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

  // Files >4 MB must use the chunked upload-session endpoint.
  if (buffer.length > 4 * 1024 * 1024) {
    return uploadLargeFile(folderPath, fileName, buffer);
  }

  const res = await graphFetch(
    `/me/drive/root:/${encodeURIComponent(filePath)}:/content?@microsoft.graph.conflictBehavior=replace`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(buffer),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to upload "${filePath}": ${body}`);
  }

  const data = (await res.json()) as { id: string; webUrl: string };
  return { id: data.id, webUrl: data.webUrl, path: filePath };
}

async function uploadLargeFile(
  folderPath: string,
  fileName: string,
  buffer: Buffer,
): Promise<{ id: string; webUrl: string; path: string }> {
  const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

  const sessionRes = await graphFetch(
    `/me/drive/root:/${encodeURIComponent(filePath)}:/createUploadSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'replace' },
      }),
    },
  );

  if (!sessionRes.ok) {
    const body = await sessionRes.text();
    throw new Error(`Failed to create upload session for "${filePath}": ${body}`);
  }

  const { uploadUrl } = (await sessionRes.json()) as { uploadUrl: string };
  const chunkSize = 3_276_800; // ~3.1 MB; must be a multiple of 320 KB.
  let offset = 0;
  let result: { id: string; webUrl: string } = { id: '', webUrl: '' };

  while (offset < buffer.length) {
    const end = Math.min(offset + chunkSize, buffer.length);
    const chunk = buffer.subarray(offset, end);

    const chunkRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}`,
      },
      body: new Uint8Array(chunk),
    });

    if (!chunkRes.ok && chunkRes.status !== 202) {
      const body = await chunkRes.text();
      throw new Error(`Upload chunk failed at offset ${offset}: ${body}`);
    }

    if (chunkRes.status === 200 || chunkRes.status === 201) {
      const data = (await chunkRes.json()) as { id: string; webUrl: string };
      result = { id: data.id, webUrl: data.webUrl };
    }

    offset = end;
  }

  return { ...result, path: filePath };
}

export async function downloadFile(filePath: string): Promise<Buffer> {
  const res = await graphFetch(`/me/drive/root:/${encodeURIComponent(filePath)}:/content`, {
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Failed to download "${filePath}": ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteFile(filePath: string): Promise<void> {
  const res = await graphFetch(`/me/drive/root:/${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Failed to delete "${filePath}": ${body}`);
  }
}

// Builds the canonical placement-slip folder path for a tenant + client.
// Encoded in `Tenant.slug` + `Client.id` so cross-tenant collisions are
// impossible (slug is unique per tenant; clientId is a cuid).
export function placementSlipFolder(tenantSlug: string, clientId: string): string {
  const safeSlug = tenantSlug.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeClient = clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `lts-placement-slips/${safeSlug}/${safeClient}`;
}
