import {
  assetFileUrl,
  fetchProjectExports,
  rebuildTimeline,
} from "./api.js";
import { trackJob, stopJobTracking } from "./job-activity.js";
import { getProject, initProjects } from "./projects.js";

let pollTimer = null;
let activeProjectId = null;
let latestExportData = null;

export function initExportTab(projectId) {
  activeProjectId = projectId;
  bindExportEvents();
  void renderExportPanel(projectId);
}

function bindExportEvents() {
  const panel = document.getElementById("panel-export");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  document.getElementById("btn-export-rebuild")?.addEventListener("click", onRebuildExport);
  document.getElementById("btn-goto-timeline")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "timeline" } }));
  });
  document.getElementById("btn-copy-export")?.addEventListener("click", onCopyExportText);

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-export-asset]");
    if (btn) previewHistoryExport(btn.dataset.exportAsset);
  });
}

function showExportError(msg) {
  const el = document.getElementById("export-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideExportError() {
  document.getElementById("export-error")?.classList.add("hidden");
}

function setExportStatus(msg) {
  const el = document.getElementById("export-status");
  if (el) el.textContent = msg;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-PT");
  } catch {
    return iso;
  }
}

function formatCopy(copy) {
  if (!copy) return "";
  if (typeof copy === "string") return copy;
  if (copy.voiceover) return copy.voiceover;
  if (copy.hook || copy.cta) {
    return [copy.hook, copy.voiceover, copy.cta].filter(Boolean).join("\n\n");
  }
  return JSON.stringify(copy, null, 2);
}

export async function renderExportPanel(projectId) {
  activeProjectId = projectId;
  hideExportError();

  const main = document.getElementById("export-main");
  const empty = document.getElementById("export-empty");
  const banner = document.getElementById("export-status-banner");
  const historyWrap = document.getElementById("export-history-wrap");
  const rebuildBtn = document.getElementById("btn-export-rebuild");

  let data;
  try {
    data = await fetchProjectExports(projectId);
    latestExportData = data;
  } catch (err) {
    setExportStatus(err.message);
    main?.classList.add("hidden");
    empty?.classList.remove("hidden");
    banner?.classList.add("hidden");
    return;
  }

  const statusLabels = {
    ready: "Export actualizado e pronto para download",
    outdated: "Cenas alteradas — rebuild necessário",
    needs_rebuild: "Clips prontos — faz rebuild para gerar MP4",
    waiting: "Aguarda clips na timeline",
  };

  setExportStatus(statusLabels[data.exportStatus] || data.exportStatus);

  rebuildBtn?.toggleAttribute("disabled", !data.allVideosReady);

  renderStatusBanner(banner, data);

  if (data.latestExport?.assetId) {
    main?.classList.remove("hidden");
    empty?.classList.add("hidden");
    renderLatestExport(data);
  } else {
    main?.classList.add("hidden");
    empty?.classList.remove("hidden");
  }

  renderHistory(historyWrap, data);
  renderCopy(data.copy);
}

function renderStatusBanner(banner, data) {
  if (!banner) return;

  const cls =
    data.exportStatus === "ready"
      ? "ready"
      : data.exportStatus === "outdated"
        ? "outdated"
        : data.exportStatus === "needs_rebuild"
          ? "needs-rebuild"
          : "waiting";

  banner.className = `export-status-banner card status-${cls}`;
  banner.classList.remove("hidden");

  const messages = {
    ready: "✓ MP4 final sincronizado com a timeline.",
    outdated: "⚠ Regeneraste cenas — o export actual está desactualizado.",
    needs_rebuild: "→ Todos os clips estão prontos. Clica Rebuild Final Video.",
    waiting: "○ Completa Animate All na tab Videos primeiro.",
  };

  banner.innerHTML = `
    <strong>${messages[data.exportStatus] || data.exportStatus}</strong>
    <span class="muted">${data.videosReady || 0}/${data.sceneCount || 0} clips · ~${formatTime(data.displayDurationSeconds || 0)}</span>`;
}

