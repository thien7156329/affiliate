export const WORLD_STYLES = {
  auto: {
    label: "Story Adaptive",
    description: "arrange environment, architecture, props, and atmosphere flexibly and organically based purely on the story narrative, with zero rigid constraints",
    forbidden: "",
  },
  medieval: {
    label: "Medieval",
    description: "stone castles and villages, timber interiors, torch and candle lighting, handcrafted tools, period fabrics, leather and aged metal",
    forbidden: "modern vehicles, electricity, plastic, screens, firearms, neon and contemporary architecture",
  },
  western: {
    label: "Wild West",
    description: "frontier wooden town, ranches, dusty red desert, saloon-era materials, leather, denim and warm sunset light",
    forbidden: "modern vehicles, electronics, medieval castles, futuristic technology and contemporary city architecture",
  },
  modern: {
    label: "Modern Day",
    description: "real-world modern day life, cities, everyday buildings, practical props and technology",
    forbidden: "",
  },
  wild: {
    label: "Untamed Wilderness",
    description: "pristine forests, mountains, caves and rivers, rugged organic terrain, adventurous natural lighting and minimal civilization",
    forbidden: "urban clutter, modern infrastructure, decorative fantasy technology and unrelated historical architecture",
  },
  natural: {
    label: "Gentle Natural World",
    description: "peaceful countryside, woodland, meadows and streams, organic materials, soft daylight and grounded seasonal details",
    forbidden: "neon, heavy industry, futuristic machinery and visually dominant urban architecture",
  },
  fantasy: {
    label: "Magical Fantasy",
    description: "coherent enchanted architecture, magical flora, handcrafted artifacts, luminous atmosphere and story-motivated magic",
    forbidden: "unmotivated modern brands, ordinary electronics, sci-fi machinery and inconsistent real-world technology",
  },
  scifi: {
    label: "Science Fiction Future",
    description: "coherent advanced technology, futuristic architecture, holographic interfaces, engineered materials and cinematic neon accents",
    forbidden: "unmotivated medieval tools, western props, primitive infrastructure and incompatible present-day clutter",
  },
} as const;

export type WorldStyleId = keyof typeof WORLD_STYLES;
export type VisualStyleMode = "real" | "3d" | "stickman";

export function normalizeVisualStyle(value?: string): VisualStyleMode {
  if (!value) return "real";
  const v = String(value).trim().toLowerCase();
  if (v === "3d" || v === "3d_animation" || v === "animation") return "3d";
  if (v === "stickman" || v === "2d_stickman" || v === "nguoi_que" || v === "2d") return "stickman";
  return "real";
}

export function sanitizePromptForVisualStyle(prompt: string, visualStyle?: string): string {
  const mode = normalizeVisualStyle(visualStyle);
  let cleaned = prompt || "";
  if (mode === "real") {
    cleaned = cleaned
      .replace(/\b(Pixar|Disney|DreamWorks|Studio Ghibli|Ghibli)\b-?(style)?/gi, "photorealistic live-action")
      .replace(/\b(cinematic 3D( CGI)?( animation| realism| render)?|stylized 3D( CGI animation)?|clean 3D CGI animation|3D CGI( animation)?|3D animation|3D render|chibi 3D|cartoon 3D)\b/gi, "photorealistic live-action")
      .replace(/\b(Unreal Engine 5|Octane render|3D character|3D model|animated character|cartoon character)\b/gi, "real-life live-action")
      .trim();
  } else if (mode === "stickman") {
    cleaned = cleaned
      .replace(/\b(photorealistic live-action( cinema)?|8K ARRI Alexa|real-life human actors|natural skin pores)\b/gi, "2D chibi comic marshmallow stickman animation with bold black ink outlines and flat cel-shading")
      .replace(/\b(Pixar|Disney|DreamWorks)\b-?(style)?/gi, "2D comic stickman")
      .trim();
  } else {
    cleaned = cleaned
      .replace(/\b(Pixar|Disney|DreamWorks|Studio Ghibli|Ghibli)\b-?(style)?/gi, "cinematic 3D")
      .replace(/stylized 3D( CGI animation)?/gi, "cinematic 3D")
      .replace(/clean 3D CGI animation/gi, "cinematic 3D realism")
      .trim();
  }
  return cleaned;
}

export function normalizeWorldStyle(value?: string): WorldStyleId {
  return value && value in WORLD_STYLES ? value as WorldStyleId : "auto";
}

export function buildWorldStyleDirective(value?: string): string {
  const id = normalizeWorldStyle(value);
  if (id === "auto" || !value) {
    return "Setting: Adaptively arranged based purely on the user's story narrative and director instructions without rigid constraints.";
  }
  const style = WORLD_STYLES[id];
  return `Setting Guideline: ${style.label} (${style.description}) — explicit character, outfit, prop, and plot details in the prompt always take priority.`;
}

export function withWorldStyle(prompt: string, value?: string): string {
  if (!value || value === "auto" || prompt.includes("Setting:") || prompt.includes("WORLD STYLE")) {
    return prompt;
  }
  const directive = buildWorldStyleDirective(value);
  return `${directive}\n\n${prompt}`;
}
