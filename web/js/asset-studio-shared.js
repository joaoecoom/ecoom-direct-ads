import {
  addProjectReference,
  assetFileUrl,
  animateAsset,
  generateAssetVariations,
  generateStandaloneImage,
  generateStandaloneVideo,
  setProjectAvatar,
  uploadAsset,
} from "./api.js";
import { waitForJob } from "./job-activity.js";
import { getProject, initProjects } from "./projects.js";

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function createAssetStudioState(defaultFilter = "all") {
  return {
    selectedAssetId: null,
    assetFilter: defaultFilter,
    cachedAssets: [],
  };
}

export function assetBadges(asset, { avatarId, refIds } = {}) {
  const tags = [];
  if (avatarId && asset.id === avatarId) tags.push('<span class="asset-badge">Personagem</span>');
  if (refIds?.has(asset.id)) tags.push('<span class="asset-badge ref">Ref</span>');
  if (asset.source === "variation") tags.push('<span class="asset-badge var">Var</span>');
  if (asset.source === "upload") tags.push('<span class="asset-badge up">Upload</span>');
  return tags.join("");
}

export function renderAssetGroup(title, items, { selectedAssetId, badgeCtx = {} } = {}) {
  if (!items.length) return "";
  return `
    <section class="assets-group">
      <h3 class="assets-group-title">${title}</h3>
      <div class="assets-group-grid">
        ${items
          .map(
            (a) => `
          <button type="button" class="asset-card card ${selectedAssetId === a.id ? "selected" : ""}" data-asset-id="${a.id}">
            <div class="asset-card-badges">${assetBadges(a, badgeCtx)}</div>
            <div class="asset-card-thumb ${a.type === "video" ? "video" : ""}">
              ${
                a.type === "video"
                  ? `<video src="${assetFileUrl(a.id)}" muted playsinline preload="metadata"></video><span class="asset-play">▶</span>`
                  : `<img src="${assetFileUrl(a.id)}" alt="" loading="lazy" />`
              }
            </div>
            <span class="asset-card-label">${escapeHtml((a.metadata?.label || a.prompt || a.source).slice(0, 36))}</span>
          </button>`,
          )
          .join("")}
      </div>
    </section>`;
}

export function filterAssets(assets, filter, project) {
  const avatarId = project?.avatar?.anchorImageAssetId;
  if (filter === "image") return assets.filter((a) => a.type === "image");
  if (filter === "video") return assets.filter((a) => a.type === "video");
  if (filter === "character") {
    return assets.filter(
      (a) => a.type === "image" && (a.id === avatarId || a.metadata?.role === "character"),
    );
  }
  return assets;
}

export function renderAssetsGridHtml(project, assets, state) {
  const avatarId = project?.avatar?.anchorImageAssetId;
  const refIds = new Set(project?.referenceAssetIds || []);
  const badgeCtx = { avatarId, refIds };
  const filtered = filterAssets(assets, state.assetFilter, project);

  if (!filtered.length) {
    return `<div class="empty-state card"><p class="muted">Nenhum asset neste filtro — arrasta ficheiros ou faz upload.</p></div>`;
  }

  const images = filtered.filter((a) => a.type === "image");
  const videos = filtered.filter((a) => a.type === "video");
  const showImages =
    state.assetFilter === "all" ||
    state.assetFilter === "image" ||
    state.assetFilter === "character";
  const showVideos = state.assetFilter === "all" || state.assetFilter === "video";

  return `
    ${showImages ? renderAssetGroup("Imagens", images, { selectedAssetId: state.selectedAssetId, badgeCtx }) : ""}
    ${showVideos ? renderAssetGroup("Vídeos", videos, { selectedAssetId: state.selectedAssetId, badgeCtx }) : ""}
  `;
}

