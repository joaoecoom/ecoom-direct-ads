import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "..", "data", "projects");

export const DEFAULT_PROJECT_SETTINGS = {
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

async function ensureProjectsDir() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

function projectPath(id) {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

function normalizeProject(raw) {
  return {
    ...raw,
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...raw.settings },
    jobIds: raw.jobIds || [],
    creatives: raw.creatives || [],
    scenes: raw.scenes || [],
    assetIds: raw.assetIds || [],
    blueprintPath: raw.blueprintPath || null,
    blueprint: raw.blueprint || null,
  };
}

export function storyboardToScenes(storyboard) {
  return (storyboard.scenes || []).map((s, i) => ({
    id: s.id || `parte-${i + 1}`,
    order: i,
    role: s.role || "",
    imagePrompt: s.imagePrompt || "",
    motionPrompt: s.motionPrompt || "",
    voiceoverLine: s.voiceoverLine || "",
    visualBeat: s.visualBeat || "",
    onScreenText: s.onScreenText || "",
    imageAssetId: null,
    videoAssetId: null,
    status: { prompt: "done", image: "pending", video: "pending" },
  }));
}

export async function applyBlueprint(projectId, { storyboardPath, storyboard }) {
  return updateProject(projectId, {
    blueprintPath: storyboardPath,
    blueprint: {
      title: storyboard.title,
      hook: storyboard.hook,
      sceneCount: storyboard.scenes?.length || 0,
    },
    scenes: storyboardToScenes(storyboard),
  });
}

export async function updateProjectScene(projectId, sceneId, patch) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} não encontrado`);
  const scenes = project.scenes.map((s) =>
    s.id === sceneId
      ? {
          ...s,
          ...patch,
          status: patch.status ? { ...s.status, ...patch.status } : s.status,
        }
      : s,
  );
  return updateProject(projectId, { scenes });
}

export async function linkAssetToScene(projectId, sceneId, assetId) {
  return updateProjectScene(projectId, sceneId, {
    imageAssetId: assetId,
    status: { image: "done" },
  });
}

export async function addProjectAssetId(projectId, assetId) {
  const project = await getProject(projectId);
  if (!project) return null;
  const assetIds = project.assetIds.includes(assetId)
    ? project.assetIds
    : [...project.assetIds, assetId];
  return updateProject(projectId, { assetIds });
}

export async function createProject(payload = {}) {
  await ensureProjectsDir();
  const now = new Date().toISOString();
  const project = {
    id: randomUUID(),
    name: String(payload.name || "Untitled Project").trim() || "Untitled Project",
    masterPrompt: String(payload.masterPrompt || "").trim(),
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...payload.settings },
    jobIds: [],
    creatives: [],
    latestCreative: null,
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(projectPath(project.id), JSON.stringify(project, null, 2));
  return project;
}

export async function getProject(id) {
  try {
    const raw = await fs.readFile(projectPath(id), "utf8");
    return normalizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function updateProject(id, patch = {}) {
  const project = await getProject(id);
  if (!project) throw new Error(`Project ${id} não encontrado`);

  const next = {
    ...project,
    ...patch,
    settings: patch.settings
      ? { ...project.settings, ...patch.settings }
      : project.settings,
    jobIds: patch.jobIds ?? project.jobIds,
    creatives: patch.creatives ?? project.creatives,
    latestCreative: patch.latestCreative ?? project.latestCreative,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(projectPath(id), JSON.stringify(next, null, 2));
  return next;
}

export async function deleteProject(id) {
  try {
    await fs.unlink(projectPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function duplicateProject(id) {
  const source = await getProject(id);
  if (!source) return null;

  const copy = await createProject({
    name: `${source.name} (cópia)`,
    masterPrompt: source.masterPrompt,
    settings: { ...source.settings },
  });
  return copy;
}

export async function listProjects(limit = 100) {
  await ensureProjectsDir();
  const files = await fs.readdir(PROJECTS_DIR);
  const projects = [];

  for (const file of files.filter((f) => f.endsWith(".json")).slice(-limit)) {
    try {
      const raw = await fs.readFile(path.join(PROJECTS_DIR, file), "utf8");
      projects.push(normalizeProject(JSON.parse(raw)));
    } catch {
      /* skip corrupt */
    }
  }

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function linkJobToProject(projectId, jobId, creativeMeta = {}) {
  const project = await getProject(projectId);
  if (!project) return null;

  const jobIds = project.jobIds.includes(jobId)
    ? project.jobIds
    : [...project.jobIds, jobId];

  const creative = {
    jobId,
    ...creativeMeta,
    linkedAt: new Date().toISOString(),
  };

  return updateProject(projectId, {
    jobIds,
    latestCreative: creative,
    creatives: [...project.creatives, creative],
  });
}
