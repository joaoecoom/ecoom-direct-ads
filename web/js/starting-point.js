/** Creative Starting Point — entry modes that converge on the same Ecoom pipeline. */

export const STARTING_POINTS = [
  {
    id: "prompt",
    title: "Start from Prompt",
    titlePt: "Começar com Prompt",
    desc: "Descreve o anúncio — copy, blueprint, imagens e vídeo.",
    icon: "✦",
    featured: true,
  },
  {
    id: "image",
    title: "Start from Image",
    titlePt: "Começar com Imagem",
    desc: "Upload de expert, produto, UGC ou referência visual.",
    icon: "🖼",
  },
  {
    id: "video",
    title: "Start from Video",
    titlePt: "Começar com Vídeo",
    desc: "Anúncio existente, VSL, UGC ou vídeo de referência.",
    icon: "▶",
  },
  {
    id: "upload",
    title: "Upload Assets",
    titlePt: "Upload de Assets",
    desc: "Várias imagens e vídeos de uma vez para o projecto.",
    icon: "⇪",
  },
  {
    id: "generate_image",
    title: "Generate Image",
    titlePt: "Gerar Imagem",
    desc: "Cria uma imagem com prompt — depois varia, anima ou monta ad.",
    icon: "🎨",
  },
  {
    id: "generate_video",
    title: "Generate Video",
    titlePt: "Gerar Vídeo",
    desc: "Clip individual com Veo a partir de um prompt.",
    icon: "🎬",
  },
];

export const STARTING_POINT_IDS = STARTING_POINTS.map((s) => s.id);

export function getStartingPoint(id) {
  return STARTING_POINTS.find((s) => s.id === id) || STARTING_POINTS[0];
}

/** Default workspace tab per entry mode. */
export function getEntryRoute(startingPoint = "prompt") {
  switch (startingPoint) {
    case "image":
    case "video":
    case "upload":
      return { tab: "assets", action: startingPoint };
    case "generate_image":
      return { tab: "assets", action: "generate-image" };
    case "generate_video":
      return { tab: "assets", action: "generate-video" };
    case "prompt":
    default:
      return { tab: "create", action: null };
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
