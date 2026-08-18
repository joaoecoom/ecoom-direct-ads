import {
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  initProjects,
  isApiEnabled,
  listProjects,
  updateProject,
} from "./projects.js";
import { destroyCreateAd, initCreateAd, refreshCreateAdForm } from "./create-ad.js";
import { destroyImagesTab, initImagesTab, renderImagesPanel } from "./images.js";
import { destroyVideosTab, initVideosTab, renderVideosPanel } from "./videos.js";
import { destroyTimelineTab, initTimelineTab, renderTimelinePanel } from "./timeline.js";
import { destroyExportTab, initExportTab, renderExportPanel } from "./export.js";
import { initCreativesRail, renderCreativesRail } from "./creatives.js";
import { destroyAssetsHub, initAssetsHub, renderAssetsHub } from "./assets-hub.js";
import { renderCharactersView } from "./characters.js";
import {
  getEntryRoute,
  getStartingPoint,
  renderStartingPointCards,
  STARTING_POINTS,
} from "./starting-point.js";
import { createCreative, assetFileUrl, fetchHealth, fetchProjectAssets, fetchProjectStoryboard } from "./api.js";

const views = {
  projects: document.getElementById("view-projects"),
  project: document.getElementById("view-project"),
  library: document.getElementById("view-library"),
  characters: document.getElementById("view-characters"),
  templates: document.getElementById("view-templates"),
  settings: document.getElementById("view-settings"),
  account: document.getElementById("view-account"),
};

const projectListEl = document.getElementById("project-list");
const sidebarProjectsEl = document.getElementById("sidebar-projects");
const modal = document.getElementById("new-project-modal");
const newProjectForm = document.getElementById("new-project-form");
const newProjectName = document.getElementById("new-project-name");
const newProjectPrompt = document.getElementById("new-project-prompt");
const spStepPick = document.getElementById("new-project-step-pick");
const spStepDetails = document.getElementById("new-project-step-details");
const startingPointGrid = document.getElementById("starting-point-grid");
const apiStatusEl = document.getElementById("api-status");

let selectedStartingPoint = "upload";
let forceEntryTab = null;
let assetsTabInitialized = false;
let assetsTabProjectId = null;

let currentProjectId = null;
let createAdInitialized = false;
let imagesTabInitialized = false;
let imagesTabProjectId = null;
let videosTabInitialized = false;
let videosTabProjectId = null;
let timelineTabInitialized = false;
let timelineTabProjectId = null;
let exportTabInitialized = false;
let exportTabProjectId = null;
let activeWorkspaceTab = "images";
const entryRoutedProjects = new Set();

function parseRoute() {
  const hash = location.hash.replace(/^#/, "") || "/projects";
  const parts = hash.split("/").filter(Boolean);
  return { path: parts[0] || "projects", id: parts[1] || null };
}

function navigate(path, id = null) {
  const hash = id ? `#/${path}/${id}` : `#/${path}`;
  if (location.hash !== hash) location.hash = hash;
  else renderRoute();
}

function hideAllViews() {
  Object.values(views).forEach((v) => v?.classList.add("hidden"));
}

function setNavActive(route) {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === route);
  });
}

function renderRoute() {
  const { path, id } = parseRoute();
  hideAllViews();
  setNavActive(path);

  switch (path) {
    case "project":
      if (id && getProject(id)) {
        currentProjectId = id;
        views.project?.classList.remove("hidden");
        renderProjectWorkspace(id);
      } else {
        navigate("projects");
      }
      break;
    case "library":
      views.library?.classList.remove("hidden");
      void renderLibrary();
      break;
    case "characters":
      views.characters?.classList.remove("hidden");
      void renderCharactersView();
      break;
    case "templates":
      views.templates?.classList.remove("hidden");
      break;
    case "settings":
      views.settings?.classList.remove("hidden");
      break;
    case "account":
      views.account?.classList.remove("hidden");
      break;
    default:
      currentProjectId = null;
      views.projects?.classList.remove("hidden");
      renderProjectsGrid();
      break;
  }

  renderSidebarProjects();
}