export function renderAssetActionsPanel(panelEl, assetId) {
  if (!panelEl) return;
  if (!assetId) {
    panelEl.innerHTML = `<p class="muted">Selecciona um asset para ver acções.</p>`;
    return;
  }

  panelEl.innerHTML = `
    <p class="eyebrow">A partir deste asset</p>
    <div class="asset-actions-grid">
      <button type="button" class="btn sm" data-asset-action="use-reference">Usar como referência</button>
      <button type="button" class="btn sm" data-asset-action="use-character">Usar como personagem</button>
      <button type="button" class="btn sm" data-asset-action="edit-image">Editar / regenerar</button>
      <button type="button" class="btn sm" data-asset-action="variations">Gerar variações</button>
      <button type="button" class="btn sm" data-asset-action="animate">Animar</button>
      <button type="button" class="btn sm" data-asset-action="build-ad">Build Ad</button>
      <button type="button" class="btn primary sm" data-asset-action="create-from">Create from this</button>
    </div>
    <p class="muted asset-actions-note">Variações · animar · usar no ad — estilo Flow.</p>`;
}

export function setupPanelDragDrop(panel, dropzoneId, onFiles) {
  const dropzone = dropzoneId ? document.getElementById(dropzoneId) : null;
  let dragDepth = 0;

  const showDrop = () => dropzone?.classList.remove("hidden");
  const hideDrop = () => dropzone?.classList.add("hidden");

  panel?.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragDepth += 1;
    showDrop();
  });
  panel?.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      hideDrop();
    }
  });
  panel?.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  panel?.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    hideDrop();
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) void onFiles(files);
  });
}

export async function uploadFilesToProject(projectId, files, { asVideo = false, asReference = false } = {}) {
  for (const file of files) {
    const isVideo =
      asVideo || file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
    const data = await fileToBase64(file);
    await uploadAsset(projectId, {
      data,
      filename: file.name,
      mimeType: file.type,
      role: asReference ? "reference" : isVideo ? "video" : undefined,
      label: file.name,
    });
  }
}

export async function ingestDroppedFiles(projectId, files, callbacks = {}) {
  const { onStatus, onError, onComplete } = callbacks;
  onStatus?.(`A importar ${files.length} ficheiro(s)...`);
  try {
    await uploadFilesToProject(projectId, files);
    await initProjects();
    onComplete?.();
    onStatus?.("Importação concluída — selecciona um asset para continuar.");
  } catch (err) {
    onError?.(err.message);
  }
}

export async function handleAssetAction(action, ctx) {
  const { projectId, selectedAssetId, cachedAssets, onStatus, onError, onComplete } = ctx;
  if (!projectId || !selectedAssetId) return;

  switch (action) {
    case "use-reference":
      try {
        await addProjectReference(projectId, selectedAssetId);
        await initProjects();
        onComplete?.();
        onStatus?.("Referência adicionada.");
      } catch (err) {
        onError?.(err.message);
      }
      break;
    case "use-character": {
      const brief = window.prompt(
        "Descrição da personagem (opcional):",
        getProject(projectId)?.avatar?.characterBrief || "",
      );
      try {
        await setProjectAvatar(projectId, {
          assetId: selectedAssetId,
          characterBrief: brief || "",
        });
        await initProjects();
        onComplete?.();
        onStatus?.("Personagem definida.");
      } catch (err) {
        onError?.(err.message);
      }
      break;
    }
    case "edit-image": {
      const asset = cachedAssets.find((a) => a.id === selectedAssetId);
      if (asset?.type === "video") {
        onError?.("Editar/regenerar aplica-se a imagens.");
        break;
      }
      const prompt = window.prompt("Novo prompt para regenerar esta imagem:", asset?.prompt || "");
      if (!prompt?.trim()) break;
      onStatus?.("A regenerar imagem...");
      try {
        const data = await generateAssetVariations(projectId, selectedAssetId, {
          count: 1,
          prompt: prompt.trim(),
        });
        await waitForJob(data.jobId, { jobType: "variations" });
        await initProjects();
        onComplete?.();
        onStatus?.("Imagem actualizada.");
      } catch (err) {
        onError?.(err.message);
      }
      break;
    }
    case "variations": {
      const asset = cachedAssets.find((a) => a.id === selectedAssetId);
      if (asset?.type === "video") {
        onError?.("Variações aplicam-se a imagens.");
        break;
      }
      const countStr = window.prompt("Quantas variações? (1–12)", "5");
      const count = Math.min(12, Math.max(1, Number.parseInt(countStr || "5", 10) || 5));
      const prompt = window.prompt(
        "Prompt para as variações (opcional):",
        "Same person in different natural UGC environments, preserve identity",
      );
      onStatus?.(`A gerar ${count} variações...`);
      try {
        const data = await generateAssetVariations(projectId, selectedAssetId, {
          count,
          prompt: prompt || "",
        });
        await waitForJob(data.jobId, {
          jobType: "variations",
          onUpdate: (job) => {
            const scene =
              job.progress?.sceneIndex && job.progress?.sceneTotal
                ? ` (${job.progress.sceneIndex}/${job.progress.sceneTotal})`
                : "";
            onStatus?.(`Variações${scene}: ${job.progress?.message || job.status}`);
          },
        });
        await initProjects();
        onComplete?.();
        onStatus?.(`${count} variações concluídas.`);
      } catch (err) {
        onError?.(err.message);
      }
      break;
    }
    case "animate": {
      const asset = cachedAssets.find((a) => a.id === selectedAssetId);
      if (asset?.type === "video") {
        onError?.("Já é um vídeo — selecciona uma imagem para animar.");
        break;
      }
      const motion = window.prompt(
        "Prompt de movimento (Veo) — opcional:",
        asset?.prompt || "Natural handheld UGC, subtle motion, preserve identity",
      );
      onStatus?.("Veo — a animar imagem…");
      try {
        const data = await animateAsset(projectId, selectedAssetId, {
          prompt: motion || "",
        });
        await waitForJob(data.jobId, {
          jobType: "asset_video",
          onUpdate: (job) => onStatus?.(job.progress?.message || job.status),
        });
        await initProjects();
        onComplete?.();
        onStatus?.("Vídeo gerado — aparece no studio.");
      } catch (err) {
        onError?.(err.message);
      }
      break;
    }
    case "build-ad":
    case "create-from":
      window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "create" } }));
      break;
    default:
      break;
  }
}

