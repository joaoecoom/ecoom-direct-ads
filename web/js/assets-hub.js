import { assetFileUrl, fetchProjectAssets, generateAssetVariations, uploadAsset } from "./api.js";
import { getProject, initProjects } from "./projects.js";
import { getStartingPoint } from "./starting-point.js";
import { waitForJob } from "./job-activity.js";

let activeProjectId = null;
let selectedAssetId = null;
let pendingAction = null;

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

  panel.addEventListener("click", (e) => {
    const assetBtn = e.target.closest("[data-asset-id]");
    if (assetBtn) {
      selectedAssetId = assetBtn.dataset.assetId;
      panel.querySelectorAll("[data-asset-id]").forEach((el) => {
        el.classList.toggle("selected", el.dataset.assetId === selectedAssetId);
      });
      renderAssetActions(getProject(activeProjectId), selectedAssetId);
      return;
    }

    const action = e.target.closest("[data-asset-action]");
    if (action) void handleAssetAction(action.dataset.assetAction);
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
    kind === "image" ? "Prompt para gerar imagem:" : "Prompt para gerar vídeo (Veo):",
    defaultText,
  );
  if (!prompt?.trim()) return;

  setAssetsStatus(
    kind === "image"
      ? "Geração de imagem — usa tab Images → Generate All Images ou Create Ad."
      : "Geração de vídeo — usa tab Videos após teres imagens, ou Create Ad → Gerar Vídeo Completo.",
  );
  showAssetsNotice(
    `Prompt guardado. Próximo passo: ${kind === "image" ? "tab Images" : "tab Create Ad / Videos"} para correr a pipeline Ecoom.`,
  );
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
      : `Workspace criado via «${sp.titlePt}» — adiciona ou gera assets.`,
  );

  let assets = [];
  try {
    const data = await fetchProjectAssets(projectId);
    assets = data.assets || [];
  } catch {
    grid.innerHTML = `<div class="empty-state card"><p class="muted">API offline — assets indisponíveis.</p></div>`;
    return;
  }

  const images = assets.filter((a) => a.type === "image");
  const videos = assets.filter((a) => a.type === "video");

  if (!assets.length) {
    grid.innerHTML = `
      <div class="assets-empty card">
        <p class="eyebrow">Project Assets</p>
        <h3>Sem assets ainda</h3>
        <p class="muted">Faz upload ou gera conteúdo — tudo converge para blueprint → cenas → timeline.</p>
        <p class="muted">Usa os botões <strong>+ Imagem</strong> ou <strong>+ Vídeo</strong> acima.</p>
      </div>`;
    renderAssetActions(project, null);
    return;
  }

  grid.innerHTML = `
    ${renderAssetGroup("Imagens", images)}
    ${renderAssetGroup("Vídeos", videos)}
  `;

  if (!selectedAssetId && assets[0]) selectedAssetId = assets[0].id;
  renderAssetActions(project, selectedAssetId);
}

function renderAssetGroup(title, items) {
  if (!items.length) return "";
  return `
    <section class="assets-group">
      <h3 class="assets-group-title">${title}</h3>
      <div class="assets-group-grid">
        ${items
          .map(
            (a) => `
          <button type="button" class="asset-card card ${selectedAssetId === a.id ? "selected" : ""}" data-asset-id="${a.id}">
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

function renderAssetActions(project, assetId) {
  const panel = document.getElementById("asset-actions-panel");
  if (!panel) return;

  if (!assetId) {
    panel.innerHTML = `<p class="muted">Selecciona um asset para ver acções.</p>`;
    return;
  }

  const assets = project?.assetIds || [];
  panel.innerHTML = `
    <p class="eyebrow">A partir deste asset</p>
    <div class="asset-actions-grid">
      <button type="button" class="btn sm" data-asset-action="use-reference">Usar como referência</button>
      <button type="button" class="btn sm" data-asset-action="use-character">Usar como personagem</button>
      <button type="button" class="btn sm" data-asset-action="variations">Gerar variações</button>
      <button type="button" class="btn sm" data-asset-action="animate">Animar</button>
      <button type="button" class="btn sm" data-asset-action="build-ad">Build Ad</button>
      <button type="button" class="btn primary sm" data-asset-action="create-from">Create from this</button>
    </div>
    <p class="muted asset-actions-note">Variações UGC activas. Vídeo analyze / face swap — fase seguinte.</p>`;
}

async function handleAssetAction(action) {
  if (!activeProjectId || !selectedAssetId) return;

  switch (action) {
    case "use-reference":
    case "use-character":
      showAssetsNotice("Referência/personagem — usa tab Images → + Referência (já ligado ao pipeline).");
      window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "images" } }));
      break;
    case "variations": {
      const countStr = window.prompt("Quantas variações? (1–12)", "5");
      const count = Math.min(12, Math.max(1, Number.parseInt(countStr || "5", 10) || 5));
      const prompt = window.prompt(
        "Prompt para as variações (opcional):",
        "Same person in different natural UGC environments and situations, preserve identity",
      );
      setAssetsStatus(`A gerar ${count} variações...`);
      try {
        const data = await generateAssetVariations(activeProjectId, selectedAssetId, {
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
            setAssetsStatus(`Variações${scene}: ${job.progress?.message || job.status}`);
          },
        });
        await initProjects();
        await renderAssetsHub(activeProjectId);
        setAssetsStatus(`${count} variações concluídas — selecciona e anima ou Build Ad.`);
      } catch (err) {
        showAssetsNotice(err.message);
      }
      break;
    }
    case "animate":
      window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "videos" } }));
      break;
    case "build-ad":
    case "create-from":
      window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "create" } }));
      break;
    default:
      break;
  }
}

async function uploadFiles(files, { asVideo = false } = {}) {
  for (const file of files) {
    const data = await fileToBase64(file);
    await uploadAsset(activeProjectId, {
      data,
      filename: file.name,
      mimeType: file.type,
      role: asVideo ? "video" : undefined,
      label: file.name,
    });
  }
}

async function onUploadAssets(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  setAssetsStatus(`A enviar ${files.length} ficheiro(s)...`);
  try {
    await uploadFiles(files);
    await initProjects();
    await renderAssetsHub(activeProjectId);
    setAssetsStatus("Upload concluído — selecciona um asset para continuar.");
  } catch (err) {
    showAssetsNotice(err.message);
  } finally {
    e.target.value = "";
  }
}

async function onUploadVideo(e) {
  const files = e.target.files;
  if (!files?.length || !activeProjectId) return;
  setAssetsStatus(`A enviar vídeo...`);
  try {
    await uploadFiles(files, { asVideo: true });
    await initProjects();
    await renderAssetsHub(activeProjectId);
    setAssetsStatus("Vídeo importado — analisar e variar em fase seguinte.");
  } catch (err) {
    showAssetsNotice(err.message);
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function destroyAssetsHub() {
  selectedAssetId = null;
  pendingAction = null;
}