function renderSidebarProjects() {
  if (!sidebarProjectsEl) return;
  const projects = listProjects().slice(0, 8);
  sidebarProjectsEl.innerHTML = projects
    .map(
      (p) => `
    <button type="button" class="sidebar-item ${currentProjectId === p.id ? "active" : ""}" data-open-project="${p.id}">
      <span class="sidebar-item-dot"></span>
      ${escapeHtml(p.name)}
    </button>`,
    )
    .join("");
}

function getProjectThumb(project) {
  const scene = project.scenes?.find((s) => s.imageAssetId);
  if (scene?.imageAssetId) return assetFileUrl(scene.imageAssetId);
  if (project.latestExport?.assetId) return assetFileUrl(project.latestExport.assetId);
  return null;
}

function renderProjectsGrid() {
  if (!projectListEl) return;
  const projects = listProjects();

  if (projects.length === 0) {
    projectListEl.innerHTML = `
      <div class="flow-empty">
        <div class="flow-empty-icon">✿</div>
        <h2>Começa a criar</h2>
        <p class="muted">Adiciona o teu primeiro projecto Direct Response.</p>
        <button type="button" class="flow-project-new solo" data-action="new-project">
          <span>+ Novo projeto</span>
        </button>
      </div>`;
    return;
  }

  projectListEl.innerHTML = `
    <div class="projects-flow-grid">
      ${projects
        .map((p) => {
          const thumb = getProjectThumb(p);
          return `
        <article class="flow-project-card" data-open-project="${p.id}">
          <div class="flow-project-thumb">
            ${
              thumb
                ? `<img src="${thumb}" alt="" loading="lazy" />`
                : `<div class="flow-project-placeholder"><span>${escapeHtml(p.name.slice(0, 1).toUpperCase())}</span></div>`
            }
          </div>
          <div class="flow-project-footer">
            <div class="flow-project-info">
              <strong class="flow-project-name">${escapeHtml(p.name)}</strong>
              <span class="flow-project-date">${formatFlowDate(p.updatedAt)}</span>
            </div>
            <div class="flow-project-actions">
              <button type="button" title="Renomear" data-rename="${p.id}" aria-label="Renomear">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button type="button" title="Eliminar" data-delete="${p.id}" aria-label="Eliminar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>
          </div>
        </article>`;
        })
        .join("")}
      <button type="button" class="flow-project-new" data-action="new-project">
        <span>+ Novo projeto</span>
      </button>
    </div>`;
}

function renderProjectWorkspace(id) {
  const project = getProject(id);
  if (!project) return;

  document.getElementById("project-title").textContent = project.name;
  document.getElementById("project-subtitle").textContent =
    project.masterPrompt?.slice(0, 120) ||
    (project.startingPoint && project.startingPoint !== "prompt"
      ? `Studio · ${getStartingPoint(project.startingPoint).titlePt}`
      : "Upload, gera imagens (Nano Banana) ou vídeos (Veo) — o anúncio é opcional.");

  if (imagesTabProjectId !== id) {
    imagesTabInitialized = false;
    imagesTabProjectId = id;
  }
  if (videosTabProjectId !== id) {
    videosTabInitialized = false;
    videosTabProjectId = id;
  }
  if (timelineTabProjectId !== id) {
    timelineTabInitialized = false;
    timelineTabProjectId = id;
  }
  if (exportTabProjectId !== id) {
    exportTabInitialized = false;
    exportTabProjectId = id;
  }
  if (assetsTabProjectId !== id) {
    assetsTabInitialized = false;
    assetsTabProjectId = id;
  }

  if (!createAdInitialized) {
    initCreateAd(id);
    createAdInitialized = true;
  } else {
    refreshCreateAdForm(id);
  }

  renderProjectTabs(id);
  initCreativesRail(id);

  const route = getEntryRoute(project.startingPoint || "upload");
  if (!entryRoutedProjects.has(id)) {
    entryRoutedProjects.add(id);
    if (forceEntryTab) {
      activeWorkspaceTab = forceEntryTab;
      forceEntryTab = null;
    } else {
      activeWorkspaceTab = route.tab === "create" ? "images" : route.tab;
    }
    if (route.action) {
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("ecoom:starting-point", {
            detail: {
              projectId: id,
              startingPoint: project.startingPoint || "upload",
              action: route.action,
              tab: activeWorkspaceTab,
            },
          }),
        );
      });
    }
  }

  switchWorkspaceTab(activeWorkspaceTab);
  void renderBlueprint(id);
  renderProjectCreateMenu(id);
}