export async function generateStudioImages(projectId, { prompt, count }, callbacks = {}) {
  const { onStatus, onError, onComplete } = callbacks;
  onStatus?.(`Nano Banana Pro — a gerar ${count > 1 ? count + " imagens" : "imagem"}…`);
  try {
    const data = await generateStandaloneImage(projectId, { prompt, count });
    await waitForJob(data.jobId, {
      jobType: "standalone_image",
      onUpdate: (job) => {
        const scene =
          job.progress?.sceneIndex && job.progress?.sceneTotal
            ? ` (${job.progress.sceneIndex}/${job.progress.sceneTotal})`
            : "";
        onStatus?.(`${job.progress?.message || job.status}${scene}`);
      },
    });
    await initProjects();
    onComplete?.();
    onStatus?.("Imagem(ns) pronta(s) no projecto.");
  } catch (err) {
    onError?.(err.message);
  }
}

export async function generateStudioVideo(projectId, { prompt }, callbacks = {}) {
  const { onStatus, onError, onComplete } = callbacks;
  onStatus?.("Veo — a gerar vídeo…");
  try {
    const data = await generateStandaloneVideo(projectId, { prompt });
    await waitForJob(data.jobId, {
      jobType: "standalone_video",
      onUpdate: (job) => onStatus?.(job.progress?.message || job.status),
    });
    await initProjects();
    onComplete?.();
    onStatus?.("Vídeo pronto no projecto.");
  } catch (err) {
    onError?.(err.message);
  }
}

export function bindAssetStudioInteractions(panel, state, handlers) {
  const { onSelect, onAction, onFilter, filterNavId } = handlers;

  document.getElementById(filterNavId)?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-assets-filter]");
    if (!btn) return;
    state.assetFilter = btn.dataset.assetsFilter;
    panel.querySelectorAll(`#${filterNavId} .assets-filter`).forEach((el) => {
      el.classList.toggle("active", el.dataset.assetsFilter === state.assetFilter);
    });
    onFilter?.();
  });

  panel.addEventListener("click", (e) => {
    const assetBtn = e.target.closest("[data-asset-id]");
    if (assetBtn) {
      state.selectedAssetId = assetBtn.dataset.assetId;
      panel.querySelectorAll("[data-asset-id]").forEach((el) => {
        el.classList.toggle("selected", el.dataset.assetId === state.selectedAssetId);
      });
      onSelect?.(state.selectedAssetId);
      return;
    }

    const action = e.target.closest("[data-asset-action]");
    if (action) void onAction?.(action.dataset.assetAction);
  });
}
