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
import { fetchHealth, fetchProjectStoryboard } from "./api.js";

const views = {
  projects: document.getElementById("view-projects"),
  project: document.getElementById("view-project"),
  library: document.getElementById("view-library"),
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
const apiStatusEl = document.getElementById("api-status");

let currentProjectId = null;
let createAdInitialized = false;

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

function renderProjectsGrid() {
  if (!projectListEl) return;
  const projects = listProjects();

  if (projects.length === 0) {
    projectListEl.innerHTML = `
      <div class="empty-state card">
        <h2>Começa o teu primeiro projecto</h2>
        <p class="muted">Descreve o anúncio. O Ecoom constrói-o.</p>
        <button type="button" class="btn primary" data-action="new-project">+ New Project</button>
      </div>`;
    return;
  }

  projectListEl.innerHTML = `
    <div class="projects-grid">
      ${projects
        .map(
          (p) => `
        <article class="project-card card" data-open-project="${p.id}">
          <div class="project-card-head">
            <h3>${escapeHtml(p.name)}</h3>
            <div class="project-actions">
              <button type="button" title="Duplicar" data-duplicate="${p.id}">⎘</button>
              <button type="button" title="Eliminar" data-delete="${p.id}">×</button>
            </div>
          </div>
          <p class="muted project-preview">${escapeHtml(p.masterPrompt || "Sem prompt ainda")}</p>
          <div class="project-meta">
            <span>${p.jobIds?.length || 0} gerações</span>
            <span>${formatDate(p.updatedAt)}</span>
          </div>
        </article>`,
        )
        .join("")}
    </div>`;
}

function renderProjectWorkspace(id) {
  const project = getProject(id);
  if (!project) return;

  document.getElementById("project-title").textContent = project.name;
  document.getElementById("project-subtitle").textContent =
    project.masterPrompt?.slice(0, 120) || "Define o Master Creative Prompt abaixo";

  if (!createAdInitialized) {
    initCreateAd(id);
    createAdInitialized = true;
  } else {
    refreshCreateAdForm(id);
  }

  renderProjectTabs(id);
  void renderBlueprint(id);
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

  tabsEl.innerHTML = `
    <button type="button" class="tab active" data-tab="create">Create Ad</button>
    <button type="button" class="tab disabled" title="Fase 3">Images</button>
    <button type="button" class="tab disabled" title="Fase 4">Videos</button>
    <button type="button" class="tab disabled" title="Fase 5">Timeline</button>
    <button type="button" class="tab disabled" title="Fase 7">Export</button>
    <span class="tab-meta">${jobs} job(s)</span>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function openNewProjectModal() {
  modal?.classList.remove("hidden");
  newProjectName?.focus();
}

function closeNewProjectModal() {
  modal?.classList.add("hidden");
  newProjectForm?.reset();
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
document.getElementById("sidebar-new-project")?.addEventListener("click", openNewProjectModal);
document.getElementById("modal-cancel")?.addEventListener("click", closeNewProjectModal);
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeNewProjectModal();
});

newProjectForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const project = await createProject(
    newProjectName.value,
    newProjectPrompt?.value || "",
  );
  closeNewProjectModal();
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

document.body.addEventListener("click", async (e) => {
  const openId = e.target.closest("[data-open-project]")?.dataset.openProject;
  if (openId) {
    navigate("project", openId);
    return;
  }

  if (e.target.closest('[data-action="new-project"]')) {
    openNewProjectModal();
    return;
  }

  const dupId = e.target.closest("[data-duplicate]")?.dataset.duplicate;
  if (dupId) {
    const copy = await duplicateProject(dupId);
    if (copy) navigate("project", copy.id);
    return;
  }

  const delId = e.target.closest("[data-delete]")?.dataset.delete;
  if (delId) {
    if (confirm("Eliminar este projecto?")) {
      await deleteProject(delId);
      if (currentProjectId === delId) navigate("projects");
      else renderRoute();
    }
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

window.addEventListener("ecoom:job-complete", async (e) => {
  await initProjects();
  if (currentProjectId && e.detail?.projectId === currentProjectId) {
    renderProjectWorkspace(currentProjectId);
    renderSidebarProjects();
  }
});

window.addEventListener("beforeunload", () => destroyCreateAd());
