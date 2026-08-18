import {
  activateCreative,
  assetFileUrl,
  createCreative,
  fetchProjectCreatives,
} from "./api.js";
import { getProject, initProjects } from "./projects.js";

let activeProjectId = null;

export function initCreativesRail(projectId) {
  activeProjectId = projectId;
  bindCreativeEvents();
  void renderCreativesRail(projectId);
}

function bindCreativeEvents() {
  const rail = document.getElementById("project-videos-rail");
  if (!rail || rail.dataset.bound) return;
  rail.dataset.bound = "1";

  document.getElementById("btn-new-video")?.addEventListener("click", () => void onNewVideo());

  rail.addEventListener("click", (e) => {
    const card = e.target.closest("[data-creative-id]");
    if (!card || !activeProjectId) return;
    void switchCreative(activeProjectId, card.dataset.creativeId);
  });
}

export async function renderCreativesRail(projectId) {
  activeProjectId = projectId;
  const list = document.getElementById("videos-rail-list");
  const meta = document.getElementById("videos-rail-meta");
  if (!list) return;

  let summaries = [];
  let activeCreativeId = getProject(projectId)?.activeCreativeId || null;

  try {
    const data = await fetchProjectCreatives(projectId);
    summaries = data.creatives || [];
    activeCreativeId = data.activeCreativeId || activeCreativeId;
  } catch {
    const project = getProject(projectId);
    summaries = (project?.creatives || []).map((c, i) => ({
      id: c.id,
      title: c.title || `Vídeo ${i + 1}`,
      isActive: c.id === project.activeCreativeId,
      sceneCount: c.scenes?.length || 0,
      hasExport: Boolean(c.latestExport?.assetId),
      thumbAssetId: null,
    }));
  }

  if (meta) {
    meta.textContent =
      summaries.length === 0
        ? "Avatar / projecto — adiciona quantos vídeos quiseres."
        : `${summaries.length} vídeo(s) neste projecto`;
  }

  if (!summaries.length) {
    list.innerHTML = `
      <div class="videos-rail-empty muted">
        Sem vídeos ainda — clica <strong>+ Novo vídeo</strong> para começar.
      </div>`;
    return;
  }

  list.innerHTML = summaries
    .map((c) => {
      const thumb = c.thumbAssetId
        ? `<img src="${assetFileUrl(c.thumbAssetId)}?t=${Date.now()}" alt="" loading="lazy" />`
        : `<span class="videos-rail-placeholder">${c.hasExport ? "▶" : "…"}</span>`;
      const badge = c.hasExport ? "ready" : c.sceneCount ? "draft" : "new";
      return `
      <button type="button" class="videos-rail-card ${c.isActive ? "active" : ""}" data-creative-id="${c.id}">
        <div class="videos-rail-thumb">${thumb}</div>
        <div class="videos-rail-info">
          <strong>${escapeHtml(c.title)}</strong>
          <span class="muted">${c.sceneCount ? `${c.sceneCount} cenas` : "vazio"} · ${badge}</span>
        </div>
      </button>`;
    })
    .join("");
}

async function onNewVideo() {
  if (!activeProjectId) return;
  const btn = document.getElementById("btn-new-video");
  btn?.setAttribute("disabled", "disabled");

  try {
    await createCreative(activeProjectId);
    await initProjects();
    await renderCreativesRail(activeProjectId);
    window.dispatchEvent(
      new CustomEvent("ecoom:creative-changed", {
        detail: { projectId: activeProjectId },
      }),
    );
    window.dispatchEvent(new CustomEvent("ecoom:switch-tab", { detail: { tab: "create" } }));
  } catch (err) {
    alert(err.message || "Erro ao criar vídeo");
  } finally {
    btn?.removeAttribute("disabled");
  }
}

async function switchCreative(projectId, creativeId) {
  try {
    await activateCreative(projectId, creativeId);
    await initProjects();
    await renderCreativesRail(projectId);
    window.dispatchEvent(
      new CustomEvent("ecoom:creative-changed", { detail: { projectId, creativeId } }),
    );
  } catch (err) {
    alert(err.message || "Erro ao mudar vídeo");
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
