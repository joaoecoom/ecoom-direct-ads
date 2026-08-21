import { fetchProviderDiagnostics } from "./api.js";

let cached = null;

export async function renderProvidersDiagnostics(container) {
  if (!container) return;
  container.innerHTML = `<p class="muted">A carregar AI Providers…</p>`;

  try {
    cached = await fetchProviderDiagnostics();
    const providers = cached.providers || [];
    const models = cached.models || [];

    container.innerHTML = `
      <div class="providers-diagnostics">
        <h3>AI Providers</h3>
        <p class="muted small">Phase 23 · diagnostics · API keys nunca expostas</p>
        <div class="providers-grid">
          ${providers
            .map(
              (p) => `
            <div class="provider-card card subtle">
              <div class="provider-card-head">
                <strong>${p.name}</strong>
                <span class="provider-status status-${p.status}">${p.status}</span>
              </div>
              <p class="muted small">${p.message || "—"}</p>
              ${p.latencyMs != null ? `<p class="muted small">Latency: ${p.latencyMs}ms</p>` : ""}
              ${p.errorCount ? `<p class="muted small">Errors: ${p.errorCount}</p>` : ""}
            </div>`,
            )
            .join("")}
        </div>
        <h4>Models</h4>
        <ul class="providers-model-list">
          ${models
            .map(
              (m) =>
                `<li><strong>${m.model}</strong> · ${m.providerId} · ${m.configured ? "CONFIGURED" : "NOT CONFIGURED"} · ${m.taskType}</li>`,
            )
            .join("")}
        </ul>
        <p class="muted small">Status: ${cached.status} · Tested: ${cached.tested ? "yes" : "no"}</p>
      </div>`;
  } catch (err) {
    container.innerHTML = `<p class="error-text">${err.message}</p>`;
  }
}

export function getCachedProviderDiagnostics() {
  return cached;
}
