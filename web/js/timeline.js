import {
  assetFileUrl,
  fetchJob,
  fetchProjectTimeline,
  rebuildTimeline,
} from "./api.js";
import { getProject, initProjects } from "./projects.js";

let pollTimer = null;
let activeProjectId = null;
let selectedSceneId = null;

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
    if (block) selectScene(block.dataset.timelineScene);
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

export async function renderTimelinePanel(projectId) {
  activeProjectId = projectId;
  hideTimelineError();

  const track = document.getElementById("timeline-track");
  const ruler = document.getElementById("timeline-ruler");
  const preview = document.getElementById("timeline-preview");
  const exportWrap = document.getElementById("timeline-export-wrap");
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
    needs_rebuild: "Pronto para rebuild",
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
    exportWrap?.classList.add("hidden");
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
      const imgDone = scene.status?.image === "done";
      const vidDone = scene.status?.video === "done";
      const active = selectedSceneId === scene.id ? " active" : "";
      return `
      <button type="button" class="timeline-block${active}" data-timeline-scene="${scene.id}" style="flex:${scene.durationSeconds}" title="${scene.id}">
        <span class="timeline-block-label">${scene.id.replace("parte-", "S")}</span>
        <span class="timeline-block-meta">${imgDone ? "🖼" : "○"} ${vidDone ? "▶" : "○"}</span>
      </button>`;
    })
    .join("");

  if (!selectedSceneId && timeline.scenes[0]) {
    selectedSceneId = timeline.scenes[0].id;
  }
  renderPreview(timeline, preview);

  if (timeline.latestExport?.assetId) {
    exportWrap?.classList.remove("hidden");
    const url = assetFileUrl(timeline.latestExport.assetId);
    const video = document.getElementById("timeline-export-video");
    if (video) video.src = `${url}?t=${Date.now()}`;
    const dl = document.getElementById("timeline-export-download");
    if (dl) dl.href = url;
    document.getElementById("timeline-export-meta").textContent =
      `Export · ${timeline.latestExport.rebuiltAt ? new Date(timeline.latestExport.rebuiltAt).toLocaleString("pt-PT") : ""}`;
  } else {
    exportWrap?.classList.add("hidden");
  }
}

function renderPreview(timeline, previewEl) {
  if (!previewEl) return;
  const scene = timeline.scenes.find((s) => s.id === selectedSceneId) || timeline.scenes[0];
  if (!scene) {
    previewEl.innerHTML = "";
    return;
  }

  const vidUrl = scene.videoAssetId ? assetFileUrl(scene.videoAssetId) : null;
  const imgUrl = scene.imageAssetId ? assetFileUrl(scene.imageAssetId) : null;

  previewEl.innerHTML = `
    <div class="timeline-preview-head">
      <strong>${scene.id}</strong>
      <span class="muted">${formatTime(scene.startSeconds)} – ${formatTime(scene.endSeconds)}</span>
    </div>
    ${
      vidUrl
        ? `<video src="${vidUrl}?t=${Date.now()}" controls playsinline class="timeline-preview-video"></video>`
        : imgUrl
          ? `<img src="${imgUrl}" alt="" class="timeline-preview-img" />`
          : `<p class="muted">Sem preview</p>`
    }`;
}

function selectScene(sceneId) {
  selectedSceneId = sceneId;
  document.querySelectorAll(".timeline-block").forEach((el) => {
    el.classList.toggle("active", el.dataset.timelineScene === sceneId);
  });
  fetchProjectTimeline(activeProjectId).then((timeline) => {
    renderPreview(timeline, document.getElementById("timeline-preview"));
  });
}

async function onRebuildFinal() {
  if (!activeProjectId) return;
  hideTimelineError();
  const btn = document.getElementById("btn-rebuild-final");
  btn.disabled = true;
  setTimelineStatus("Rebuild Final Video — só ffmpeg, sem Veo...");

  try {
    const data = await rebuildTimeline(activeProjectId);
    startJobPoll(data.jobId);
  } catch (err) {
    showTimelineError(err.message);
    btn.disabled = false;
  }
}

function startJobPoll(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const job = await fetchJob(jobId);
    if (!job) return;
    setTimelineStatus(job.progress?.message || job.status);

    if (job.status === "completed") {
      clearInterval(pollTimer);
      document.getElementById("btn-rebuild-final")?.removeAttribute("disabled");
      await initProjects();
      await renderTimelinePanel(activeProjectId);
      setTimelineStatus("MP4 final pronto");
      window.dispatchEvent(
        new CustomEvent("ecoom:job-complete", {
          detail: { projectId: activeProjectId, jobId },
        }),
      );
    }
    if (job.status === "failed") {
      clearInterval(pollTimer);
      showTimelineError(job.error || "Rebuild falhou");
      document.getElementById("btn-rebuild-final")?.removeAttribute("disabled");
    }
  }, 2000);
}

export function destroyTimelineTab() {
  if (pollTimer) clearInterval(pollTimer);
}
