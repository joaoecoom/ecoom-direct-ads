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
  };
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