function switchWorkspaceTab(tab) {
  activeWorkspaceTab = tab;
  document.querySelectorAll(".workspace-panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`panel-${tab}`)?.classList.remove("hidden");

  document.querySelectorAll("#workspace-tabs .tab[data-tab]").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });

  if (tab === "assets" && currentProjectId) {
    if (!assetsTabInitialized) {
      initAssetsHub(currentProjectId);
      assetsTabInitialized = true;
    } else {
      void renderAssetsHub(currentProjectId);
    }
  }

  if (tab === "images" && currentProjectId) {
    if (!imagesTabInitialized) {
      initImagesTab(currentProjectId);
      imagesTabInitialized = true;
    } else {
      void renderImagesPanel(currentProjectId);
    }
  }

  if (tab === "videos" && currentProjectId) {
    if (!videosTabInitialized) {
      initVideosTab(currentProjectId);
      videosTabInitialized = true;
    } else {
      void renderVideosPanel(currentProjectId);
    }
  }

  if (tab === "timeline" && currentProjectId) {
    if (!timelineTabInitialized) {
      initTimelineTab(currentProjectId);
      timelineTabInitialized = true;
    } else {
      void renderTimelinePanel(currentProjectId);
    }
  }

  if (tab === "export" && currentProjectId) {
    if (!exportTabInitialized) {
      initExportTab(currentProjectId);
      exportTabInitialized = true;
    } else {
      void renderExportPanel(currentProjectId);
    }
  }
}

async function renderLibrary() {
  const grid = document.getElementById("library-grid");
  if (!grid) return;

  const projects = listProjects();
  if (!projects.length) {
    grid.innerHTML = `<div class="placeholder card"><p>Sem assets ainda.</p></div>`;
    return;
  }

  const allAssets = [];
  for (const p of projects.slice(0, 10)) {
    try {
      const { assets } = await fetchProjectAssets(p.id);
      for (const a of assets || []) {
        allAssets.push({ ...a, projectName: p.name });
      }
    } catch {
      /* skip */
    }
  }

  if (!allAssets.length) {
    grid.innerHTML = `<div class="placeholder card"><p>Gera imagens num projecto para ver assets aqui.</p></div>`;
    return;
  }

  grid.innerHTML = allAssets
    .slice(0, 24)
    .map(
      (a) => `
    <article class="scene-card card">
      <div class="scene-card-head"><strong>${escapeHtml(a.projectName)}</strong></div>
      <div class="scene-thumb">
        <img src="${assetFileUrl(a.id)}" alt="" loading="lazy" />
      </div>
      <p class="scene-prompt muted">${escapeHtml(a.sceneId || a.source)} · ${escapeHtml(a.source)}</p>
    </article>`,
    )
    .join("");
}

