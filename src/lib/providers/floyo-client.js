const DEFAULT_BASE = "https://api.floyo.ai";

function getApiKey() {
  return process.env.FLOYO_API_KEY || "";
}

function getBaseUrl() {
  return (process.env.FLOYO_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

async function floyoFetch(path, { method = "GET", body, timeoutMs = 60000 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error("FLOYO_API_KEY não configurada");
    err.code = "FLOYO_NOT_CONFIGURED";
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!res.ok) {
      const err = new Error(data?.message || data?.error || `Floyo HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      err.latencyMs = latencyMs;
      throw err;
    }

    return { data, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

export function isFloyoConfigured() {
  return Boolean(getApiKey());
}

export async function listWorkflows(params = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.scope) qs.set("scope", params.scope);
  if (params.model_type) qs.set("model_type", params.model_type);
  const q = qs.toString();
  return floyoFetch(`/workflows${q ? `?${q}` : ""}`);
}

export async function getWorkflow(workflowId) {
  return floyoFetch(`/workflows/${encodeURIComponent(workflowId)}`);
}

export async function createRun({ name, workflow }) {
  return floyoFetch("/runs", {
    method: "POST",
    body: { name, workflow },
    timeoutMs: 120000,
  });
}

export async function getRun(runId, { expand = "outputs.presigned_url", presignedUrlExpiresIn = 3600 } = {}) {
  const qs = new URLSearchParams();
  if (expand) qs.set("expand", expand);
  if (presignedUrlExpiresIn) qs.set("presigned_url_expires_in", String(presignedUrlExpiresIn));
  return floyoFetch(`/runs/${encodeURIComponent(runId)}?${qs.toString()}`);
}

export async function cancelRun(runId) {
  return floyoFetch(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

const TERMINAL = new Set(["complete", "failed", "canceled"]);

export async function pollRunUntilDone(runId, {
  intervalMs = 5000,
  maxWaitMs = 900000,
  onStatus,
} = {}) {
  const started = Date.now();
  let attempt = 0;

  while (Date.now() - started < maxWaitMs) {
    attempt += 1;
    const { data } = await getRun(runId);
    onStatus?.(data, attempt);

    if (TERMINAL.has(data.status)) {
      return data;
    }

    const backoff = Math.min(intervalMs * Math.pow(1.2, attempt - 1), 30000);
    await new Promise((r) => setTimeout(r, backoff));
  }

  throw new Error(`Floyo run ${runId} timeout após ${maxWaitMs}ms`);
}
