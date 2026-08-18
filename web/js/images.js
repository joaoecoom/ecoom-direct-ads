import {
  assetFileUrl,
  fetchProjectAssets,
  generateAllImages,
  generateBlueprint,
  regenerateSceneImage,
  uploadAsset,
} from "./api.js";
import { trackJob, stopJobTracking } from "./job-activity.js";
import { ensureProjectOnServer, getProject, initProjects } from "./projects.js";

let pollTimer = null;
let activeProjectId = null;

export function initImagesTab(projectId) {
  activeProjectId = projectId;
  bindImageEvents();
  void renderImagesPanel(projectId);
}

function bindImageEvents() {
  const panel = document.getElementById("panel-images");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  document.getElementById("btn-gen-blueprint")?.addEventListener("click", onGenerateBlueprint);
  document.getElementById("btn-gen-all-images")?.addEventListener("click", onGenerateAllImages);
  document.getElementById("upload-asset-input")?.addEventListener("change", onUploadFiles);

  panel.addEventListener("click", (e) => {
    const regen = e.target.closest("[data-regen-scene]");
    if (regen) {
      void onRegenerateScene(regen.dataset.regenScene);
    }
  });
}

function showImagesError(msg) {
  const el = document.getElementById("images-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideImagesError() {
  document.getElementById("images-error")?.classList.add("hidden");
}

function setImagesStatus(msg) {
  const el = document.getElementById("images-status");
  if (el) el.textContent = msg;
}

export async function renderImagesPanel(projectId) {
  activeProjectId = projectId;
  hideImagesError();

  const project = getProject(projectId);
  const grid = document.getElementById("scene-images-grid");
  if (!grid) return;

  const hasBlueprint = Boolean(
    project?.blueprintPath || project?.blueprint || project?.scenes?.length,
  );

  document.getElementById("btn-gen-all-images")?.toggleAttribute(
    "disabled",
    !hasBlueprint,
  );

  let assets = [];
  let scenes = project?.scenes || [];

  try {
    const data = await fetchProjectAssets(projectId);
    assets = data.assets || [];
    scenes = data.scenes?.length ? data.scenes : scenes;
  } catch {
    /* offline */
  }

  const assetById = Object.fromEntries(assets.map((a) => [a.id, a]));

  if (!scenes.length) {
    grid.innerHTML = `
      <div class="empty-state card">
        <p class="muted">Gera o <strong>Blueprint</strong> primeiro — cria storyboard + prompts por cena.</p>
        <p class="muted">Depois: <strong>Generate All Images</strong> anima cada cena.</p>
      </div>`;
    return;
  }

  grid.innerHTML = scenes
    .map((scene) => {
      const asset = scene.imageAssetId ? assetById[scene.imageAssetId] : null;
      const imgStatus = scene.status?.image || "pending";
      const src = asset ? assetFileUrl(asset.id) : "";
      return `
      <article class="scene-card card" data-scene-id="${scene.id}">
        <div class="scene-card-head">
          <strong>${scene.id}</strong>
          <span class="scene-status status-${imgStatus}">${imgStatus}</span>
        </div>
        <div class="scene-thumb ${src ? "" : "empty"}">
          ${src ? `<img src="${src}?t=${Date.now()}" alt="${scene.id}" loading="lazy" />` : "<span>Sem imagem</span>"}
        </div>
        <p class="scene-prompt muted">${escapeHtml((scene.imagePrompt || "").slice(0, 120))}</p>
        <div class="scene-card-actions">
          <button type="button" class="btn sm" data-regen-scene="${scene.id}">Regenerate</button>
        </div>
      </article>`;
    })
    .join("");
}

async function onGenerateBlueprint() {
  if (!activeProjectId) return;
  hideImagesError();
  const project = getProject(activeProjectId);
  const btn = document.getElementById("btn-gen-blueprint");
  btn.disabled = true;
  setImagesStatus("A gerar blueprint...");

  try {
    const data = await generateBlueprint(activeProjectId, {
      offer: project?.masterPrompt,
    });
    startJobPoll(data.jobId, "Blueprint", "blueprint");
  } catch (err) {
    showImagesError(err.message);
    btn.disabled = false;
  }
}

async function onGenerateAllImages() {
  if (!activeProjectId) return;
  hideImagesError();
  const btn = document.getElementById("btn-gen-all-images");
  btn.disabled = true;
  setImagesStatus("A gerar imagens...");

  try {
    const data = await generateAllImages(activeProjectId);
    startJobPoll(data.jobId, "Images");
  } catch (err) {
    showImagesError(err.message);
    btn.disabled = false;
  }
}

async function onRegenerateScene(sceneId) {
  if (!activeProjectId) return;
  hideImagesError();
  setImagesStatus(`A regenerar ${sceneId}...`);
  try {
    const data = await regenerateSceneImage(activeProjectId, sceneId);
    startJobPoll(data.jobId, sceneId, "scene_image");
  } catch (err) {
    showImagesError(err.message);
  }
}

async function onUploadFiles(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  hideImagesError();
  setImagesStatus(`A enviar ${files.length} imagem(ns)...`);

  try {
    for (const file of files) {
      const data = await fileToBase64(file);
      await uploadAsset(activeProjectId, {
        data,
        filename: file.name,
        mimeType: file.type,
      });
    }
    await initProjects();
    await renderImagesPanel(activeProjectId);
    setImagesStatus("Upload concluído");
  } catch (err) {
    showImagesError(err.message);
  } finally {
    e.target.value = "";
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function startJobPoll(jobId, label, jobType = "images") {
  if (pollTimer) clearInterval(pollTimer);
  trackJob(jobId, {
    jobType,
    pollMs: 1000,
    onUpdate: (job) => {
      const scene =
        job.progress?.sceneIndex && job.progress?.sceneTotal
          ? ` (${job.progress.sceneIndex}/${job.progress.sceneTotal})`
          : "";
      setImagesStatus(`${label}${scene}: ${job.progress?.message || job.status}`);
    },
    onComplete: async () => {
      document.getElementById("btn-gen-blueprint")?.removeAttribute("disabled");
      document.getElementById("btn-gen-all-images")?.removeAttribute("disabled");
      await initProjects();
      await renderImagesPanel(activeProjectId);
      setImagesStatus(`${label} concluído`);
      window.dispatchEvent(
        new CustomEvent("ecoom:job-complete", {
          detail: { projectId: activeProjectId, jobId },
        }),
      );
    },
    onFailed: (job) => {
      showImagesError(job.error || "Job falhou");
      document.getElementById("btn-gen-blueprint")?.removeAttribute("disabled");
      document.getElementById("btn-gen-all-images")?.removeAttribute("disabled");
    },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function destroyImagesTab() {
  if (pollTimer) clearInterval(pollTimer);
  stopJobTracking();
}