async function renderBlueprint(projectId) {
  const panel = document.getElementById("blueprint-panel");
  if (!panel) return;

  const project = getProject(projectId);
  if (!project?.latestCreative?.title && !project?.jobIds?.length) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  const meta = project.latestCreative;
  document.getElementById("blueprint-title").textContent =
    meta?.title || "Creative Blueprint";
  document.getElementById("blueprint-meta").textContent = meta?.jobId
    ? `Job ${meta.jobId} · ${meta.status || "linked"}`
    : `${project.jobIds.length} geração(ões)`;

  const scenesEl = document.getElementById("blueprint-scenes");
  scenesEl.innerHTML = `<p class="muted">A carregar storyboard...</p>`;

  if (!isApiEnabled()) {
    scenesEl.innerHTML = `<p class="muted">Storyboard disponível após geração (API offline).</p>`;
    return;
  }

  try {
    const storyboard = await fetchProjectStoryboard(projectId);
    if (!storyboard?.scenes) {
      scenesEl.innerHTML = `<p class="muted">Gera o primeiro creative para ver o blueprint.</p>`;
      return;
    }
    scenesEl.innerHTML = storyboard.scenes
      .map(
        (s, i) => `
      <div class="blueprint-scene">
        <strong>Scene ${String(i + 1).padStart(2, "0")}</strong>
        <p>${escapeHtml(s.voiceoverLine || s.visualBeat || "")}</p>
      </div>`,
      )
      .join("");
  } catch {
    scenesEl.innerHTML = `<p class="muted">Blueprint após concluir geração.</p>`;
  }
}

