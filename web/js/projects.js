import {
  apiCreateProject,
  apiDeleteProject,
  apiDuplicateProject,
  apiUpdateProject,
  fetchProjects,
} from "./api.js";

const STORAGE_KEY = "ecoom_projects_v1";

export const DEFAULT_SETTINGS = {
  language: "pt",
  languageVariant: "pt-BR",
  aspectRatio: "9:16",
  clipDurationSeconds: 8,
  sceneCount: 3,
  totalDurationSeconds: 24,
  resolution: "1080p",
  tone: "amigavel",
  style: "ugc",
};

export const TOTAL_DURATION_PRESETS = [
  { id: 15, label: "15s" },
  { id: 30, label: "30s" },
  { id: 60, label: "60s" },
  { id: 90, label: "90s" },
  { id: 180, label: "3 min" },
  { id: "custom", label: "Custom" },
];

let cache = [];
let apiEnabled = false;

export function isApiEnabled() {
  return apiEnabled;
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocal(projects) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function setCache(projects) {
  cache = projects;
  saveLocal(projects);
}

/** Bootstrap: API first, localStorage fallback */
export async function initProjects() {
  try {
    const data = await fetchProjects();
    setCache(data.projects || []);
    apiEnabled = true;
  } catch {
    cache = loadLocal();
    apiEnabled = false;
  }
  return cache;
}

export function calcSceneCount(totalSeconds, clipDurationSeconds, maxScenes = 5) {
  const n = Math.ceil(totalSeconds / clipDurationSeconds);
  return Math.max(1, Math.min(maxScenes, n));
}

export function calcTotalDuration(sceneCount, clipDurationSeconds) {
  return sceneCount * clipDurationSeconds;
}

export function listProjects() {
  return [...cache].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id) {
  return cache.find((p) => p.id === id) ?? null;
}

export async function createProject(name, masterPrompt = "") {
  const payload = {
    name: name.trim() || "Untitled Project",
    masterPrompt: masterPrompt.trim(),
  };

  if (apiEnabled) {
    const project = await apiCreateProject(payload);
    cache.unshift(project);
    saveLocal(cache);
    return project;
  }

  const now = new Date().toISOString();
  const project = {
    id: crypto.randomUUID(),
    ...payload,
    settings: { ...DEFAULT_SETTINGS },
    jobIds: [],
    creatives: [],
    latestCreative: null,
    createdAt: now,
    updatedAt: now,
  };
  cache.unshift(project);
  saveLocal(cache);
  return project;
}

export async function updateProject(id, patch) {
  if (apiEnabled) {
    const project = await apiUpdateProject(id, patch);
    const idx = cache.findIndex((p) => p.id === id);
    if (idx >= 0) cache[idx] = project;
    else cache.unshift(project);
    saveLocal(cache);
    return project;
  }

  const idx = cache.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  cache[idx] = {
    ...cache[idx],
    ...patch,
    settings: patch.settings ? { ...cache[idx].settings, ...patch.settings } : cache[idx].settings,
    updatedAt: new Date().toISOString(),
  };
  saveLocal(cache);
  return cache[idx];
}

export async function duplicateProject(id) {
  if (apiEnabled) {
    const copy = await apiDuplicateProject(id);
    cache.unshift(copy);
    saveLocal(cache);
    return copy;
  }

  const source = getProject(id);
  if (!source) return null;
  return createProject(`${source.name} (cópia)`, source.masterPrompt).then((copy) =>
    updateProject(copy.id, { settings: { ...source.settings }, jobIds: [], creatives: [] }),
  );
}

export async function deleteProject(id) {
  if (apiEnabled) {
    await apiDeleteProject(id);
  }
  cache = cache.filter((p) => p.id !== id);
  saveLocal(cache);
}

export async function linkJobToProject(projectId, jobId) {
  return updateProject(projectId, {
    jobIds: getProject(projectId)?.jobIds?.includes(jobId)
      ? getProject(projectId).jobIds
      : [...(getProject(projectId)?.jobIds || []), jobId],
  });
}

export async function refreshProjects() {
  return initProjects();
}
