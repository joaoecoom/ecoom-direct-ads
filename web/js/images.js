import {
  assetFileUrl,
  fetchJob,
  fetchProjectAssets,
  generateAllImages,
  generateBlueprint,
  regenerateSceneImage,
  syncJobToProject,
} from "./api.js";
import {
  bindAssetStudioInteractions,
  createAssetStudioState,
  generateStudioImages,
  handleAssetAction,
  ingestDroppedFiles,
  renderAssetActionsPanel,
  renderAssetsGridHtml,
  setupPanelDragDrop,
  uploadFilesToProject,
} from "./asset-studio-shared.js";
import { trackJob, stopJobTracking, waitForJob } from "./job-activity.js";
import { ensureProjectOnServer, getProject, initProjects } from "./projects.js";

let pollTimer = null;
let activeProjectId = null;
const assetState = createAssetStudioState("all");

export function initImagesTab(projectId) {
  activeProjectId = projectId;
  hideImagesError();
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
  document.getElementById("upload-reference-input")?.addEventListener("change", onUploadReferences);
  document.getElementById("btn-sync-last-job")?.addEventListener("click", () => void onSyncLastJob());

  document.getElementById("images-studio-upload-input")?.addEventListener("change", onStudioUploadImages);
  document.getElementById("images-studio-upload-video-input")?.addEventListener("change", onStudioUploadVideos);

  document.getElementById("images-generate-bar")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void onGenerateStudioImage();
  });
  document.getElementById("images-goto-ads")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "create" } }));
  });

  window.addEventListener("ecoom:starting-point", (e) => {
    if (e.detail?.projectId !== activeProjectId) return;
    void applyStartingPointAction(e.detail.action);
  });

  bindAssetStudioInteractions(panel, assetState, {
    filterNavId: "images-filter-nav",
    onFilter: () => {
      const project = getProject(activeProjectId);
      renderProjectAssetsSection(project, assetState.cachedAssets);
    },
    onSelect: (assetId) => {
      renderAssetActionsPanel(document.getElementById("images-asset-actions"), assetId);
    },
    onAction: (action) => void runImagesAssetAction(action),
  });

  setupPanelDragDrop(panel, "images-dropzone", (files) => {
    void ingestDroppedFiles(activeProjectId, files, imagesStudioCallbacks());
  });

  panel.addEventListener("click", (e) => {
    const regen = e.target.closest("[data-regen-scene]");
    if (regen) {
      void onRegenerateScene(regen.dataset.regenScene);
    }
  });
}

function setImagesAssetsStatus(msg) {
  const el = document.getElementById("images-assets-status");
  if (el) el.textContent = msg;
}

