import { assetFileUrl, fetchCharacters } from "./api.js";
import { getProject, isApiEnabled } from "./projects.js";

export async function renderCharactersView() {
  const grid = document.getElementById("characters-grid");
  if (!grid) return;

  if (!isApiEnabled()) {
    grid.innerHTML = `<div class="empty-state card"><p class="muted">API offline.</p></div>`;
    return;
  }

  grid.innerHTML = `<div class="empty-state card"><p class="muted">A carregar personagens…</p></div>`;

  try {
    const { characters } = await fetchCharacters();

    if (!characters?.length) {
      grid.innerHTML = `
        <div class="empty-state card">
          <h3>Ainda sem personagens</h3>
          <p class="muted">Num projecto → tab <strong>Assets</strong> → upload imagem → <strong>Usar como personagem</strong>.</p>
        </div>`;
      return;
    }

    grid.innerHTML = characters
      .map(
        (c) => `
      <article class="character-card card" data-character-project="${c.projectId}" data-character-asset="${c.assetId}">
        <div class="character-card-thumb">
          <img src="${assetFileUrl(c.assetId)}?t=${Date.now()}" alt="" loading="lazy" />
        </div>
        <div class="character-card-body">
          <strong>${escapeHtml(c.characterBrief?.slice(0, 48) || "Personagem")}</strong>
          <span class="muted">${escapeHtml(c.projectName)}</span>
          ${c.settingBrief ? `<p class="muted">${escapeHtml(c.settingBrief.slice(0, 60))}</p>` : ""}
        </div>
        <div class="character-card-actions">
          <button type="button" class="btn sm" data-open-character-project="${c.projectId}">Abrir projecto</button>
          <button type="button" class="btn primary sm" data-create-ad-from="${c.projectId}">Criar ad</button>
        </div>
      </article>`,
      )
      .join("");

    grid.querySelectorAll("[data-open-character-project]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.hash = `#/project/${btn.dataset.openCharacterProject}`;
      });
    });

    grid.querySelectorAll("[data-create-ad-from]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const projectId = btn.dataset.createAdFrom;
        window.location.hash = `#/project/${projectId}`;
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("ecoom:switch-tab", { detail: { tab: "create" } }),
          );
        });
      });
    });
  } catch (err) {
    grid.innerHTML = `<div class="card error">${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
