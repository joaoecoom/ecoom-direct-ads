import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateVideo } from "./generate-video.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Gera vários vídeos em sequência a partir de prompts/prompts.json
 *
 * Uso:
 *   npm run video:batch -- prompts/exemplo.json
 *   npm run video:batch -- "prompt 1" "prompt 2"
 */
async function main() {
  const arg = process.argv[2];

  let jobs = [];

  if (!arg) {
    const defaultFile = path.join(ROOT, "prompts", "exemplo.json");
    const raw = await fs.readFile(defaultFile, "utf8");
    jobs = JSON.parse(raw);
  } else if (arg.endsWith(".json")) {
    const filePath = path.resolve(process.cwd(), arg);
    const raw = await fs.readFile(filePath, "utf8");
    jobs = JSON.parse(raw);
  } else {
    jobs = process.argv.slice(2).map((prompt, i) => ({
      id: `clip-${i + 1}`,
      prompt,
    }));
  }

  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("Nenhum prompt para gerar.");
  }

  console.log(`\n📦 Batch: ${jobs.length} vídeo(s)\n`);

  const results = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`--- [${i + 1}/${jobs.length}] ${job.id || "video"} ---`);

    const result = await generateVideo({
      prompt: job.prompt,
      model: job.model,
      aspectRatio: job.aspectRatio || "9:16",
      durationSeconds: job.durationSeconds ?? 8,
      negativePrompt: job.negativePrompt,
      outputFileName: job.outputFileName || `${job.id || `video-${i + 1}`}.mp4`,
    });

    results.push(result);
  }

  const manifestPath = path.join(
    ROOT,
    "output",
    `batch-${Date.now()}.json`,
  );
  await fs.writeFile(manifestPath, JSON.stringify(results, null, 2));

  console.log(`\n✅ Batch concluído. Manifest: ${manifestPath}\n`);
}

main().catch((err) => {
  console.error("\n❌ Erro batch:", err.message);
  process.exit(1);
});