function renderLatestExport(data) {
  const assetId = data.latestExport.assetId;
  const url = assetFileUrl(assetId);

  document.getElementById("export-meta").textContent =
    `${data.blueprint?.title || "Export"} · ${formatDate(data.latestExport.rebuiltAt)} · ${data.latestExport.clipCount || data.sceneCount} clips`;

  const video = document.getElementById("export-video");
  if (video) video.src = `${url}?t=${Date.now()}`;

  const dl = document.getElementById("export-download");
  if (dl) dl.href = url;

  const specs = document.getElementById("export-specs");
  if (specs) {
    specs.innerHTML = `
      <h3>Especificações</h3>
      <dl class="export-spec-list">
        <div><dt>Cenas</dt><dd>${data.sceneCount}</dd></div>
        <div><dt>Duração</dt><dd>~${formatTime(data.displayDurationSeconds)} (${formatTime(data.totalDurationSeconds)} c/ crossfade)</dd></div>
        <div><dt>Crossfade UGC</dt><dd>${data.crossfadeSeconds ? `${data.crossfadeSeconds}s` : "—"}</dd></div>
        <div><dt>Estado</dt><dd>${data.exportStatus}</dd></div>
        <div><dt>Job rebuild</dt><dd>${data.latestExport.jobId || "—"}</dd></div>
      </dl>`;
  }
}

function renderCopy(copy) {
  const wrap = document.getElementById("export-copy-wrap");
  const block = document.getElementById("export-copy-block");
  const text = formatCopy(copy);
  if (!wrap || !block) return;

  if (!text) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  block.textContent = text;
}

function renderHistory(wrap, data) {
  const list = document.getElementById("export-history");
  if (!wrap || !list) return;

  if (!data.history?.length) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  list.innerHTML = data.history
    .map(
      (item) => `
    <div class="export-history-row${item.active ? " active" : ""}">
      <div>
        <strong>${item.active ? "Actual" : "Export"}</strong>
        <span class="muted">${formatDate(item.createdAt)}</span>
      </div>
      <div class="export-history-meta muted">
        ${item.clipCount ? `${item.clipCount} clips` : ""}
        ${item.jobId ? ` · job ${item.jobId}` : ""}
      </div>
      <div class="export-history-actions">
        <button type="button" class="btn sm" data-export-asset="${item.assetId}">Preview</button>
        <a class="btn sm" href="${assetFileUrl(item.assetId)}" download="ecoom-export-${item.assetId.slice(0, 8)}.mp4">Download</a>
      </div>
    </div>`,
    )
    .join("");
}

function previewHistoryExport(assetId) {
  const video = document.getElementById("export-video");
  const dl = document.getElementById("export-download");
  const url = assetFileUrl(assetId);
  if (video) video.src = `${url}?t=${Date.now()}`;
  if (dl) dl.href = url;
}

async function onRebuildExport() {
  if (!activeProjectId) return;
  hideExportError();
  const btn = document.getElementById("btn-export-rebuild");
  btn.disabled = true;
  setExportStatus("Rebuild Final Video — só ffmpeg...");

  try {
    const data = await rebuildTimeline(activeProjectId);
    startJobPoll(data.jobId);
  } catch (err) {
    showExportError(err.message);
    btn.disabled = false;
  }
}

function startJobPoll(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  trackJob(jobId, {
    jobType: "rebuild",
    pollMs: 1000,
    onUpdate: (job) => setExportStatus(job.progress?.message || job.status),
    onComplete: async () => {
      document.getElementById("btn-export-rebuild")?.removeAttribute("disabled");
      await initProjects();
      await renderExportPanel(activeProjectId);
      setExportStatus("MP4 final pronto para download");
      window.dispatchEvent(
        new CustomEvent("ecoom:job-complete", {
          detail: { projectId: activeProjectId, jobId },
        }),
      );
    },
    onFailed: (job) => {
      showExportError(job.error || "Rebuild falhou");
      document.getElementById("btn-export-rebuild")?.removeAttribute("disabled");
    },
  });
}

async function onCopyExportText() {
  const block = document.getElementById("export-copy-block");
  if (!block?.textContent) return;
  try {
    await navigator.clipboard.writeText(block.textContent);
    setExportStatus("Copy copiada para clipboard");
  } catch {
    showExportError("Não foi possível copiar");
  }
}

export function destroyExportTab() {
  if (pollTimer) clearInterval(pollTimer);
  stopJobTracking();
}
