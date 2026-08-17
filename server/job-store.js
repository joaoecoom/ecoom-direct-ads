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
  return job;
}

export async function getJob(id) {
  try {
    const raw = await fs.readFile(jobPath(id), "utf8");
    return JSON.parse(raw);
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

export async function listJobs(limit = 20) {
  await ensureJobsDir();
  const files = await fs.readdir(JOBS_DIR);
  const jobs = [];
  for (const file of files.filter((f) => f.endsWith(".json")).slice(-limit)) {
    const raw = await fs.readFile(path.join(JOBS_DIR, file), "utf8");
    jobs.push(JSON.parse(raw));
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
