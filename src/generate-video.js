import {
  downloadFromGcs,
  generateVideoFromText,
} from "./lib/veo-client.js";

export { generateVideoFromText as generateVideo };

const isMain = process.argv[1]?.endsWith("generate-video.js");
if (isMain) {
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Cinematic product ad, luxury skincare bottle on marble, soft golden light, slow camera push in, 9:16 vertical";

  generateVideoFromText({ prompt }).catch((err) => {
    console.error("\n❌ Erro:", err.message);
    if (err.message.includes("Could not load the default credentials")) {
      console.error("\n💡 Corre: npm run setup");
    }
    process.exit(1);
  });
}
