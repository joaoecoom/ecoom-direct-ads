import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, "..", "data", "jobs");

async function ensureJobsDir() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
}

function jobPath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

async function readJobFile(id) {
  const raw = await fs.readFile(jobPath(id), "utf8");
  return JSON.parse(raw);
}

export async function createJob(payload) {
  await ensureJobsDir();
  const job = {
    id: payload.id,
    type: payload.type || payload.request?.type || "full_ad",
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: { step: "queued", message: "Na fila..." },
    request: payload.request,
    result: null,
    error: null,
  };
  await fs.writeFile(jobPath(job.id), JSON.stringify(job, null, 2));
  const verified = await getJob(job.id);
  if (!verified) {
    throw new Error(`Falha ao persistir job ${job.id}`);
  }
  return job;
}

export async function getJob(id) {
  try {
    return await readJobFile(id);
  } catch {
    return null;
  }
}

export async function updateJob(id, patch) {
  const job = await getJob(id);
  if (!job) throw new Error(`Job ${id} não encontrado`);
  const next = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
    progress: patch.progress ? { ...job.progress, ...patch.progress } : job.progress,
    result: patch.result ? { ...job.result, ...patch.result } : job.result,
  };
  await fs.writeFile(jobPath(id), JSON.stringify(next, null, 2));
  return next;
}

export async function safeUpdateJob(id, patch) {
  try {
    return await updateJob(id, patch);
  } catch {
    return null;
  }
}

async function listJobFiles(limit = 100) {
  await ensureJobsDir();
  let files = [];
  try {
    files = await fs.readdir(JOBS_DIR);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const withStats = await Promise.all(
    jsonFiles.map(async (file) => {
      const full = path.join(JOBS_DIR, file);
      const stat = await fs.stat(full);
      return { file, mtime: stat.mtimeMs };
    }),
  );

  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats.slice(0, limit).map((entry) => entry.file);
}

export async function listJobs(limit = 20) {
  const files = await listJobFiles(Math.max(limit, 50));
  const jobs = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(JOBS_DIR, file), "utf8");
      jobs.push(JSON.parse(raw));
    } catch {
      /* skip corrupt */
    }
  }
  return jobs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Jobs queued or stale-running — for queue recovery after restart. */
export async function listPendingJobs(staleRunningMs = 5 * 60 * 1000) {
  const files = await listJobFiles(200);
  const now = Date.now();
  const pending = [];

  for (const file of files) {
    try {
      const job = JSON.parse(await fs.readFile(path.join(JOBS_DIR, file), "utf8"));
      if (job.status === "queued") {
        pending.push(job);
        continue;
      }
      if (job.status === "running") {
        const updated = new Date(job.updatedAt || job.createdAt).getTime();
        if (now - updated > staleRunningMs) {
          pending.push(job);
        }
      }
    } catch {
      /* skip */
    }
  }

  return pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function resetStaleRunningJobs(staleRunningMs = 5 * 60 * 1000) {
  const stale = await listPendingJobs(staleRunningMs);
  const requeued = [];

  for (const job of stale) {
    if (job.status !== "running") continue;
    await updateJob(job.id, {
      status: "queued",
      progress: { step: "queued", message: "Recuperado após interrupção — a reprocessar..." },
    });
    requeued.push(job.id);
  }

  return requeued;
}
