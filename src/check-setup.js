import "dotenv/config";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n🔍 A verificar configuração Ecoom Direct ADS + Veo\n");

  const checks = [];

  // Node
  checks.push({
    ok: true,
    label: "Node.js",
    detail: process.version,
  });

  // gcloud
  const gcloud = run("gcloud --version");
  checks.push({
    ok: !!gcloud,
    label: "Google Cloud CLI (gcloud)",
    detail: gcloud ? gcloud.split("\n")[0] : "Não instalado — corre: npm run setup",
  });

  // ADC
  const token = run("gcloud auth application-default print-access-token 2>/dev/null");
  checks.push({
    ok: !!token,
    label: "Login Google (ADC)",
    detail: token ? "OK — autenticado" : "Falta login — corre: npm run setup",
  });

  // .env
  let envOk = false;
  try {
    await fs.access(".env");
    envOk = !!(process.env.GOOGLE_CLOUD_PROJECT && process.env.GCS_OUTPUT_URI);
    checks.push({
      ok: envOk,
      label: "Ficheiro .env",
      detail: envOk
        ? `Project: ${process.env.GOOGLE_CLOUD_PROJECT}`
        : "Existe mas incompleto — corre: npm run setup",
    });
  } catch {
    checks.push({
      ok: false,
      label: "Ficheiro .env",
      detail: "Não existe — corre: npm run setup",
    });
  }

  // Vertex AI quick test (list models) — só se tudo OK
  if (envOk && token) {
    checks.push({
      ok: true,
      label: "Cliente Vertex AI",
      detail: `Região: ${process.env.GOOGLE_CLOUD_LOCATION || "global"}`,
    });
  }

  checks.push({
    ok: envOk,
    label: "Gemini storyboard (Vertex AI)",
    detail: envOk
      ? `Modelo: ${process.env.GEMINI_STORYBOARD_MODEL || "gemini-2.5-flash"}`
      : "Requer GOOGLE_CLOUD_PROJECT no .env",
  });

  checks.push({
    ok: envOk,
    label: "Veo clip duration",
    detail: envOk
      ? `${process.env.VEO_CLIP_DURATION || "10"}s/clip (suporta 4, 6, 8, 10)`
      : "—",
  });

  for (const c of checks) {
    console.log(`${c.ok ? "✅" : "❌"} ${c.label}`);
    console.log(`   ${c.detail}\n`);
  }

  const allOk = checks.every((c) => c.ok);

  if (allOk) {
    console.log("🚀 Tudo pronto! Gera um anúncio completo:\n");
    console.log('   npm run ad -- "Descreve a tua oferta aqui"\n');
  } else {
    console.log("⚠️  Corre o setup (só uma vez):\n");
    console.log("   npm run setup\n");
    process.exit(1);
  }
}

main();
