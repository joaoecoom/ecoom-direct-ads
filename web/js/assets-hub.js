import { fetchProjectAssets } from "./api.js";
import { getProject, initProjects } from "./projects.js";
import { getStartingPoint } from "./starting-point.js";
import {
  bindAssetStudioInteractions,
  createAssetStudioState,
  generateStudioImages,
  generateStudioVideo,
  handleAssetAction,
  ingestDroppedFiles,
  renderAssetActionsPanel,
  renderAssetsGridHtml,
  setupPanelDragDrop,
  uploadFilesToProject,
} from "./asset-studio-shared.js";

let activeProjectId = null;
let pendingAction = null;
const state = createAssetStudioState("all");

export function initAssetsHub(projectId) {
  activeProjectId = projectId;
  bindAssetsHubEvents();
  void renderAssetsHub(projectId);
}

function bindAssetsHubEvents() {
  const panel = document.getElementById("panel-assets");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  document.getElementById("assets-upload-input")?.addEventListener("change", onUploadAssets);
  document.getElementById("assets-upload-video-input")?.addEventListener("change", onUploadVideo);

  bindAssetStudioInteractions(panel, state, {
    filterNavId: "assets-filter-nav",
    onFilter: () => {
      const project = getProject(activeProjectId);
      const grid = document.getElementById("assets-grid");
      if (grid && project) {
        grid.innerHTML = renderAssetsGridHtml(project, state.cachedAssets, state);
      }
    },
    onSelect: (assetId) => {
      renderAssetActionsPanel(document.getElementById("asset-actions-panel"), assetId);
    },
    onAction: (action) => void runAssetAction(action),
  });

  setupPanelDragDrop(panel, "assets-dropzone", (files) => {
    void ingestDroppedFiles(activeProjectId, files, studioCallbacks());
  });

  window.addEventListener("ecoom:starting-point", (e) => {
    if (e.detail?.projectId === activeProjectId) {
      pendingAction = e.detail.action;
      void runPendingEntryAction();
    }
  });

  window.addEventListener("ecoom:project-synced", () => {
    if (activeProjectId) void renderAssetsHub(activeProjectId);
  });
}

function studioCallbacks() {
  return {
    onStatus: setAssetsStatus,
    onError: showAssetsNotice,
    onComplete: async () => {
      await renderAssetsHub(activeProjectId);
    },
  };
}

async function runAssetAction(action) {
  await handleAssetAction(action, {
    projectId: activeProjectId,
    selectedAssetId: state.selectedAssetId,
    cachedAssets: state.cachedAssets,
    onStatus: setAssetsStatus,
    onError: showAssetsNotice,
    onComplete: async () => {
      await renderAssetsHub(activeProjectId);
    },
  });
}

async function runPendingEntryAction() {
  if (!pendingAction || !activeProjectId) return;
  const action = pendingAction;
  pendingAction = null;

  await renderAssetsHub(activeProjectId);

  switch (action) {
    case "image":
      document.getElementById("assets-upload-input")?.click();
      break;
    case "video":
      document.getElementById("assets-upload-video-input")?.click();
      break;
    case "upload":
      document.getElementById("assets-upload-input")?.click();
      break;
    case "generate-image":
      showGeneratePrompt("image");
      break;
    case "generate-video":
      showGeneratePrompt("video");
      break;
    default:
      break;
  }
}

function showGeneratePrompt(kind) {
  const project = getProject(activeProjectId);
  const defaultText =
    project?.entryPrompt ||
    project?.masterPrompt ||
    (kind === "image"
      ? "Mulher portuguesa de 45 anos numa cozinha moderna, luz natural, estilo UGC..."
      : "Pessoa a falar para câmara, UGC autêntico, 9:16...");

  const prompt = window.prompt(
    kind === "image" ? "Prompt para Nano Banana Pro:" : "Prompt para Veo:",
    defaultText,
  );
  if (!prompt?.trim()) return;

  const cb = studioCallbacks();
  if (kind === "image") {
    void generateStudioImages(activeProjectId, { prompt: prompt.trim(), count: 1 }, cb);
  } else {
    void generateStudioVideo(activeProjectId, { prompt: prompt.trim() }, cb);
  }
}

function setAssetsStatus(msg) {
  const el = document.getElementById("assets-status");
  if (el) el.textContent = msg;
}

function showAssetsNotice(msg) {
  const el = document.getElementById("assets-notice");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideAssetsNotice() {
  document.getElementById("assets-notice")?.classList.add("hidden");
}

export async function renderAssetsHub(projectId) {
  activeProjectId = projectId;
  hideAssetsNotice();

  const project = getProject(projectId);
  const grid = document.getElementById("assets-grid");
  if (!grid || !project) return;

  const sp = getStartingPoint(project.startingPoint || "prompt");
  setAssetsStatus(
    project.assetIds?.length
      ? `${project.assetIds.length} asset(s) no projecto`
      : `Workspace «${sp.titlePt}» — arrasta imagens ou vídeos.`,
  );

  let assets = [];
  try {
    const data = await fetchProjectAssets(projectId);
    assets = data.assets || [];
    state.cachedAssets = assets;
  } catch {
    grid.innerHTML = `<div class="empty-state card"><p class="muted">API offline — assets indisponíveis.</p></div>`;
    return;
  }

  if (!assets.length) {
    grid.innerHTML = `
      <div class="assets-empty card">
        <p class="eyebrow">Project Assets</p>
        <h3>Sem assets ainda</h3>
        <p class="muted"><strong>Arrasta e solta</strong> imagens ou vídeos — ou + Imagem / + Vídeo.</p>
        <p class="muted">Variações, animar e Build Ad quando estiveres pronto.</p>
      </div>`;
    renderAssetActionsPanel(document.getElementById("asset-actions-panel"), null);
    return;
  }

  grid.innerHTML = renderAssetsGridHtml(project, assets, state);
  if (!state.selectedAssetId && assets[0]) state.selectedAssetId = assets[0].id;
  renderAssetActionsPanel(document.getElementById("asset-actions-panel"), state.selectedAssetId);
}

async function onUploadAssets(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  setAssetsStatus(`A enviar ${files.length} ficheiro(s)...`);
  try {
    await uploadFilesToProject(activeProjectId, files);
    await initProjects();
    await renderAssetsHub(activeProjectId);
    setAssetsStatus("Upload concluído.");
  } catch (err) {
    showAssetsNotice(err.message);
  } finally {
    e.target.value = "";
  }
}

async function onUploadVideo(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  setAssetsStatus("A enviar vídeo...");
  try {
    await uploadFilesToProject(activeProjectId, files, { asVideo: true });
    await initProjects();
    await renderAssetsHub(activeProjectId);
    setAssetsStatus("Vídeo importado.");
  } catch (err) {
    showAssetsNotice(err.message);
  } finally {
    e.target.value = "";
  }
}

export function destroyAssetsHub() {
  state.selectedAssetId = null;
  pendingAction = null;
}
