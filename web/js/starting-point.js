/** Creative Starting Point — studio first, ads as an option. */

export const STARTING_POINTS = [
  {
    id: "upload",
    title: "Upload Assets",
    titlePt: "Upload imagens / vídeos",
    desc: "Arrasta fotos e clips para o projecto. Depois geras, animas ou fazes um ad.",
    icon: "⇪",
    featured: true,
  },
  {
    id: "image",
    title: "Start from Image",
    titlePt: "Começar com imagem",
    desc: "Upload de pessoa, produto ou referência — variações e Veo a seguir.",
    icon: "🖼",
  },
  {
    id: "video",
    title: "Start from Video",
    titlePt: "Começar com vídeo",
    desc: "Importa um clip e trabalha a partir dele.",
    icon: "▶",
  },
  {
    id: "generate_image",
    title: "Generate Image",
    titlePt: "Gerar imagem",
    desc: "Nano Banana Pro — prompt no studio, depois variações ou animar.",
    icon: "🎨",
  },
  {
    id: "generate_video",
    title: "Generate Video",
    titlePt: "Gerar vídeo",
    desc: "Veo a partir de prompt, ou anima uma imagem já no projecto.",
    icon: "🎬",
  },
  {
    id: "prompt",
    title: "Generate Ad",
    titlePt: "Gerar anúncio",
    desc: "Brief → copy → cenas → imagens → vídeo. Pipeline Ecoom completa.",
    icon: "✦",
  },
];

export const STARTING_POINT_IDS = STARTING_POINTS.map((s) => s.id);

export function getStartingPoint(id) {
  return STARTING_POINTS.find((s) => s.id === id) || STARTING_POINTS[0];
}

/** Default workspace tab per entry mode. Studio home is Images. */
export function getEntryRoute(startingPoint = "upload") {
  switch (startingPoint) {
    case "prompt":
      return { tab: "create", action: null };
    case "video":
      return { tab: "videos", action: "video" };
    case "generate_video":
      return { tab: "videos", action: "generate-video" };
    case "image":
      return { tab: "images", action: "image" };
    case "generate_image":
      return { tab: "images", action: "generate-image" };
    case "upload":
    default:
      return { tab: "images", action: "upload" };
  }
}

export function startingPointLabel(id) {
  return getStartingPoint(id).titlePt;
}

export function renderStartingPointCards(selectedId, { compact = false } = {}) {
  return STARTING_POINTS.map((sp) => {
    const active = sp.id === selectedId ? " active" : "";
    const featured = sp.featured ? " featured" : "";
    return `
      <button type="button" class="sp-card${active}${featured}${compact ? " sp-card-compact" : ""}" data-sp="${sp.id}">
        <span class="sp-card-icon">${sp.icon}</span>
        <strong class="sp-card-title">${sp.titlePt}</strong>
        <span class="sp-card-desc">${sp.desc}</span>
      </button>`;
  }).join("");
}

export function needsCreativeWorkspace(startingPoint) {
  return startingPoint !== "prompt";
}
