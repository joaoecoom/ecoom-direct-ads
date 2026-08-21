const API_URL = window.ECOOM_API_URL ?? "";

export async function fetchConfig() {
  const res = await fetch(`${API_URL}/api/config`);
  if (!res.ok) throw new Error("Config indisponível");
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error("API indisponível");
  return res.json();
}

export async function fetchProjects() {
  const res = await fetch(`${API_URL}/api/projects`);
  if (!res.ok) throw new Error("Projects indisponível");
  return res.json();
}

export async function fetchProject(id) {
  const res = await fetch(`${API_URL}/api/projects/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function apiCreateProject(payload) {
  const res = await fetch(`${API_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao criar projecto");
  return data;
}

export async function apiUpdateProject(id, patch) {
  const res = await fetch(`${API_URL}/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao actualizar projecto");
  return data;
}

export async function apiDeleteProject(id) {
  const res = await fetch(`${API_URL}/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Erro ao eliminar projecto");
  }
}

export async function apiDuplicateProject(id) {
  const res = await fetch(`${API_URL}/api/projects/${id}/duplicate`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao duplicar projecto");
  return data;
}

export async function generateCopy(projectId, body = {}) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Geração de copy falhou");
  return data;
}

export async function createJob(payload) {
  const res = await fetch(`${API_URL}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao criar job");
  return data;
}

export async function fetchJob(jobId) {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchJobCopy(jobId) {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/copy`);
  if (!res.ok) return null;
  return res.json();
}

export function jobVideoUrl(jobId) {
  return `${API_URL}/api/jobs/${jobId}/video`;
}

export async function fetchProjectStoryboard(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/storyboard`);
  if (!res.ok) return null;
  return res.json();
}

export async function syncJobToProject(projectId, jobId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/sync-job/${jobId}`, {
    method: "POST",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sync falhou");
  return data;
}

export async function fetchProjectCreatives(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/creatives`);
  if (!res.ok) throw new Error("Creatives indisponíveis");
  return res.json();
}

export async function createCreative(projectId, body = {}) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/creatives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao criar vídeo");
  return data;
}

export async function activateCreative(projectId, creativeId) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/creatives/${creativeId}/activate`,
    { method: "POST" },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao activar vídeo");
  return data;
}

export async function fetchProjectAssets(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/assets`);
  if (!res.ok) throw new Error("Assets indisponíveis");
  return res.json();
}

export function assetFileUrl(assetId) {
  return `${API_URL}/api/assets/${assetId}/file`;
}

export async function uploadAsset(projectId, payload) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload falhou");
  return data;
}

export async function generateAssetVariations(projectId, assetId, body = {}) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/assets/${assetId}/variations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Variações falharam");
  return data;
}

export async function generateStandaloneImage(projectId, body = {}) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/assets/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Geração de imagem falhou");
  return data;
}

export async function generateStandaloneVideo(projectId, body = {}) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/assets/generate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Geração de vídeo falhou");
  return data;
}

export async function animateAsset(projectId, assetId, body = {}) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/assets/${assetId}/animate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Animar falhou");
  return data;
}

export async function generateBlueprint(projectId, body = {}) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/blueprint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Blueprint falhou");
  return data;
}

export async function generateAllImages(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/images/generate`, {
    method: "POST",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Geração de imagens falhou");
  return data;
}

export async function regenerateSceneImage(projectId, sceneId) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/scenes/${sceneId}/image`,
    { method: "POST" },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Regeneração falhou");
  return data;
}

export async function animateAllVideos(projectId, body = {}) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/videos/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoRebuild: body.autoRebuild !== false }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Animate All falhou");
  return data;
}

export async function fetchCharacters() {
  const res = await fetch(`${API_URL}/api/characters`);
  if (!res.ok) throw new Error("Personagens indisponíveis");
  return res.json();
}

export async function setProjectAvatar(projectId, body) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/avatar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao definir personagem");
  return data;
}

export async function addProjectReference(projectId, assetId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao adicionar referência");
  return data;
}

export async function animateSceneVideo(projectId, sceneId) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/scenes/${sceneId}/video`,
    { method: "POST" },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Animate falhou");
  return data;
}

export async function fetchProjectTimeline(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/timeline`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Timeline indisponível");
  }
  return res.json();
}

export async function rebuildTimeline(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/timeline/rebuild`, {
    method: "POST",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Rebuild falhou");
  return data;
}

export async function fetchProjectScene(projectId, sceneId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/scenes/${sceneId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Cena indisponível");
  }
  return res.json();
}

export async function patchProjectScene(projectId, sceneId, patch) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/scenes/${sceneId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao actualizar cena");
  return data;
}

export async function activateSceneVersion(projectId, sceneId, type, assetId) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/scenes/${sceneId}/versions/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, assetId }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro ao activar versão");
  return data;
}

export async function fetchProjectExports(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/exports`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Exports indisponíveis");
  }
  return res.json();
}

export async function regenerateSceneVideo(projectId, sceneId, body = {}) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/scenes/${sceneId}/video`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Regeneração de vídeo falhou");
  return data;
}

export async function fetchProviderDiagnostics() {
  const res = await fetch(`${API_URL}/api/providers/diagnostics`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Diagnostics indisponíveis");
  return data;
}

export async function fetchGenerationPlan(projectId, body = {}) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/generation/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Plano de geração indisponível");
  return data;
}

export async function fetchSceneGenerationRoute(projectId, sceneId, body = {}) {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/scenes/${sceneId}/generation/route`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Route indisponível");
  return data;
}

export async function fetchProjectProductionCosts(projectId) {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/production/costs`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Custos indisponíveis");
  return data;
}
