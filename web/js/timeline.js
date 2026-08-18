import {
  activateSceneVersion,
  assetFileUrl,
  fetchJob,
  fetchProjectScene,
  fetchProjectTimeline,
  patchProjectScene,
  rebuildTimeline,
  regenerateSceneImage,
  regenerateSceneVideo,
} from "./api.js";
import { getProject, initProjects } from "./projects.js";

let pollTimer = null;
let activeProjectId = null;
let selectedSceneId = null;
let sceneEditorCache = null;

export function initTimelineTab(projectId) {
  activeProjectId = projectId;
  bindTimelineEvents();
  void renderTimelinePanel(projectId);
}

function bindTimelineEvents() {
  const panel = document.getElementById("panel-timeline");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  document.getElementById("btn-rebuild-final")?.addEventListener("click", onRebuildFinal);

  panel.addEventListener("click", (e) => {
    const block = e.target.closest("[data-timeline-scene]");
    if (block) void selectScene(block.dataset.timelineScene);

    const btn = e.target.closest("[data-scene-action]");
    if (btn) void handleSceneAction(btn.dataset.sceneAction, btn.dataset);
  });
}

function showTimelineError(msg) {
  const el = document.getElementById("timeline-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideTimelineError() {
  document.getElementById("timeline-error")?.classList.add("hidden");
}

function setTimelineStatus(msg) {
  const el = document.getElementById("timeline-status");
  if (el) el.textContent = msg;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function statusBadge(label, value) {
  const cls = value === "done"
    ? "done"
    : value === "outdated"
      ? "outdated"
      : value === "generating"
        ? "generating"
        : "pending";
  return `<span class="scene-pipeline-badge status-${cls}" title="${label}">${label}: ${value || "pending"}</span>`;
}

function renderVersionList(type, versions, sceneId) {
  if (!versions?.length) {
    return `<p class="muted scene-editor-empty">Sem versões</p>`;
  }

  return versions
    .map((v) => {
      const thumb =
        type === "image"
          ? `<img src="${assetFileUrl(v.assetId)}" alt="" class="scene-version-thumb" />`
          : `<span class="scene-version-icon">▶</span>`;
      const active = v.active ? " active" : "";
      return `
      <div class="scene-version-row${active}">
        ${thumb}
        <div class="scene-version-meta">
          <strong>${v.label}${v.active ? " · activa" : ""}</strong>
          <span class="muted">${v.source || ""}</span>
        </div>
        ${
          v.active
            ? `<span class="scene-version-active">✓</span>`
            : `<button type="button" class="btn sm" data-scene-action="activate-${type}" data-asset-id="${v.assetId}" data-scene-id="${sceneId}">Usar</button>`
        }
      </div>`;
    })
    .join("");
}

export async function renderTimelinePanel(projectId) {
  activeProjectId = projectId;
  hideTimelineError();

  const track = document.getElementById("timeline-track");
  const ruler = document.getElementById("timeline-ruler");
  const preview = document.getElementById("timeline-preview");
  if (!track) return;

  let timeline;
  try {
    timeline = await fetchProjectTimeline(projectId);
  } catch (err) {
    track.innerHTML = `<p class="muted">Timeline indisponível.</p>`;
    setTimelineStatus(err.message);
    return;
  }

  const statusLabels = {
    pending: "Aguarda blueprint e clips",
    waiting_clips: "Aguarda Animate All",
    needs_rebuild: timeline.hasOutdatedClips || timeline.hasOutdatedFinal
      ? "Cenas desactualizadas — rebuild necessário"
      : "Pronto para rebuild",
    ready: "Export actualizado",
    building: "A rebuildar...",
  };

  setTimelineStatus(
    `${statusLabels[timeline.timelineStatus] || timeline.timelineStatus} · ~${formatTime(timeline.displayDurationSeconds || timeline.totalDurationSeconds)}`,
  );

  document.getElementById("btn-rebuild-final")?.toggleAttribute(
    "disabled",
    !timeline.allVideosReady,
  );

  if (!timeline.scenes?.length) {
    track.innerHTML = `<div class="empty-state card"><p class="muted">Sem cenas. Gera blueprint + imagens + vídeos primeiro.</p></div>`;
    ruler.innerHTML = "";
    preview.innerHTML = "";
    return;
  }

  const total = timeline.displayDurationSeconds || timeline.scenes.length * timeline.scenes[0].durationSeconds;

  ruler.innerHTML = timeline.scenes
    .map(
      (s) =>
        `<span style="flex:${s.durationSeconds}">${formatTime(s.startSeconds)}</span>`,
    )
    .concat(`<span>${formatTime(total)}</span>`)
    .join("");

  track.innerHTML = timeline.scenes
    .map((scene) => {
      const outdated = scene.needsVideoRegen || scene.needsFinalRebuild;
      const active = selectedSceneId === scene.id ? " active" : "";
      const outdatedCls = outdated ? " outdated" : "";
      return `
      <button type="button" class="timeline-block${active}${outdatedCls}" data-timeline-scene="${scene.id}" style="flex:${scene.durationSeconds}" title="${scene.id}">
        <span class="timeline-block-label">${scene.id.replace("parte-", "S")}</span>
        <span class="timeline-block-meta">${statusIcon(scene.status?.image)} ${statusIcon(scene.status?.video, outdated)}</span>
      </button>`;
    })
    .join("");

  if (!selectedSceneId && timeline.scenes[0]) {
    selectedSceneId = timeline.scenes[0].id;
  }

  await renderSceneEditor(projectId, timeline, preview);
}

function statusIcon(value, outdated = false) {
  if (outdated || value === "outdated") return "⚠";
  if (value === "done") return "✓";
  if (value === "generating") return "…";
  return "○";
}

async function renderSceneEditor(projectId, timeline, previewEl) {
  if (!previewEl) return;
  const scene = timeline.scenes.find((s) => s.id === selectedSceneId) || timeline.scenes[0];
  if (!scene) {
    previewEl.innerHTML = "";
    return;
  }

  let detail = sceneEditorCache?.sceneId === scene.id ? sceneEditorCache.detail : null;
  if (!detail) {
    try {
      detail = await fetchProjectScene(projectId, scene.id);
      sceneEditorCache = { sceneId: scene.id, detail };
    } catch {
      detail = { scene, versions: { image: [], video: [] } };
    }
  }

  const st = detail.scene?.status || scene.status || {};
  const vidUrl = scene.videoAssetId ? assetFileUrl(scene.videoAssetId) : null;
  const imgUrl = scene.imageAssetId ? assetFileUrl(scene.imageAssetId) : null;
  const motionPrompt = detail.scene?.motionPrompt ?? scene.motionPrompt ?? "";

  previewEl.innerHTML = `
    <div class="timeline-preview-head">
      <div>
        <strong>${scene.id}</strong>
        <span class="muted"> · ${formatTime(scene.startSeconds)} – ${formatTime(scene.endSeconds)}</span>
      </div>
      <div class="scene-pipeline-badges">
        ${statusBadge("Prompt", st.prompt)}
        ${statusBadge("Image", st.image)}
        ${statusBadge("Video", st.video)}
        ${statusBadge("Final", st.final)}
      </div>
    </div>
    <div class="scene-editor-layout">
      <div class="scene-editor-preview">
        ${
          vidUrl
            ? `<video src="${vidUrl}?t=${Date.now()}" controls playsinline class="timeline-preview-video"></video>`
            : imgUrl
              ? `<img src="${imgUrl}" alt="" class="timeline-preview-img" />`
              : `<p class="muted">Sem preview</p>`
        }
      </div>
      <div class="scene-editor-panel">
        <label class="field-label" for="scene-motion-prompt">Motion prompt</label>
        <textarea id="scene-motion-prompt" class="input scene-motion-input" rows="4">${escapeHtml(motionPrompt)}</textarea>
        <div class="scene-editor-actions">
          <button type="button" class="btn sm" data-scene-action="save-motion" data-scene-id="${scene.id}">Guardar prompt</button>
          <button type="button" class="btn sm" data-scene-action="regen-image" data-scene-id="${scene.id}" ${st.image === "generating" ? "disabled" : ""}>Regenerate Image</button>
          <button type="button" class="btn sm primary" data-scene-action="regen-video" data-scene-id="${scene.id}" ${!scene.imageAssetId || st.video === "generating" ? "disabled" : ""}>Regenerate Video</button>
        </div>
        <div class="scene-editor-versions">
          <div>
            <h4>Image versions</h4>
            ${renderVersionList("image", detail.versions?.image, scene.id)}
          </div>
          <div>
            <h4>Video versions</h4>
            ${renderVersionList("video", detail.versions?.video, scene.id)}
          </div>
        </div>
      </div>
    </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function selectScene(sceneId) {
  selectedSceneId = sceneId;
  sceneEditorCache = null;
  document.querySelectorAll(".timeline-block").forEach((el) => {
    el.classList.toggle("active", el.dataset.timelineScene === sceneId);
  });
  const timeline = await fetchProjectTimeline(activeProjectId);
  await renderSceneEditor(activeProjectId, timeline, document.getElementById("timeline-preview"));
}

async function handleSceneAction(action, dataset) {
  const sceneId = dataset.sceneId || selectedSceneId;
  if (!activeProjectId || !sceneId) return;

  hideTimelineError();

  try {
    if (action === "save-motion") {
      const textarea = document.getElementById("scene-motion-prompt");
      await patchProjectScene(activeProjectId, sceneId, {
        motionPrompt: textarea?.value || "",
      });
      sceneEditorCache = null;
      await initProjects();
      await renderTimelinePanel(activeProjectId);
      return;
    }

    if (action === "activate-image" || action === "activate-video") {
      const type = action === "activate-image" ? "image" : "video";
      await activateSceneVersion(activeProjectId, sceneId, type, dataset.assetId);
      sceneEditorCache = null;
      await initProjects();
      await renderTimelinePanel(activeProjectId);
      return;
    }

    if (action === "regen-image") {
      const data = await regenerateSceneImage(activeProjectId, sceneId);
      startJobPoll(data.jobId, "image");
      return;
    }

    if (action === "regen-video") {
      const textarea = document.getElementById("scene-motion-prompt");
      const data = await regenerateSceneVideo(activeProjectId, sceneId, {
        motionPrompt: textarea?.value?.trim() || undefined,
      });
      startJobPoll(data.jobId, "video");
    }
  } catch (err) {
    showTimelineError(err.message);
  }
}

async function onRebuildFinal() {
  if (!activeProjectId) return;
  hideTimelineError();
  const btn = document.getElementById("btn-rebuild-final");
  btn.disabled = true;
  setTimelineStatus("Rebuild Final Video — só ffmpeg, sem Veo...");

  try {
    const data = await rebuildTimeline(activeProjectId);
    startJobPoll(data.jobId, "rebuild");
  } catch (err) {
    showTimelineError(err.message);
    btn.disabled = false;
  }
}

function startJobPoll(jobId, kind = "rebuild") {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const job = await fetchJob(jobId);
    if (!job) return;
    setTimelineStatus(job.progress?.message || job.status);

    if (job.status === "completed") {
      clearInterval(pollTimer);
      document.getElementById("btn-rebuild-final")?.removeAttribute("disabled");
      sceneEditorCache = null;
      await initProjects();
      await renderTimelinePanel(activeProjectId);
      const doneMsg =
        kind === "image"
          ? "Imagem regenerada"
          : kind === "video"
            ? "Vídeo regenerado — rebuild se necessário"
            : "MP4 final pronto";
      setTimelineStatus(doneMsg);
      window.dispatchEvent(
        new CustomEvent("ecoom:job-complete", {
          detail: { projectId: activeProjectId, jobId },
        }),
      );
    }
    if (job.status === "failed") {
      clearInterval(pollTimer);
      showTimelineError(job.error || "Job falhou");
      document.getElementById("btn-rebuild-final")?.removeAttribute("disabled");
    }
  }, 2000);
}

export function destroyTimelineTab() {
  if (pollTimer) clearInterval(pollTimer);
}