function showImagesStudioNotice(msg) {
  const el = document.getElementById("images-studio-notice");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideImagesStudioNotice() {
  document.getElementById("images-studio-notice")?.classList.add("hidden");
}

async function onGenerateStudioImage() {
  const prompt = document.getElementById("images-generate-prompt")?.value?.trim();
  const count = Number(document.getElementById("images-generate-count")?.value || 1);
  if (!prompt) {
    showImagesStudioNotice("Escreve um prompt para gerar a imagem.");
    document.getElementById("images-generate-prompt")?.focus();
    return;
  }
  hideImagesStudioNotice();
  await generateStudioImages(activeProjectId, { prompt, count }, imagesStudioCallbacks());
}

async function applyStartingPointAction(action) {
  const project = getProject(activeProjectId);
  const promptEl = document.getElementById("images-generate-prompt");
  if (project?.entryPrompt && promptEl && !promptEl.value) {
    promptEl.value = project.entryPrompt;
  }

  switch (action) {
    case "image":
      document.getElementById("images-studio-upload-input")?.click();
      break;
    case "upload":
      document.getElementById("images-generate-prompt")?.focus();
      break;
    case "generate-image":
      promptEl?.focus();
      if (project?.entryPrompt) void onGenerateStudioImage();
      break;
    default:
      break;
  }
}

function imagesStudioCallbacks() {
  return {
    onStatus: setImagesAssetsStatus,
    onError: showImagesStudioNotice,
    onComplete: async () => {
      await renderImagesPanel(activeProjectId);
    },
  };
}

async function runImagesAssetAction(action) {
  await handleAssetAction(action, {
    projectId: activeProjectId,
    selectedAssetId: assetState.selectedAssetId,
    cachedAssets: assetState.cachedAssets,
    onStatus: setImagesAssetsStatus,
    onError: showImagesStudioNotice,
    onComplete: async () => {
      await renderImagesPanel(activeProjectId);
    },
  });
}

function renderProjectAssetsSection(project, assets) {
  const grid = document.getElementById("images-assets-grid");
  if (!grid) return;

  assetState.cachedAssets = assets;
  const count = assets.length;
  setImagesAssetsStatus(
    count
      ? `${count} asset(s) — selecciona para variações, animar ou Build Ad.`
      : "Sem assets — arrasta imagens ou vídeos para aqui.",
  );

  if (!assets.length) {
    grid.innerHTML = `
      <div class="assets-empty card">
        <h3>Sem assets ainda</h3>
        <p class="muted"><strong>Arrasta e solta</strong> ou + Imagem / + Vídeo. Estilo Flow — prepara antes do ad.</p>
      </div>`;
    renderAssetActionsPanel(document.getElementById("images-asset-actions"), null);
    return;
  }

  grid.innerHTML = renderAssetsGridHtml(project, assets, assetState);
  if (!assetState.selectedAssetId && assets[0]) assetState.selectedAssetId = assets[0].id;
  renderAssetActionsPanel(document.getElementById("images-asset-actions"), assetState.selectedAssetId);
}

async function onStudioUploadImages(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  hideImagesStudioNotice();
  setImagesAssetsStatus(`A enviar ${files.length} imagem(ns)...`);
  try {
    await uploadFilesToProject(activeProjectId, files);
    await initProjects();
    await renderImagesPanel(activeProjectId);
    setImagesAssetsStatus("Upload concluído.");
  } catch (err) {
    showImagesStudioNotice(err.message);
  } finally {
    e.target.value = "";
  }
}

async function onStudioUploadVideos(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  hideImagesStudioNotice();
  setImagesAssetsStatus("A enviar vídeo...");
  try {
    await uploadFilesToProject(activeProjectId, files, { asVideo: true });
    await initProjects();
    await renderImagesPanel(activeProjectId);
    setImagesAssetsStatus("Vídeo importado.");
  } catch (err) {
    showImagesStudioNotice(err.message);
  } finally {
    e.target.value = "";
  }
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

function renderPipelineHint(project) {
  const hint = document.getElementById("images-pipeline-hint");
  if (!hint) return;

  const hasBlueprint = Boolean(project?.blueprintPath);
  const hasCopy = Boolean(project?.latestCopy || project?.activeCreative?.copy);
  const scenes = project?.scenes || [];
  const imagesReady = scenes.some((s) => s.imageAssetId);

  if (imagesReady) {
    hint.classList.add("hidden");
    return;
  }

  hint.classList.remove("hidden");
  if (!hasCopy) {
    hint.innerHTML =
      '<p class="muted">Passo 1: no <strong>Ads</strong>, gera a copy. Para tudo automático, usa <strong>Gerar Vídeo Completo</strong>.</p>';
  } else if (!hasBlueprint) {
    hint.innerHTML =
      '<p class="muted">Copy pronta ✓ — <strong>Generate All Images</strong> cria o blueprint e as imagens. Ou no Ads: <strong>Gerar Vídeo Completo</strong>.</p>';
  } else {
    hint.innerHTML =
      '<p class="muted">Blueprint pronto ✓ — clica <strong>Generate All Images</strong>. Para vídeo final: tab Videos ou <strong>Gerar Vídeo Completo</strong>.</p>';
  }
}

function defaultImagesStatus(project) {
  const hasBlueprint = Boolean(project?.blueprintPath);
  const hasCopy = Boolean(project?.latestCopy || project?.activeCreative?.copy);
  if (!hasCopy) {
    return "Gera copy no Ads — ou usa «Gerar Vídeo Completo» para o fluxo completo.";
  }
  if (!hasBlueprint) {
    return "Copy pronta — «Generate All Images» cria blueprint + imagens automaticamente.";
  }
  return "Blueprint pronto — gera imagens ou usa «Gerar Vídeo Completo» no Ads.";
}

function setImagesStatus(msg) {
  const el = document.getElementById("images-status");
  if (el) {
    el.textContent = msg;
    if (msg) el.dataset.busy = "1";
    else delete el.dataset.busy;
  }
}

function clearImagesStatus(project) {
  const el = document.getElementById("images-status");
  if (el && !el.dataset.busy) {
    el.textContent = defaultImagesStatus(project);
  }
}

function renderAvatarPanel(project, assetById) {
  const panel = document.getElementById("avatar-panel");
  const thumb = document.getElementById("avatar-thumb");
  const brief = document.getElementById("avatar-brief");
  if (!panel || !thumb) return;

  const avatar = project?.avatar;
  if (!avatar?.anchorImageAssetId && !avatar?.characterBrief) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  const asset = avatar.anchorImageAssetId ? assetById[avatar.anchorImageAssetId] : null;
  const src = asset ? assetFileUrl(asset.id) : "";

  thumb.className = `scene-thumb avatar-thumb ${src ? "" : "empty"}`;
  thumb.innerHTML = src
    ? `<img src="${src}?t=${Date.now()}" alt="Avatar" loading="lazy" />`
    : "<span>Sem avatar</span>";

  if (brief) {
    const parts = [];
    if (avatar.characterBrief) parts.push(avatar.characterBrief);
    if (avatar.settingBrief) parts.push(`Cenário: ${avatar.settingBrief}`);
    brief.textContent = parts.join(" · ").slice(0, 280);
  }
}

function renderReferencesPanel(project, assets) {
  const panel = document.getElementById("references-panel");
  const grid = document.getElementById("references-grid");
  if (!panel || !grid) return;

  const refIds = project?.referenceAssetIds || [];
  const refs = refIds
    .map((id) => assets.find((a) => a.id === id))
    .filter(Boolean);

  if (panel.classList.contains("hidden")) return;
  if (!refs.length) {
    grid.innerHTML = `<p class="muted">Ainda sem referências — adiciona produtos, roupas ou props.</p>`;
    return;
  }

  grid.innerHTML = refs
    .map(
      (asset) => `
    <figure class="reference-chip">
      <img src="${assetFileUrl(asset.id)}?t=${Date.now()}" alt="${escapeHtml(asset.prompt || "ref")}" loading="lazy" />
      <figcaption>${escapeHtml((asset.metadata?.label || asset.prompt || "ref").slice(0, 40))}</figcaption>
    </figure>`,
    )
    .join("");
}

export async function renderImagesPanel(projectId) {
  activeProjectId = projectId;
  hideImagesStudioNotice();

  const project = getProject(projectId);
  const grid = document.getElementById("scene-images-grid");
  if (!grid) return;

  let assets = [];
  let scenes = project?.scenes || [];

  try {
    const data = await fetchProjectAssets(projectId);
    assets = data.assets || [];
    scenes = data.scenes?.length ? data.scenes : scenes;
  } catch {
    /* offline */
  }

  renderProjectAssetsSection(project, assets);

  const pipelineEl = document.getElementById("images-pipeline-section");
  pipelineEl?.classList.toggle("hidden", !scenes.length);

  const hasBlueprint = Boolean(project?.blueprintPath);
  const hasCopy = Boolean(project?.latestCopy || project?.activeCreative?.copy);
  const canGenerateImages = hasBlueprint || hasCopy;

  renderPipelineHint(project);
  clearImagesStatus(project);

  document.getElementById("references-panel")?.classList.toggle("hidden", !hasBlueprint);

  document.getElementById("btn-gen-all-images")?.toggleAttribute(
    "disabled",
    !canGenerateImages,
  );

  if (scenes.length && !hasBlueprint && hasCopy) {
    showImagesError(
      "Cenas antigas sem blueprint actual — «Generate All Images» recria o storyboard e gera imagens.",
    );
  }

  const assetById = Object.fromEntries(assets.map((a) => [a.id, a]));
  renderAvatarPanel(project, assetById);
  renderReferencesPanel(project, assets);

  const syncBtn = document.getElementById("btn-sync-last-job");
  const lastJobId = project?.jobIds?.[project.jobIds.length - 1];
  const imagesMissing = scenes.length && scenes.every((s) => !s.imageAssetId);
  syncBtn?.classList.toggle("hidden", !imagesMissing || !lastJobId);

  if (!scenes.length) {
    grid.innerHTML = `
      <div class="empty-state card">
        <p class="muted">Gera copy no <strong>Ads</strong>, depois clica <strong>Generate All Images</strong> (blueprint + imagens).</p>
        <p class="muted">Ou usa <strong>Gerar Vídeo Completo</strong> para copy → imagens → vídeo → export num só fluxo.</p>
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

async function onSyncLastJob() {
  if (!activeProjectId) return;
  hideImagesError();
  const project = getProject(activeProjectId);
  const jobId = project?.jobIds?.[project.jobIds.length - 1];
  if (!jobId) {
    showImagesError("Nenhum job encontrado neste projecto.");
    return;
  }

  const btn = document.getElementById("btn-sync-last-job");
  btn.disabled = true;
  setImagesStatus("A importar assets do job...");

  try {
    const job = await fetchJob(jobId);
    if (job?.status !== "completed") {
      throw new Error("O último job ainda não terminou.");
    }
    await syncJobToProject(activeProjectId, jobId);
    await initProjects();
    await renderImagesPanel(activeProjectId);
    setImagesStatus("Assets importados — imagens, vídeos e export actualizados.");
    window.dispatchEvent(
      new CustomEvent("ecoom:job-complete", {
        detail: { projectId: activeProjectId, jobId },
      }),
    );
  } catch (err) {
    showImagesError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function onGenerateBlueprint() {
  if (!activeProjectId) return;
  hideImagesError();
  const btn = document.getElementById("btn-gen-blueprint");
  btn.disabled = true;
  setImagesStatus("A gerar blueprint...");

  try {
    const project = await ensureProjectOnServer(activeProjectId);
    activeProjectId = project.id;
    const data = await generateBlueprint(project.id, {
      offer: project.masterPrompt,
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
  const btnBlueprint = document.getElementById("btn-gen-blueprint");
  btn.disabled = true;
  btnBlueprint?.setAttribute("disabled", "");

  try {
    let project = await ensureProjectOnServer(activeProjectId);
    activeProjectId = project.id;

    const hasCopy = Boolean(project.latestCopy || project.activeCreative?.copy);
    let hasBlueprint = Boolean(project.blueprintPath);

    if (!hasCopy && !hasBlueprint) {
      throw new Error(
        "Gera copy primeiro (Ads) ou usa «Gerar Vídeo Completo» para o fluxo completo.",
      );
    }

    if (!hasBlueprint) {
      setImagesStatus("Passo 1/2: A gerar blueprint (storyboard)...");
      const bp = await generateBlueprint(project.id, {
        offer: project.masterPrompt,
        approvedCopy: project.latestCopy || project.activeCreative?.copy,
      });
      await waitForJob(bp.jobId, { jobType: "blueprint" });
      await initProjects();
      project = getProject(activeProjectId);
      hasBlueprint = Boolean(project?.blueprintPath);
      if (!hasBlueprint) {
        throw new Error("Blueprint não ficou disponível — tenta outra vez.");
      }
    }

    setImagesStatus(hasBlueprint ? "A gerar imagens..." : "Passo 2/2: A gerar imagens...");
    const data = await generateAllImages(project.id);
    await waitForJob(data.jobId, {
      jobType: "images",
      onUpdate: (job) => {
        const scene =
          job.progress?.sceneIndex && job.progress?.sceneTotal
            ? ` (${job.progress.sceneIndex}/${job.progress.sceneTotal})`
            : "";
        setImagesStatus(`Imagens${scene}: ${job.progress?.message || job.status}`);
      },
    });

    await initProjects();
    await renderImagesPanel(activeProjectId);
    setImagesStatus("Imagens concluídas");
    window.dispatchEvent(
      new CustomEvent("ecoom:job-complete", {
        detail: { projectId: activeProjectId, jobId: data.jobId },
      }),
    );
  } catch (err) {
    showImagesError(err.message);
  } finally {
    btn.disabled = false;
    btnBlueprint?.removeAttribute("disabled");
    const project = getProject(activeProjectId);
    delete document.getElementById("images-status")?.dataset.busy;
    clearImagesStatus(project);
    await renderImagesPanel(activeProjectId);
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

async function uploadFilesAs(files, { asReference = false } = {}) {
  await uploadFilesToProject(activeProjectId, files, { asReference });
}

async function onUploadFiles(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  hideImagesError();
  setImagesStatus(`A enviar ${files.length} imagem(ns)...`);

  try {
    await uploadFilesAs(files);
    await initProjects();
    await renderImagesPanel(activeProjectId);
    setImagesStatus("Upload concluído");
  } catch (err) {
    showImagesError(err.message);
  } finally {
    e.target.value = "";
  }
}

async function onUploadReferences(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  hideImagesError();
  setImagesStatus(`A adicionar ${files.length} referência(s)...`);

  try {
    await uploadFilesAs(files, { asReference: true });
    await initProjects();
    await renderImagesPanel(activeProjectId);
    setImagesStatus("Referências adicionadas");
  } catch (err) {
    showImagesError(err.message);
  } finally {
    e.target.value = "";
  }
}

export function destroyImagesTab() {
  if (pollTimer) clearInterval(pollTimer);
  stopJobTracking();
  assetState.selectedAssetId = null;
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
