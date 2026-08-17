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
