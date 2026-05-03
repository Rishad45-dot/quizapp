// feishu-sync.js
// Feishu Bitable sync – password‑based identity

const FEISHU_CONFIG = {
  appId: "cli_a_xxxxxxxxxxxxx",        // Your App ID
  appSecret: "xxxxxxxxxxxxxxxxxxxxxx", // Your App Secret
  appToken: "SXIJbQ9Tzab87yssBbNcDFConxE",
  tableId: "tblGtvGnLa1SsELv"
};

let cachedToken = { value: null, expiresAt: 0 };

async function getTenantAccessToken() {
  if (cachedToken.value && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  const url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: FEISHU_CONFIG.appId, app_secret: FEISHU_CONFIG.appSecret })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Token error: ${data.msg}`);
  cachedToken.value = data.tenant_access_token;
  cachedToken.expiresAt = Date.now() + (data.expire - 60) * 1000;
  return cachedToken.value;
}

// Find record by passwordHash
async function findRecordByPasswordHash(passwordHash) {
  const token = await getTenantAccessToken();
  const filter = `CurrentValue.[passwordHash]="${passwordHash}"`;
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${FEISHU_CONFIG.tableId}/records?filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await res.json();
  if (data.code !== 0) return null;
  return data.data?.items?.[0] || null;
}

// Create new record
async function createRecord(passwordHash, progressData) {
  const token = await getTenantAccessToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${FEISHU_CONFIG.tableId}/records`;
  const payload = {
    fields: {
      passwordHash: passwordHash,
      progressData: JSON.stringify(progressData),
      lastSyncTime: new Date().toISOString()
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Create failed: ${data.msg}`);
  return true;
}

// Update existing record
async function updateRecord(recordId, progressData) {
  const token = await getTenantAccessToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${FEISHU_CONFIG.tableId}/records/${recordId}`;
  const payload = {
    fields: {
      progressData: JSON.stringify(progressData),
      lastSyncTime: new Date().toISOString()
    }
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Update failed: ${data.msg}`);
  return true;
}

// Public: Upload progress
export async function saveProgressToCloud(passwordHash, progressData) {
  try {
    const record = await findRecordByPasswordHash(passwordHash);
    if (record) {
      await updateRecord(record.record_id, progressData);
    } else {
      await createRecord(passwordHash, progressData);
    }
    return true;
  } catch (err) {
    console.error("Save to Feishu failed", err);
    return false;
  }
}

// Public: Download progress (returns parsed JSON or null)
export async function loadProgressFromCloud(passwordHash) {
  try {
    const record = await findRecordByPasswordHash(passwordHash);
    if (record && record.fields.progressData) {
      return JSON.parse(record.fields.progressData);
    }
    return null;
  } catch (err) {
    console.error("Load from Feishu failed", err);
    return null;
  }
}

// Password hashing (SHA‑256)
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Local storage management
const STORAGE_KEY = 'quiz_password_hash';

export function getStoredPasswordHash() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredPasswordHash(hash) {
  if (hash) localStorage.setItem(STORAGE_KEY, hash);
  else localStorage.removeItem(STORAGE_KEY);
}

export function clearStoredPasswordHash() {
  localStorage.removeItem(STORAGE_KEY);
}
