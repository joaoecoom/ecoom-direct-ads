import { addProjectReference, animateAsset, fetchProjectAssets, setProjectAvatar } from "./api.js";
import {
  generateStudioImages,
  generateStudioVideo,
  ingestDroppedFiles,
  renderAssetsGridHtml,
  setupPanelDragDrop,
  uploadFilesToProject,
} from "./asset-studio-shared.js";
import { waitForJob } from "./job-activity.js";
import { getProject, initProjects, updateProject } from "./projects.js";

let activeProjectId = null;
const state = {
  selectedAssetId: null,
  assetFilter: "all",
  cachedAssets: [],
  mode: "video",
  frameSlot: "inicial",
  inicialAssetId: null,
  finalAssetId: null,
};

export function initCanvas(projectId) {
  activeProjectId = projectId;
  bindCanvasEvents();
  void renderCanvas(projectId);
}

function bindCanvasEvents() {
  const panel = document.getElementById("panel-canvas");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  setupPanelDragDrop(panel, "canvas-dropzone", (files) => {
    void ingestDroppedFiles(activeProjectId, files, canvasCallbacks());
  });

  document.getElementById("canvas-upload-input")?.addEventListener("change", onCanvasUpload);
  document.getElementById("canvas-add-btn")?.addEventListener("click", () => {
    document.getElementById("canvas-upload-input")?.click();
  });

  document.getElementById("canvas-search")?.addEventListener("input", () => {
    renderCanvasGrid(getProject(activeProjectId), state.cachedAssets);
  });

  panel.addEventListener("click", (e) => {
    const assetBtn = e.target.closest("[data-asset-id]");
    if (assetBtn) {
      onSelectAsset(assetBtn.dataset.assetId);
      return;
    }
    const modeBtn = e.target.closest("[data-canvas-mode]");
    if (modeBtn) {
      state.mode = modeBtn.dataset.canvasMode;
      syncComposerUi();
    }
    const frameBtn = e.target.closest("[data-canvas-frame]");
    if (frameBtn) {
      state.frameSlot = frameBtn.dataset.canvasFrame;
      syncComposerUi();
    }
  });

  document.getElementById("canvas-composer")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void onComposerSubmit();
  });
}

function canvasCallbacks() {
  return {
    onStatus: setCanvasStatus,
    onError: setCanvasStatus,
    onComplete: async () => {
      await renderCanvas(activeProjectId);
    },
  };
}

function setCanvasStatus(msg) {
  const el = document.getElementById("canvas-status");
  if (el) el.textContent = msg || "";
}

function onSelectAsset(assetId) {
  state.selectedAssetId = assetId;
  const asset = state.cachedAssets.find((a) => a.id === assetId);
  if (state.frameSlot === "final" && asset?.type === "image") {
    state.finalAssetId = assetId;
  } else if (asset?.type === "image") {
    state.inicialAssetId = assetId;
  }
  const panel = document.getElementById("panel-canvas");
  panel?.querySelectorAll("[data-asset-id]").forEach((el) => {
    el.classList.toggle("selected", el.dataset.assetId === assetId);
    el.classList.toggle("frame-inicial", el.dataset.assetId === state.inicialAssetId);
    el.classList.toggle("frame-final", el.dataset.assetId === state.finalAssetId);
  });
  syncComposerUi();
}

function syncComposerUi() {
  document.querySelectorAll("[data-canvas-mode]").forEach((el) => {
    el.classList.toggle("active", el.dataset.canvasMode === state.mode);
  });
  document.querySelectorAll("[data-canvas-frame]").forEach((el) => {
    el.classList.toggle("active", el.dataset.canvasFrame === state.frameSlot);
  });

  const countEl = document.getElementById("canvas-count-wrap");
  countEl?.classList.toggle("hidden", state.mode !== "image");

  const modeLabel = document.getElementById("canvas-mode-label");
  const selected = state.cachedAssets.find((a) => a.id === state.selectedAssetId);
  if (modeLabel) {
    if (state.mode === "ads") {
      modeLabel.textContent = selected
        ? `Ads · ${selected.type === "video" ? "vídeo" : "imagem"} + prompt`
        : "Ads · só prompt";
    } else if (state.mode === "video") {
      if (selected?.type === "image") modeLabel.textContent = "Vídeo · a partir da imagem";
      else if (selected?.type === "video") modeLabel.textContent = "Vídeo · a partir do vídeo";
      else modeLabel.textContent = "Vídeo · a partir de prompt";
    } else {
      modeLabel.textContent = "Imagem · Nano Banana Pro";
    }
  }
}

async function onCanvasUpload(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  setCanvasStatus(`A importar ${files.length} ficheiro(s)…`);
  try {
    await uploadFilesToProject(activeProjectId, files);
    await initProjects();
    await renderCanvas(activeProjectId);
    setCanvasStatus("Ficheiros no projecto.");
  } catch (err) {
    setCanvasStatus(err.message);
  } finally {
    e.target.value = "";
  }
}

