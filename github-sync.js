const STORAGE_KEYS = {
  products: "mc_bw_products",
  titip_jual: "mc_bw_titip_jual",
  orders: "mc_bw_orders",
  users: "mc_bw_users",
  session: "mc_bw_session",
  store_meta: "mc_bw_store_meta",
  gh_config: "mc_bw_gh_token_config"
};

const DEFAULT_GH_CONFIG = {
  owner: "AboutRpanz",
  repo: "store-database-repo",
  branch: "main",
  dataPath: "data",
  token: "",
  autoSyncOnAdminAction: true
};

export function getGitHubConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.gh_config);
    return { ...DEFAULT_GH_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_GH_CONFIG };
  }
}

export function saveGitHubConfig(partialCfg) {
  const next = { ...getGitHubConfig(), ...partialCfg };
  localStorage.setItem(STORAGE_KEYS.gh_config, JSON.stringify(next));
  return next;
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export async function pullDatabaseFromGitHub(cfg = getGitHubConfig()) {
  if (!cfg.owner || !cfg.repo) {
    throw new Error("Owner dan nama repo GitHub belum diisi.");
  }

  const baseRaw = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${cfg.dataPath}`;
  const files = ["products", "titip_jual", "orders", "users", "session", "store_meta"];

  const results = await Promise.all(
    files.map(async (key) => {
      const url = `${baseRaw}/${key}.json?t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return [key, null];
      const data = await res.json();
      return [key, data];
    })
  );

  const db = {};
  for (const [key, val] of results) {
    if (val !== null) {
      db[key] = val;
      if (STORAGE_KEYS[key]) {
        localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(val));
      }
    }
  }
  return db;
}

export async function pushFileToGitHub(fileKey, dataPayload, commitMessage, cfg = getGitHubConfig()) {
  if (!cfg.token) {
    throw new Error("GitHub Access Token belum diisi. Buka Pengaturan GitHub Token.");
  }
  if (!cfg.owner || !cfg.repo) {
    throw new Error("Owner atau nama repo GitHub belum diisi.");
  }

  const pathInRepo = `${cfg.dataPath}/${fileKey}.json`;
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${pathInRepo}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json"
  };

  let sha;
  const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  const prettyJson = JSON.stringify(dataPayload, null, 2) + "\n";
  const body = {
    message: commitMessage || `Sync ${pathInRepo} from Store Web`,
    content: toBase64Utf8(prettyJson),
    branch: cfg.branch,
    ...(sha ? { sha } : {})
  };

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const errJson = await putRes.json().catch(() => ({}));
    throw new Error(errJson.message || `Gagal commit ${pathInRepo} (HTTP ${putRes.status})`);
  }

  return await putRes.json();
}

export async function pushAllDatabaseToGitHub(reason = "Full sync database", cfg = getGitHubConfig()) {
  const keys = ["products", "titip_jual", "orders", "users", "session", "store_meta"];
  const outputs = {};

  for (const key of keys) {
    const raw = localStorage.getItem(STORAGE_KEYS[key]);
    if (!raw) continue;
    const parsed = JSON.parse(raw);
    outputs[key] = await pushFileToGitHub(key, parsed, `${reason}: update ${key}.json`, cfg);
  }

  return outputs;
}
