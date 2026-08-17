import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "data", "assets");
const FILES_DIR = path.join(ASSETS_DIR, "files");

async function ensureDirs() {
  await fs.mkdir(FILES_DIR, { recursive: true });
}

function metaPath(id) {
  return path.join(ASSETS_DIR, `${id}.json`);
}

export async function createAsset(payload) {
  await ensureDirs();
  const id = randomUUID();
  const ext = payload.ext || "png";
  const fileName = `${id}.${ext}`;
  const filePath = path.join(FILES_DIR, fileName);

  if (payload.fileBuffer) {
    await fs.writeFile(filePath, payload.fileBuffer);
  } else if (payload.sourcePath) {
    await fs.copyFile(path.resolve(payload.sourcePath), filePath);
  } else {
    throw new Error("fileBuffer ou sourcePath obrigatório");
  }

  const asset = {
    id,
    projectId: payload.projectId,
    type: payload.type || "image",
    source: payload.source || "generated",
    prompt: payload.prompt || "",
    sceneId: payload.sceneId || null,
    filePath,
    url: `/api/assets/${id}/file`,
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(metaPath(id), JSON.stringify(asset, null, 2));
  return asset;
}

export async function getAsset(id) {
  try {
    const raw = await fs.readFile(metaPath(id), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listAssetsByProject(projectId) {
  await ensureDirs();
  let files = [];
  try {
    files = await fs.readdir(ASSETS_DIR);
  } catch {
    return [];
  }

  const assets = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = await fs.readFile(path.join(ASSETS_DIR, file), "utf8");
      const asset = JSON.parse(raw);
      if (asset.projectId === projectId) assets.push(asset);
    } catch {
      /* skip */
    }
  }

  return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteAsset(id) {
  const asset = await getAsset(id);
  if (!asset) return false;
  try {
    await fs.unlink(asset.filePath);
  } catch {
    /* ok */
  }
  try {
    await fs.unlink(metaPath(id));
  } catch {
    return false;
  }
  return true;
}

export function resolveAssetFile(asset) {
  return path.resolve(asset.filePath);
}
