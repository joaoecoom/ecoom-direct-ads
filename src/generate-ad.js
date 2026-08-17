import { parseAdCliArgs, resolveAdConfig } from "./lib/ad-config.js";
import { runAdGeneration } from "./run-ad-generation.js";

async function main() {
  const args = process.argv.slice(2);
  const { overrides, offer } = parseAdCliArgs(args);
  const storyboardOnly = overrides.storyboardOnly === true;
  delete overrides.storyboardOnly;

  if (!offer) {
    console.error(`Uso: npm run ad -- --style ugc --scenes 4 --lang pt "Brief..."`);
    process.exit(1);
  }

  overrides.languageVariant = resolveAdConfig(overrides).languageVariant;

  console.log("\n══════════════════════════════════════════");
  console.log("  Ecoom Direct ADS — Gerador de Anúncio");
  console.log("══════════════════════════════════════════\n");
  console.log(`📋 Oferta: ${offer}\n`);

  let copyPath;
  let finalVideo;

  const result = await runAdGeneration({
    offer,
    overrides,
    storyboardOnly,
    onProgress: ({ step, message, copyPath: cp, finalVideo: fv }) => {
      if (cp) copyPath = cp;
      if (fv) finalVideo = fv;
      if (step === "config") console.log(`⚙️  ${message}\n`);
      else if (step === "storyboard") console.log(`🧠 ${message}`);
      else if (step === "image") console.log(`--- ${message} ---`);
      else if (step === "video") console.log(`\n🎬 ${message}`);
      else if (step === "voice") console.log(`\n🎙️  ${message}`);
      else if (step === "lipsync") console.log(`\n👄 ${message}`);
      else if (step === "mix") console.log(`\n🔊 ${message}`);
      else if (step === "done") console.log(`\n✅ ${message}`);
    },
  });

  if (result.storyboardPath) {
    console.log(`📄 Storyboard: ${result.storyboardPath}\n`);
  }
  if (result.finalVideo) {
    console.log(`🎬 Vídeo final: ${result.finalVideo}\n`);
  }
  if (result.copyPath) {
    console.log(`📝 Copy: ${result.copyPath}\n`);
  }
}

main().catch((err) => {
  console.error("\n❌ Erro:", err.message);
  process.exit(1);
});
