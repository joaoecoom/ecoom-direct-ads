import { addProjectReference, animateAsset, assetFileUrl, fetchProjectAssets, setProjectAvatar } from "./api.js";
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
  refs: [],
  pendingRefRole: "other",
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

  document.getElementById("canvas-attach-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("canvas-ref-menu")?.classList.toggle("hidden");
  });

  document.getElementById("canvas-ref-menu")?.addEventListener("click", (e) => {
    const roleBtn = e.target.closest("[data-ref-role]");
    if (!roleBtn) return;
    state.pendingRefRole = roleBtn.dataset.refRole;
    const selected = state.cachedAssets.find((a) => a.id === state.selectedAssetId);
    if (selected?.type === "image") {
      addRef(selected.id, state.pendingRefRole);
      document.getElementById("canvas-ref-menu")?.classList.add("hidden");
      setCanvasStatus(`${roleLabel(state.pendingRefRole)} ligada — ou faz upload de outra.`);
      return;
    }
    document.getElementById("canvas-ref-upload")?.click();
  });

  document.getElementById("canvas-ref-upload")?.addEventListener("change", onRefUpload);

  document.getElementById("canvas-refs")?.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove-ref]");
    if (remove) {
      state.refs = state.refs.filter((r) => r.assetId !== remove.dataset.removeRef);
      renderRefChips();
    }
  });

  document.addEventListener("click", (e) => {
    const menu = document.getElementById("canvas-ref-menu");
    if (!menu || menu.classList.contains("hidden")) return;
    if (e.target.closest(".canvas-attach-wrap")) return;
    menu.classList.add("hidden");
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

function roleLabel(role) {
  return (
    {
      face: "Cara",
      product: "Embalagem",
      clothing: "Roupa",
      other: "Ref",
    }[role] || "Ref"
  );
}

function addRef(assetId, role) {
  if (!assetId) return;
  state.refs = state.refs.filter((r) => r.assetId !== assetId);
  state.refs.push({ assetId, role: role || "other" });
  renderRefChips();
}

function renderRefChips() {
  const el = document.getElementById("canvas-refs");
  if (!el) return;
  if (!state.refs.length) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = state.refs
    .map((r) => {
      const asset = state.cachedAssets.find((a) => a.id === r.assetId);
      const src = asset ? `${assetFileUrl(asset.id)}?t=1` : "";
      return `
        <span class="canvas-ref-chip" title="${roleLabel(r.role)}">
          ${src ? `<img src="${src}" alt="" />` : ""}
          <em>${roleLabel(r.role)}</em>
          <button type="button" data-remove-ref="${r.assetId}" aria-label="Remover">×</button>
        </span>`;
    })
    .join("");
}

async function onRefUpload(e) {
  const file = e.target.files?.[0];
  if (!file || !activeProjectId) return;
  setCanvasStatus("A adicionar referência…");
  try {
    await uploadFilesToProject(activeProjectId, [file], { asReference: true });
    await initProjects();
    await renderCanvas(activeProjectId);
    const latestImage = state.cachedAssets.find((a) => a.type === "image");
    if (latestImage) addRef(latestImage.id, state.pendingRefRole);
    document.getElementById("canvas-ref-menu")?.classList.add("hidden");
    setCanvasStatus(`${roleLabel(state.pendingRefRole)} adicionada ao prompt.`);
  } catch (err) {
    setCanvasStatus(err.message);
  } finally {
    e.target.value = "";
  }
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
    if (state.refs.length) {
      modeLabel.textContent += ` · ${state.refs.length} ref(s)`;
    }
  }
  renderRefChips();
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
    await generateStudioImages(
      activeProjectId,
      { prompt, count, references: state.refs },
      canvasCallbacks(),
    );
    return;
  }

  if (state.mode === "video") {
    if (selected?.type === "image") {
      setCanvasStatus("Veo — a gerar vídeo a partir da imagem…");
      try {
        const data = await animateAsset(activeProjectId, selected.id, {
          prompt,
          lastFrameAssetId: state.finalAssetId || undefined,
          references: state.refs,
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
    await generateStudioVideo(
      activeProjectId,
      { prompt: videoPrompt, references: state.refs },
      canvasCallbacks(),
    );
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
    state.refs.length
      ? `\nReferências visuais: ${state.refs.map((r) => roleLabel(r.role)).join(", ")} (cara, embalagem, roupa).`
      : "",
  ].join("\n");

  try {
    await updateProject(activeProjectId, { masterPrompt: brief, startingPoint: "prompt" });
    const face = state.refs.find((r) => r.role === "face");
    const characterId = face?.assetId || (selected?.type === "image" ? selected.id : null);
    if (characterId) {
      await setProjectAvatar(activeProjectId, {
        assetId: characterId,
        characterBrief: prompt.slice(0, 180),
      });
    }
    const refIds = [
      ...state.refs.map((r) => r.assetId),
      selected?.type === "image" ? selected.id : null,
    ].filter(Boolean);
    for (const id of [...new Set(refIds)]) {
      await addProjectReference(activeProjectId, id);
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
  state.refs = [];
}
