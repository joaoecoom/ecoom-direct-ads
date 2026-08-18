import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const VEO_MODELS = [
  {
    id: "veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast (recomendado — mais rápido)",
  },
  {
    id: "veo-3.1-generate-001",
    label: "Veo 3.1 Standard (maior qualidade)",
  },
  {
    id: "veo-3.1-lite-generate-001",
    label: "Veo 3.1 Lite (mais barato)",
  },
  {
    id: "veo-3.0-fast-generate-001",
    label: "Veo 3.0 Fast",
  },
  {
    id: "veo-3.0-generate-001",
    label: "Veo 3.0 Standard",
  },
];

export function loadConfig() {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
  const gcsOutputUri = process.env.GCS_OUTPUT_URI;
  const model = process.env.VEO_MODEL || "veo-3.1-fast-generate-001";
  const outputDir = path.resolve(
    ROOT,
    process.env.OUTPUT_DIR || "./output",
  );

  const missing = [];
  if (!project) missing.push("GOOGLE_CLOUD_PROJECT");
  if (!gcsOutputUri) missing.push("GCS_OUTPUT_URI");

  if (missing.length) {
    throw new Error(
      `Falta configurar no ficheiro .env: ${missing.join(", ")}\n` +
        "Corre primeiro: npm run setup",
    );
  }

  if (!gcsOutputUri.startsWith("gs://")) {
    throw new Error("GCS_OUTPUT_URI tem de começar por gs://");
  }

  return { project, location, gcsOutputUri, model, outputDir };
}

export async function ensureOutputDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function parseGcsUri(uri) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) {
    throw new Error(`URI GCS inválido: ${uri}`);
  }
  return { bucket: match[1], objectPath: match[2] };
}

export function resolveModelId(requested) {
  const found = VEO_MODELS.find((m) => m.id === requested);
  return found?.id ?? requested;
}

/** Evita path.join(outputDir, caminhoAbsoluto) duplicar o prefixo no Linux. */
export function resolveLocalOutputPath(outputDir, outputFileName, fallbackName) {
  if (!outputFileName) {
    return path.join(outputDir, fallbackName);
  }
  if (path.isAbsolute(outputFileName)) {
    return path.normalize(outputFileName);
  }
  return path.join(outputDir, outputFileName);
}
