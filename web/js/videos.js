import {
  assetFileUrl,
  animateAllVideos,
  animateSceneVideo,
  fetchProjectAssets,
} from "./api.js";
import { trackJob, stopJobTracking } from "./job-activity.js";
import { getProject, initProjects } from "./projects.js";

let pollTimer = null;
let activeProjectId = null;

export function initVideosTab(projectId) {
  activeProjectId = projectId;
  bindVideoEvents();
  void renderVideosPanel(projectId);
}

function bindVideoEvents() {
  const panel = document.getElementById("panel-videos");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  document.getElementById("btn-animate-all")?.addEventListener("click", onAnimateAll);

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-animate-scene]");
    if (btn) void onAnimateScene(btn.dataset.animateScene);
  });
}

function showVideosError(msg) {
  const el = document.getElementById("videos-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideVideosError() {
  document.getElementById("videos-error")?.classList.add("hidden");
}

function setVideosStatus(msg) {
  const el = document.getElementById("videos-status");
  if (el) el.textContent = msg;
}

function setVideosProgress(current, total) {
  const bar = document.getElementById("videos-progress-bar");
  const label = document.getElementById("videos-progress-label");
  if (!bar || !total) return;
  const pct = Math.round((current / total) * 100);
  bar.style.width = `${pct}%`;
  if (label) label.textContent = `${current} / ${total}`;
}

export async function renderVideosPanel(projectId) {
  activeProjectId = projectId;
  hideVideosError();
  setVideosProgress(0, 0);

  const grid = document.getElementById("scene-videos-grid");
  if (!grid) return;

  let assets = [];
  let scenes = getProject(projectId)?.scenes || [];

  try {
    const data = await fetchProjectAssets(projectId);
    assets = data.assets || [];
    scenes = data.scenes?.length ? data.scenes : scenes;
  } catch {
    /* offline */
  }

  const assetById = Object.fromEntries(assets.map((a) => [a.id, a]));
  const imagesReady = scenes.filter((s) => s.imageAssetId).length;
  const videosReady = scenes.filter((s) => s.videoAssetId).length;

  document.getElementById("btn-animate-all")?.toggleAttribute(
    "disabled",
    !scenes.length || imagesReady < scenes.length,
  );

  setVideosStatus(
    scenes.length
      ? `${videosReady}/${scenes.length} clips · ${imagesReady}/${scenes.length} imagens prontas`
      : "Gera blueprint + imagens na tab Images primeiro.",
  );

  if (!scenes.length) {
    grid.innerHTML = `<div class="empty-state card"><p class="muted">Sem cenas ainda.</p></div>`;
    return;
  }

  grid.innerHTML = scenes
    .map((scene, i) => {
      const imgAsset = scene.imageAssetId ? assetById[scene.imageAssetId] : null;
      const vidAsset = scene.videoAssetId ? assetById[scene.videoAssetId] : null;
      const imgStatus = scene.status?.image || "pending";
      const vidStatus = scene.status?.video || "pending";
      const imgSrc = imgAsset ? assetFileUrl(imgAsset.id) : "";
      const vidSrc = vidAsset ? assetFileUrl(vidAsset.id) : "";

      return `
      <article class="scene-card card scene-video-card" data-scene-id="${scene.id}">
        <div class="scene-card-head">
          <strong>${scene.id}</strong>
          <span class="scene-status status-${vidStatus}">${vidStatus}</span>
        </div>
        <div class="scene-media-stack">
          ${
            vidSrc
              ? `<video src="${vidSrc}?t=${Date.now()}" controls playsinline muted class="scene-video"></video>`
              : imgSrc
                ? `<img src="${imgSrc}?t=${Date.now()}" alt="" class="scene-preview-img" />`
                : `<div class="scene-thumb empty"><span>Sem imagem</span></div>`
          }
        </div>
        <div class="scene-status-row">
          <span class="scene-status status-${imgStatus}">img: ${imgStatus}</span>
          <span class="scene-status status-${vidStatus}">vid: ${vidStatus}</span>
        </div>
        <div class="scene-card-actions">
          <button type="button" class="btn sm primary" data-animate-scene="${scene.id}" ${
            imgAsset ? "" : "disabled"
          }>Animate</button>
        </div>
      </article>`;
    })
    .join("");
}

async function onAnimateAll() {
  if (!activeProjectId) return;
  hideVideosError();
  const btn = document.getElementById("btn-animate-all");
  btn.disabled = true;
  setVideosStatus("Animate All — a iniciar...");
  setVideosProgress(0, 1);

  try {
    const data = await animateAllVideos(activeProjectId);
    startJobPoll(data.jobId, data.sceneCount || 1);
  } catch (err) {
    showVideosError(err.message);
    btn.disabled = false;
  }
}

async function onAnimateScene(sceneId) {
  if (!activeProjectId) return;
  hideVideosError();
  setVideosStatus(`A animar ${sceneId}...`);

  try {
    const data = await animateSceneVideo(activeProjectId, sceneId);
    startJobPoll(data.jobId, 1, sceneId);
  } catch (err) {
    showVideosError(err.message);
  }
}

function startJobPoll(jobId, sceneTotal = 1, label = "Animate All") {
  if (pollTimer) clearInterval(pollTimer);
  document.getElementById("videos-progress")?.classList.remove("hidden");

  trackJob(jobId, {
    jobType: sceneTotal > 1 ? "videos" : "scene_video",
    pollMs: 1000,
    onUpdate: (job) => {
      const idx = job.progress?.sceneIndex || 0;
      const total = job.progress?.sceneTotal || sceneTotal;
      if (idx && total) setVideosProgress(idx, total);
      setVideosStatus(job.progress?.message || `${label}: ${job.status}`);
    },
    onComplete: async () => {
      document.getElementById("btn-animate-all")?.removeAttribute("disabled");
      await initProjects();
      await renderVideosPanel(activeProjectId);
      setVideosStatus("Animação concluída");
      window.dispatchEvent(
        new CustomEvent("ecoom:job-complete", {
          detail: { projectId: activeProjectId, jobId },
        }),
      );
    },
    onFailed: (job) => {
      showVideosError(job.error || "Animação falhou");
      document.getElementById("btn-animate-all")?.removeAttribute("disabled");
    },
  });
}

export function destroyVideosTab() {
  if (pollTimer) clearInterval(pollTimer);
  stopJobTracking();
}