export async function renderCanvas(projectId) {
  activeProjectId = projectId;
  const project = getProject(projectId);
  const grid = document.getElementById("canvas-grid");
  const empty = document.getElementById("canvas-empty");
  if (!grid || !project) return;

  let assets = [];
  try {
    const data = await fetchProjectAssets(projectId);
    assets = data.assets || [];
    state.cachedAssets = assets;
  } catch {
    grid.innerHTML = "";
    empty?.classList.remove("hidden");
    setCanvasStatus("API offline.");
    return;
  }

  const hasAssets = assets.length > 0;
  empty?.classList.toggle("hidden", hasAssets);
  grid.classList.toggle("hidden", !hasAssets);

  if (hasAssets) {
    renderCanvasGrid(project, assets);
    if (!state.selectedAssetId && assets[0]) onSelectAsset(assets[0].id);
  } else {
    state.selectedAssetId = null;
    state.inicialAssetId = null;
    state.finalAssetId = null;
  }

  syncComposerUi();
}

function renderCanvasGrid(project, assets) {
  const grid = document.getElementById("canvas-grid");
  if (!grid) return;
  const q = document.getElementById("canvas-search")?.value?.trim().toLowerCase() || "";
  const filtered = q
    ? assets.filter((a) =>
        `${a.prompt || ""} ${a.metadata?.label || ""} ${a.source || ""}`.toLowerCase().includes(q),
      )
    : assets;
  grid.innerHTML = renderAssetsGridHtml(project, filtered, state);
  grid.querySelectorAll("[data-asset-id]").forEach((el) => {
    el.classList.toggle("frame-inicial", el.dataset.assetId === state.inicialAssetId);
    el.classList.toggle("frame-final", el.dataset.assetId === state.finalAssetId);
  });
}

async function onComposerSubmit() {
  const prompt = document.getElementById("canvas-prompt")?.value?.trim() || "";
  const count = Number(document.getElementById("canvas-count")?.value || 1);
  const selected = state.cachedAssets.find((a) => a.id === state.selectedAssetId);

  if (state.mode === "image") {
    if (!prompt) {
      setCanvasStatus("Escreve o que queres criar.");
      document.getElementById("canvas-prompt")?.focus();
      return;
    }
    await generateStudioImages(activeProjectId, { prompt, count }, canvasCallbacks());
    return;
  }

  if (state.mode === "video") {
    if (selected?.type === "image") {
      setCanvasStatus("Veo — a gerar vídeo a partir da imagem…");
      try {
        const data = await animateAsset(activeProjectId, selected.id, {
          prompt,
          lastFrameAssetId: state.finalAssetId || undefined,
        });
        await waitForJob(data.jobId, {
          jobType: "asset_video",
          onUpdate: (job) => setCanvasStatus(job.progress?.message || job.status),
        });
        await initProjects();
        await renderCanvas(activeProjectId);
        setCanvasStatus("Vídeo gerado.");
      } catch (err) {
        setCanvasStatus(err.message);
      }
      return;
    }

    if (!prompt) {
      setCanvasStatus("Escreve um prompt para o vídeo.");
      document.getElementById("canvas-prompt")?.focus();
      return;
    }

    const videoPrompt =
      selected?.type === "video"
        ? `${prompt}\n\nVariation of existing UGC clip. Preserve identity, setting and product if visible. ${selected.prompt || ""}`.trim()
        : prompt;
    await generateStudioVideo(activeProjectId, { prompt: videoPrompt }, canvasCallbacks());
    return;
  }

  if (state.mode === "ads") {
    if (!prompt) {
      setCanvasStatus("Escreve o prompt do anúncio.");
      document.getElementById("canvas-prompt")?.focus();
      return;
    }
    await startAdFromCanvas(prompt, selected);
  }
}

async function startAdFromCanvas(prompt, selected) {
  setCanvasStatus("A preparar o anúncio…");
  const brief = [
    "# Brief criativo — Direct Response Video",
    "",
    "## Produto / oferta",
    prompt,
    "",
    "## Persona & público",
    selected?.type === "image" ? "A pessoa / produto na imagem seleccionada." : "(não especificado)",
    "",
    "## Objetivo do anúncio",
    "Conversão / resposta directa",
    "",
    "## Estilo & tom",
    "- Estilo: ugc",
    "- Tom: natural",
    "",
    "---",
    selected?.type === "video"
      ? "Usar o vídeo seleccionado como referência de ritmo, persona e ambiente."
      : selected?.type === "image"
        ? "Usar a imagem seleccionada como personagem / produto no anúncio."
        : "Gerar anúncio só a partir deste prompt.",
  ].join("\n");

  try {
    await updateProject(activeProjectId, { masterPrompt: brief, startingPoint: "prompt" });
    if (selected?.type === "image") {
      await setProjectAvatar(activeProjectId, {
        assetId: selected.id,
        characterBrief: prompt.slice(0, 180),
      });
      await addProjectReference(activeProjectId, selected.id);
    }
    await initProjects();
    window.dispatchEvent(
      new CustomEvent("ecoom:seed-ad", {
        detail: { projectId: activeProjectId, prompt, assetId: selected?.id || null },
      }),
    );
    window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "create" } }));
    setCanvasStatus("Anúncio aberto — revê o brief e gera copy.");
  } catch (err) {
    setCanvasStatus(err.message);
  }
}

export function destroyCanvas() {
  state.selectedAssetId = null;
}