function renderProjectTabs(id) {
  const tabsEl = document.getElementById("workspace-tabs");
  const project = getProject(id);
  const jobs = project?.jobIds?.length || 0;
  const videoCount = project?.creatives?.length || 0;
  const activeTitle = project?.activeCreative?.title || project?.blueprint?.title || "—";

  const videosReady = (project?.scenes || []).filter((s) => s.videoAssetId).length;

  const exportReady = project?.latestExport?.assetId ? 1 : 0;

  tabsEl.innerHTML = `
    <button type="button" class="tab" data-tab="images">Images</button>
    <button type="button" class="tab" data-tab="videos">Videos</button>
    <button type="button" class="tab" data-tab="assets">Assets</button>
    <button type="button" class="tab" data-tab="create">Ads</button>
    <button type="button" class="tab" data-tab="timeline">Timeline</button>
    <button type="button" class="tab" data-tab="export">Export${exportReady ? " ✓" : ""}</button>
    <span class="tab-meta">${videoCount} vídeo(s) · ${escapeHtml(activeTitle)} · ${videosReady} clips</span>`;

  tabsEl.querySelectorAll(".tab[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === activeWorkspaceTab);
    btn.onclick = () => switchWorkspaceTab(btn.dataset.tab);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFlowDate(iso) {
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}, ${hours}:${mins}`;
  } catch {
    return "";
  }
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("pt-PT", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

function renderProjectCreateMenu(projectId) {
  const dropdown = document.getElementById("project-create-dropdown");
  if (!dropdown) return;

  dropdown.innerHTML = STARTING_POINTS.map(
    (sp) => `
    <button type="button" class="project-create-item" data-inproject-sp="${sp.id}">
      <span>${sp.icon}</span>
      <span>${sp.titlePt}</span>
    </button>`,
  ).join("");

  dropdown.querySelectorAll("[data-inproject-sp]").forEach((btn) => {
    btn.onclick = () => {
      dropdown.classList.add("hidden");
      void handleInProjectStartingPoint(btn.dataset.inprojectSp);
    };
  });
}

async function handleInProjectStartingPoint(startingPoint) {
  if (!currentProjectId) return;
  const route = getEntryRoute(startingPoint);
  await updateProject(currentProjectId, { startingPoint });
  activeWorkspaceTab = route.tab;
  switchWorkspaceTab(route.tab);
  window.dispatchEvent(
    new CustomEvent("ecoom:starting-point", {
      detail: {
        projectId: currentProjectId,
        startingPoint,
        action: route.action,
        tab: route.tab,
      },
    }),
  );
}

function openNewProjectModal() {
  selectedStartingPoint = "upload";
  renderStartingPointPicker();
  spStepPick?.classList.remove("hidden");
  spStepDetails?.classList.add("hidden");
  modal?.classList.remove("hidden");
}

function renderStartingPointPicker() {
  if (!startingPointGrid) return;
  startingPointGrid.innerHTML = renderStartingPointCards(selectedStartingPoint);
  startingPointGrid.querySelectorAll("[data-sp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedStartingPoint = btn.dataset.sp;
      renderStartingPointPicker();
      showNewProjectDetailsStep();
    });
  });
}

function showNewProjectDetailsStep() {
  const sp = getStartingPoint(selectedStartingPoint);
  spStepPick?.classList.add("hidden");
  spStepDetails?.classList.remove("hidden");

  document.getElementById("sp-selected-label").textContent = sp.titlePt;
  document.getElementById("sp-details-title").textContent = "Nome do projecto";

  const promptField = document.getElementById("sp-prompt-field");
  const promptLabel = document.getElementById("sp-prompt-label");
  const promptInput = newProjectPrompt;

  const needsPrompt = ["prompt", "generate_image", "generate_video"].includes(selectedStartingPoint);
  promptField?.classList.toggle("hidden", !needsPrompt);

  if (selectedStartingPoint === "prompt") {
    promptLabel.textContent = "Master Prompt";
    promptInput.placeholder = "Cria um anúncio UGC de 60 segundos para...";
  } else if (selectedStartingPoint === "generate_image") {
    promptLabel.textContent = "Prompt da imagem (opcional)";
    promptInput.placeholder = "Mulher portuguesa de 45 anos numa cozinha moderna...";
  } else if (selectedStartingPoint === "generate_video") {
    promptLabel.textContent = "Prompt do vídeo (opcional)";
    promptInput.placeholder = "Pessoa a falar para câmara, estilo UGC...";
  }

  newProjectName?.focus();
}

function closeNewProjectModal() {
  modal?.classList.add("hidden");
  newProjectForm?.reset();
  spStepPick?.classList.remove("hidden");
  spStepDetails?.classList.add("hidden");
  selectedStartingPoint = "upload";
}

async function checkApiStatus() {
  if (!apiStatusEl) return;
  try {
    await fetchHealth();
    apiStatusEl.textContent = "API online";
    apiStatusEl.className = "api-status online";
  } catch {
    apiStatusEl.textContent = "API offline";
    apiStatusEl.className = "api-status offline";
  }
}

document.getElementById("btn-new-project")?.addEventListener("click", openNewProjectModal);
document.getElementById("goto-images-tab")?.addEventListener("click", () => {
  if (currentProjectId) switchWorkspaceTab("images");
});
document.getElementById("sidebar-new-project")?.addEventListener("click", openNewProjectModal);
document.getElementById("modal-cancel")?.addEventListener("click", closeNewProjectModal);
document.getElementById("modal-cancel-2")?.addEventListener("click", closeNewProjectModal);
document.getElementById("sp-back")?.addEventListener("click", () => {
  spStepDetails?.classList.add("hidden");
  spStepPick?.classList.remove("hidden");
  renderStartingPointPicker();
});
document.getElementById("btn-project-create")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById("project-create-dropdown");
  dropdown?.classList.toggle("hidden");
});
document.addEventListener("click", () => {
  document.getElementById("project-create-dropdown")?.classList.add("hidden");
});
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeNewProjectModal();
});

newProjectForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const promptText = newProjectPrompt?.value?.trim() || "";
  const isPromptMode = selectedStartingPoint === "prompt";
  const project = await createProject(newProjectName.value, isPromptMode ? promptText : "", {
    startingPoint: selectedStartingPoint,
    entryPrompt: isPromptMode ? "" : promptText,
  });

  if (isApiEnabled() && selectedStartingPoint !== "prompt") {
    try {
      await createCreative(project.id, { title: "Creative 1" });
      await initProjects();
    } catch {
      /* creative optional on first load */
    }
  }

  closeNewProjectModal();
  forceEntryTab = getEntryRoute(selectedStartingPoint).tab;
  activeWorkspaceTab = forceEntryTab;
  navigate("project", project.id);
});

document.querySelectorAll("[data-nav]").forEach((el) => {
  el.addEventListener("click", () => {
    navigate(el.dataset.nav);
  });
});

document.getElementById("btn-rename-project")?.addEventListener("click", async () => {
  if (!currentProjectId) return;
  const project = getProject(currentProjectId);
  const name = prompt("Nome do projecto:", project?.name);
  if (name?.trim()) {
    await updateProject(currentProjectId, { name: name.trim() });
    renderProjectWorkspace(currentProjectId);
    renderSidebarProjects();
  }
});

document.getElementById("btn-back-projects")?.addEventListener("click", () => {
  navigate("projects");
});

document.getElementById("btn-delete-project")?.addEventListener("click", async () => {
  if (!currentProjectId) return;
  await confirmDeleteProject(currentProjectId);
});

async function confirmDeleteProject(id) {
  const project = getProject(id);
  const name = project?.name || "este projecto";
  if (!confirm(`Eliminar "${name}"?\n\nEsta acção não pode ser desfeita.`)) return false;
  await deleteProject(id);
  if (currentProjectId === id) {
    currentProjectId = null;
    navigate("projects");
  } else {
    renderRoute();
  }
  return true;
}

document.body.addEventListener("click", async (e) => {
  const delId = e.target.closest("[data-delete]")?.dataset.delete;
  if (delId) {
    e.preventDefault();
    e.stopPropagation();
    await confirmDeleteProject(delId);
    return;
  }

  const dupId = e.target.closest("[data-duplicate]")?.dataset.duplicate;
  if (dupId) {
    e.preventDefault();
    e.stopPropagation();
    const copy = await duplicateProject(dupId);
    if (copy) navigate("project", copy.id);
    return;
  }

  const renameId = e.target.closest("[data-rename]")?.dataset.rename;
  if (renameId) {
    e.preventDefault();
    e.stopPropagation();
    const project = getProject(renameId);
    const name = prompt("Nome do projecto:", project?.name);
    if (name?.trim()) {
      await updateProject(renameId, { name: name.trim() });
      renderRoute();
    }
    return;
  }

  const openId = e.target.closest("[data-open-project]")?.dataset.openProject;
  if (openId) {
    navigate("project", openId);
    return;
  }

  if (e.target.closest('[data-action="new-project"]')) {
    openNewProjectModal();
  }
});

window.addEventListener("hashchange", renderRoute);

async function boot() {
  await initProjects();
  renderRoute();
  checkApiStatus();
}

boot();
setInterval(checkApiStatus, 60000);

window.addEventListener("ecoom:project-synced", (e) => {
  const id = e.detail?.projectId;
  if (id) {
    currentProjectId = id;
    navigate("project", id);
  }
});

window.addEventListener("ecoom:switch-tab", (e) => {
  const tab = e.detail?.tab;
  if (tab && currentProjectId) switchWorkspaceTab(tab);
});

window.addEventListener("ecoom:export-ready", async (e) => {
  await initProjects();
  const id = e.detail?.projectId;
  if (id && currentProjectId === id) {
    renderProjectWorkspace(id);
    switchWorkspaceTab("export");
    window.dispatchEvent(new CustomEvent("ecoom:refresh-export"));
  }
});

window.addEventListener("ecoom:creative-changed", async (e) => {
  await initProjects();
  if (currentProjectId && e.detail?.projectId === currentProjectId) {
    renderProjectWorkspace(currentProjectId);
    renderSidebarProjects();
  }
});

window.addEventListener("ecoom:job-complete", async (e) => {
  await initProjects();
  if (currentProjectId && e.detail?.projectId === currentProjectId) {
    renderProjectWorkspace(currentProjectId);
    renderSidebarProjects();
    void renderCreativesRail(currentProjectId);
    if (activeWorkspaceTab === "images") {
      void renderImagesPanel(currentProjectId);
    }
    if (activeWorkspaceTab === "videos") {
      void renderVideosPanel(currentProjectId);
    }
    if (activeWorkspaceTab === "timeline") {
      void renderTimelinePanel(currentProjectId);
    }
    if (activeWorkspaceTab === "export") {
      void renderExportPanel(currentProjectId);
    }
  }
});

window.addEventListener("beforeunload", () => {
  destroyCreateAd();
  destroyImagesTab();
  destroyVideosTab();
  destroyTimelineTab();
  destroyExportTab();
});
