/**
 * Prompt Generator — Uses AGY Gemini 3.8 as the primary generator and
 * GLM-5 as the independent quality auditor, with Bedrock fallbacks.
 */



const SYSTEM_PROMPT = `You are an expert AI Video Prompt Engineer specializing in Veo (Google's video AI).
Your goal is to write a highly detailed, cinematic 4K prompt in English for product affiliate marketing videos.

Rules:
- Always write in English
- 1-3 sentences maximum
- Must include: product subject, lighting style, camera movement, environment/background, cinematic quality keywords
- Make it visually stunning and conversion-optimized for social media (TikTok/Reels)
- Do NOT include any explanation, just output the final prompt

Category-specific styles:
- tech: clean minimalist desk setup, RGB lighting, macro close-up shots, shallow depth of field
- beauty: soft studio lighting, pastel background, liquid droplets, slow motion
- fashion: urban outdoor, golden hour, dynamic tracking shot, vibrant colors
- food: warm cozy kitchen, steam rising, macro food porn, bokeh background
- fitness: gym environment, motivational energy, dynamic angles, dramatic lighting
- toys: whimsical playroom, bright colorful lighting, claymation style, playful animations, soft volumetric shadows
- household: cozy modern living room, clean bright ambient lighting, practical home setups, family-friendly warm atmosphere
- baby: gentle warm nursery, soft pastel colors, nursery ambient lighting, cute whimsical style, child-safe environment
- pets: playful pet zone, bright cheerful lighting, dynamic tracking shot, cute animal accessories, funny energetic mood`;

import axios from "axios";
import "dotenv/config";
import { AGY_DEFAULT_MODEL, callAgy, isAgyEnabled } from "./agyClient.js";

export interface AiDebateMessage {
  agent: string;
  model: string;
  role: string;
  title: string;
  content: string;
  timestamp: string;
}

export type ConsensusProgressEvent = 
  | { type: "heartbeat"; elapsedSec: number; currentRound?: number; stage?: string }
  | { type: "round_start"; round: number }
  | { type: "user_feedback"; round: number; feedback: string; message: AiDebateMessage }
  | { type: "ai1_start"; round: number }
  | { type: "ai1_done"; round: number; message: AiDebateMessage }
  | { type: "ai2_start"; round: number }
  | { type: "ai2_done"; round: number; percentage: number; reached: boolean; message: AiDebateMessage }
  | { type: "complete"; result: AiConsensusResult }
  | { type: "error"; error: string };

export type ConsensusProgressCallback = (event: ConsensusProgressEvent) => void;

export interface ActiveDebateSession {
  sessionId: string;
  pendingFeedbacks: string[];
}

export const activeDebateSessions = new Map<string, ActiveDebateSession>();

export function registerDebateSession(sessionId: string): ActiveDebateSession {
  const existing = activeDebateSessions.get(sessionId);
  if (existing) return existing;
  const session: ActiveDebateSession = {
    sessionId,
    pendingFeedbacks: [],
  };
  activeDebateSessions.set(sessionId, session);
  return session;
}

export function sendSessionFeedback(sessionId: string, feedback: string): boolean {
  const session = activeDebateSessions.get(sessionId);
  if (!session) return false;
  session.pendingFeedbacks.push(feedback.trim());
  return true;
}

/**
 * Intelligent sanitizer for product description to prevent massive JSON payloads
 * from choking Bedrock context while retaining critical character and world rules.
 */
export function cleanProductDescription(raw?: string): string {
  if (!raw) return "";
  let text = raw.trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.prompt1) {
        const p1 = String(parsed.prompt1);
        const bibleMatch = p1.match(/CHARACTER BIBLE[\s\S]*?(?=\n\n(?:GLOBAL RULES|SCENE|$))/i);
        if (bibleMatch) {
          return bibleMatch[0].trim();
        }
        return p1.slice(0, 1500).trim();
      }
    } catch {}
  }
  if (text.length > 3000) {
    return text.slice(0, 3000) + "...";
  }
  return text;
}

export interface AiConsensusResult {
  success: boolean;
  consensus: boolean;
  rounds: number;
  promptsObj: Record<string, string>;
  debateLog: AiDebateMessage[];
  summary: string;
}

export async function callBedrock(
  systemPrompt: string,
  userPrompt: string,
  imageUrl?: string,
  jsonMode: boolean = false,
  preferredModel?: string
): Promise<string> {
  const isGlmAudit = preferredModel?.toLowerCase().includes("glm");

  // AGY Gemini 3.8 is the primary text intelligence provider. GLM-5 remains
  // deliberately separate when requested as the independent prompt auditor.
  if (!isGlmAudit && isAgyEnabled()) {
    try {
      console.log(`✨ [AGY] Trying primary model ${AGY_DEFAULT_MODEL}...`);
      const agyUserPrompt = imageUrl
        ? `${userPrompt}\n\nREFERENCE IMAGE URL (inspect it when accessible): ${imageUrl}`
        : userPrompt;
      const result = await callAgy(systemPrompt, agyUserPrompt, jsonMode);
      console.log(`✅ [AGY] Model ${AGY_DEFAULT_MODEL} responded successfully!`);
      return result;
    } catch (err: any) {
      console.warn(`⚠️ [AGY] Primary call failed (${err.message}). Falling back to Bedrock...`);
    }
  }

  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) {
    throw new Error("AWS_BEARER_TOKEN_BEDROCK is not set in environmental variables.");
  }
  const region = process.env.AWS_REGION || "us-east-1";

  const isPreferredGlm = isGlmAudit;
  const fallbackModels = preferredModel
    ? [
        preferredModel,
        ...(isPreferredGlm
          ? ["zai.glm-5", "deepseek.v3.2", "xai.grok-4.3"]
          : ["zai.glm-5", "deepseek.v3.2"])
      ]
    : ["zai.glm-5", "deepseek.v3.2"];

  let imagePart: any = null;
  if (imageUrl) {
    try {
      if (imageUrl.startsWith("data:")) {
        imagePart = {
          type: "image_url",
          image_url: {
            url: imageUrl
          }
        };
      } else {
        let fetchUrl = imageUrl;
        if (imageUrl.includes(".amazonaws.com/")) {
          const parts = imageUrl.split(".amazonaws.com/");
          if (parts.length > 1) {
            const key = parts[1];
            const port = process.env.PORT || "3400";
            fetchUrl = `http://127.0.0.1:${port}/api/products/image-proxy?key=${encodeURIComponent(key)}`;
          }
        } else if (imageUrl.startsWith("/")) {
          const port = process.env.PORT || "3400";
          fetchUrl = `http://127.0.0.1:${port}${imageUrl}`;
        }

        const response = await axios.get(fetchUrl, { responseType: "arraybuffer", timeout: 15000 });
        const contentType = String(response.headers["content-type"] ?? "image/jpeg");
        const base64Data = Buffer.from(response.data).toString("base64");
        imagePart = {
          type: "image_url",
          image_url: {
            url: `data:${contentType};base64,${base64Data}`
          }
        };
      }
    } catch (err: any) {
      console.warn(`⚠️  [Bedrock] Failed to download image for multimodal input: ${err.message}`);
    }
  }

  let lastError: Error | null = null;
  for (const modelName of fallbackModels) {
    const isResponsesRoute = modelName.toLowerCase().includes("grok") || modelName.toLowerCase().includes("gpt-oss");
    const isTextOnlyModel = modelName.toLowerCase().includes("deepseek") || isResponsesRoute;
    let currentImagePart = isTextOnlyModel ? null : imagePart;

    if (isResponsesRoute) {
      try {
        console.log(`🤖 [Bedrock Responses API] Trying model ${modelName} on /v1/responses...`);
        const res = await axios.post(
          `https://bedrock-mantle.${region}.api.aws/v1/responses`,
          {
            model: modelName,
            instructions: systemPrompt,
            input: userPrompt
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            timeout: 60000
          }
        );
        const resText = res.data?.output_text || (res.data?.output?.[0]?.content?.[0]?.text ?? "");
        if (resText) {
          console.log(`✅ [Bedrock Responses API] Model ${modelName} responded successfully!`);
          return resText.trim();
        }
        throw new Error(`Empty response from Bedrock model ${modelName}`);
      } catch (err: any) {
        const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.warn(`⚠️  [Bedrock Responses API] Model ${modelName} failed (${errMsg}). Falling back to next model...`);
        lastError = new Error(errMsg);
        continue;
      }
    }

    const endpoint = `https://bedrock-mantle.${region}.api.aws/v1/chat/completions`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`🤖 [Bedrock Chat Completions] Trying model ${modelName}${currentImagePart ? " (multimodal)" : " (text-only)"}...`);
        
        const modelMessages: any[] = [{ role: "system", content: systemPrompt }];
        if (currentImagePart) {
          modelMessages.push({
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              currentImagePart
            ]
          });
        } else {
          modelMessages.push({ role: "user", content: userPrompt });
        }

        const payload: any = {
          model: modelName,
          messages: modelMessages,
          max_tokens: 4096
        };
        if (jsonMode) {
          payload.response_format = { type: "json_object" };
        }

        const axiosResponse = await axios.post(
          endpoint,
          payload,
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            timeout: 180000,
          }
        );

        const resText = axiosResponse.data?.choices?.[0]?.message?.content || "";
        if (resText) {
          console.log(`✅ [Bedrock] Model ${modelName} responded successfully!`);
          return resText.trim();
        }
        throw new Error(`Empty response from Bedrock model ${modelName}`);
      } catch (err: any) {
        const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;

        // If error is due to image modality not supported, automatically retry with text-only
        if (currentImagePart && (errMsg.includes("image modality") || errMsg.includes("validation_error"))) {
          console.warn(`⚠️  [Bedrock] Model ${modelName} does not support image modality. Retrying with text-only...`);
          currentImagePart = null;
          continue;
        }

        console.error(`❌ [Bedrock] Failed with model ${modelName}: ${errMsg}`);
        lastError = new Error(errMsg);
        break; // try next fallback model
      }
    }
  }

  throw lastError || new Error("All Bedrock models failed");
}

export async function generateVideoPrompt(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string
): Promise<string> {
  try {
    let userMessage = `You are tasked with generating a highly detailed, cinematic video prompt for Google Veo based on the product details below.
Product name: "${productName}"
Category: ${category}`;

    if (productDescription) {
      userMessage += `\nProduct Description / Attributes: "${productDescription}"`;
    }

    userMessage += `\n\nInstructions:
1. Translate any Vietnamese details into high-quality descriptive English.
2. Build a scene description detailing: the subject (the product with its key variants/colors/materials from description), the environment/background, lighting style, camera angle, and camera motion.
3. Keep it within 1 to 3 concise, visually descriptive sentences in pure English. Do not include introductory text, conversational remarks, or explanations.`;

    const agyDraft = await callBedrock(SYSTEM_PROMPT, userMessage, imageUrl, false);
    try {
      const auditSystemPrompt = `You are GLM-5, an independent senior Google Veo prompt auditor.
Check the draft for fidelity to the supplied product, fluent English, cinematic specificity, camera feasibility, and the requested 1-3 sentence length.
Silently correct every issue you find. Output only the final validated English Veo prompt, with no score, label, explanation, or Markdown.`;
      const auditUserPrompt = `PRODUCT: "${productName}"
CATEGORY: ${category}
${productDescription ? `PRODUCT DETAILS: ${productDescription}` : ""}

AGY GEMINI 3.8 DRAFT:
${agyDraft}`;
      return await callBedrock(auditSystemPrompt, auditUserPrompt, imageUrl, false, "zai.glm-5");
    } catch (auditErr: any) {
      console.warn(`⚠️ [PromptGen] GLM-5 audit failed; returning AGY draft: ${auditErr.message}`);
      return agyDraft;
    }
  } catch (err: any) {
    console.error(`❌ [PromptGen] Bedrock API error: ${err.message}`);
    return buildFallbackPrompt(productName, category);
  }
}

export async function generateThreeVideoPrompts(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string,
  useConsensus: boolean = true
): Promise<{ prompt1: string; prompt2: string; prompt3: string }> {
  if (useConsensus) {
    try {
      const res = await generatePromptsWithAiConsensus(productName, category, imageUrl, productDescription, 3);
      if (res.promptsObj.prompt1 && res.promptsObj.prompt2 && res.promptsObj.prompt3) {
        return {
          prompt1: res.promptsObj.prompt1,
          prompt2: res.promptsObj.prompt2,
          prompt3: res.promptsObj.prompt3,
        };
      }
    } catch (consensusErr: any) {
      console.warn(`⚠️ [PromptGen] 2-AI Consensus failed, falling back to standard generation: ${consensusErr.message}`);
    }
  }
  const threePromptsSystemPrompt = `You are an expert AI Video Prompt Engineer specializing in Google Veo.
Your goal is to write a highly detailed, cinematic 3-segment video prompt series in English for a single product.
The 3 segments will be concatenated into a continuous video. Therefore, they MUST have extreme visual consistency and seamless transition flow:
- Subject & Style Consistency: The subject (product design, colors, materials), environment (background, tabletop, ambient settings), and lighting (e.g. warm studio, golden hour) must be 100% identical.
- Pacing & Motion Speed: Use consistent movement speeds (e.g. 'cinematic slow-motion' or 'slow, graceful motion') across all segments to avoid jarring tempo jumps.
- Transition & Motion Continuity:
  * Prompt 1 (Intro): Start with a macro close-up of product textures/branding. Slow dolly-in or camera pan. End with a description of a subtle camera motion.
  * Prompt 2 (Lifestyle/Usage): Transition seamlessly from the previous shot. Describe a match-cut or motion continuity (e.g., 'Continuing the smooth motion from the previous scene, the camera gently dollies out to show...'). Show the product in use or hand interaction.
  * Prompt 3 (Showcase): Transition smoothly with similar camera velocity into a heroic 360-degree rotation or wrap-around track, showcasing the product in its final presentation.
- 100% English: The final prompts must be written entirely in descriptive English. You MUST translate any Vietnamese names, features, or details into English equivalents. Do not keep raw Vietnamese words or characters in the prompts.

Each prompt must be 1 to 2 descriptive sentences in English.
You MUST output ONLY a valid JSON object matching this schema:
{
  "prompt1": "segment 1 description",
  "prompt2": "segment 2 description",
  "prompt3": "segment 3 description"
}`;

  try {
    let userMessage = `Generate 3 consistent segment prompts for product: "${productName}"
Category: ${category}`;

    if (productDescription) {
      userMessage += `\nProduct Description / Attributes: "${productDescription}"`;
    }

    userMessage += `\n\nCRITICAL: The product name and all attributes are in Vietnamese. You MUST translate them into high-quality descriptive English. Under no circumstances should the prompts contain untranslated Vietnamese words (like "ban chai", "ao thun", "dien thoai") or Vietnamese characters. Translate "Bàn Chải đánh Răng điện" to "electric toothbrush", "Kẹo Milo" to "Milo candy", etc. Output ONLY valid JSON format.`;

    const resJson = await callBedrock(threePromptsSystemPrompt, userMessage, imageUrl, true);
    const parsed = JSON.parse(resJson);
    if (parsed.prompt1 && parsed.prompt2 && parsed.prompt3) {
      console.log("✅ [PromptGen] Generated 3 consistent prompts successfully!");
      return {
        prompt1: String(parsed.prompt1),
        prompt2: String(parsed.prompt2),
        prompt3: String(parsed.prompt3)
      };
    }
    throw new Error("JSON structure did not contain prompt1, prompt2, prompt3");
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to generate 3 prompts: ${err.message}. Using fallback prompts.`);
    return buildFallbackThreePrompts(productName, category);
  }
}

function buildFallbackThreePrompts(productName: string, category: string): { prompt1: string; prompt2: string; prompt3: string } {
  const cleanName = removeVietnameseTones(productName);
  const basePrompt = buildFallbackPrompt(cleanName, category);
  return {
    prompt1: `Macro close-up shot revealing the premium textures and fine branding of ${cleanName}, slow and graceful dolly-in, soft shallow depth of field, cinematic 4K detail.`,
    prompt2: `Continuing the smooth camera motion, a medium shot of ${cleanName} showing it in practical use, consistent warm lighting, cinematic slow-motion.`,
    prompt3: `Seamlessly transitioning into a heroic wrap-around shot, a 360-degree rotating view of the entire ${cleanName} showcasing its full design in the environment, dramatic studio lighting.`
  };
}
export async function generatePromptsWithAiConsensus(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string,
  sceneCount: number = 6,
  maxRounds: number = 30,
  onProgress?: ConsensusProgressCallback,
  initialUserFeedback?: string,
  sessionId?: string,
  previousProposal?: string,
  startRound: number = 1
): Promise<AiConsensusResult> {
  const debateLog: AiDebateMessage[] = [];
  const startTime = Date.now();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🤝 [2-AI Dynamic Debate] Starting Multi-Agent Debate for "${productName}" (${sceneCount} scenes)...`);
  console.log(`   Agent 1: AGY Gemini 3.8 (Screenwriter & Visual Worldbuilder)`);
  console.log(`   Agent 2: Zhipu AI GLM-5 (Strict Quality Auditor & Character Lock Enforcer)`);
  console.log(`   Termination Condition: STRICT 100% CONSENSUS ONLY (KHÔNG GIỚI HẠN SỐ ROUND)`);
  console.log(`   Mandates: Bố cục chặt (3 lớp tiền-trung-hậu cảnh), Nội dung chặt chẽ, Nhân vật khớp 100% ảnh mô tả`);
  if (initialUserFeedback) {
    console.log(`   Director Guidance: "${initialUserFeedback}"`);
  }
  console.log(`${"=".repeat(60)}\n`);

  const allUserFeedbacks: string[] = [];
  if (initialUserFeedback && initialUserFeedback.trim()) {
    const trimmedFb = initialUserFeedback.trim();
    allUserFeedbacks.push(trimmedFb);
    const initialUserMsg: AiDebateMessage = {
      agent: "Đạo Diễn (Bạn / User)",
      model: "Human Director",
      role: "Chỉ Đạo Kịch Bản Ban Đầu",
      title: `💡 Góp Ý & Định Hướng Kịch Bản Từ Đạo Diễn`,
      content: trimmedFb,
      timestamp: new Date().toLocaleTimeString("vi-VN")
    };
    debateLog.push(initialUserMsg);
    onProgress?.({
      type: "user_feedback",
      round: startRound,
      feedback: trimmedFb,
      message: initialUserMsg
    });
  }

  if (sessionId) {
    registerDebateSession(sessionId);
  }

  const cleanedDesc = cleanProductDescription(productDescription);

  const userContext = `PRODUCT & CHARACTER BRIEF:
- Product/Story Title: "${productName}"
- Category: ${category}
${cleanedDesc ? `- Character & World Description:\n${cleanedDesc}\n` : ""}
${imageUrl ? `- Reference Image: Provided in multimodal input (strictly observe all character species, fur colors, facial features, accessories, and setting).\n` : ""}
- Required Scenes: Exactly ${sceneCount} continuous scenes.
- Target Style: High-end 3D Pixar/Disney CGI animation with vibrant warm lighting, rich details, and lovable chibi characters.`;

  const ai1BaseSystemPrompt = `You are an elite 3D Animation Screenwriter, Visual Worldbuilder (Pixar/Disney caliber), and Master Prompt Engineer for Google Veo.

YOUR FOUR SUPREME MANDATES:

1. MAXIMUM CHARACTER FIDELITY & SPECIES IDENTITY LOCK (LÀM SAO CHO NHÂN VẬT GIỐNG VỚI HÌNH MÔ TẢ NHẤT):
- Strictly match the character(s) shown in the reference image and description!
- Build and declare a rigid [CHARACTER_BIBLE] at the very beginning of your proposal:
  * Strict Species Lock: If domestic cats, they are 100% natural DOMESTIC CATS across EVERY single scene. NEVER a bear, NEVER a teddy bear, NEVER a dog, NEVER a puppy, NEVER humanoids.
  * Anatomy Lock: Cute rounded feline head, triangular cat ears with soft inner ears, large shiny black eyes, tiny feline nose, whiskers, soft rounded feline paws, single fluffy cat tail.
  * Wardrobe Lock: Exact accessories from reference/description: White Cat always wears the same pastel blue polka-dot cleaning bandana and tiny apron; Brown Cat always wears the same pastel orange polka-dot cleaning bandana and tiny apron. Never alter or remove them.
  * Natural Posture Lock: Natural quadrupedal feline postures (sitting on four paws, natural crouching, front paws pressing or wiping). No human hands, no separated fingers, no opposable thumbs, no human bipedal standing.

2. TIGHT COMPOSITION & SPATIAL STAGING (BỐ CỤC CHẶT CHẼ):
- Every scene must be meticulously staged with three distinct depth layers:
  * Foreground (Tiền cảnh): Tangible, interactive physical props with tactile textures (e.g., wooden laundry tub, fluffy white soap suds with iridescent bubbles, laundry basket, wooden floor grain, clothesline with wooden pins, glass lemonade cups).
  * Midground (Trung cảnh): Clear character interactions, playful teamwork, expressive face and eye contact, natural quadrupedal actions (never floating or misplaced).
  * Background (Hậu cảnh): Cohesive, continuous lighting and architectural environment (e.g., warm sunlit wooden home, sunny outdoor balcony, blooming potted plants, bright blue sky with soft white clouds).
- Purposeful cinematic camera angles: smooth camera pans, gentle dolly shots, eye-level close-ups, dynamic tracking shots. Zero jitter, zero floating elements, zero disorienting perspective changes.

3. TIGHT NARRATIVE CONTINUITY (NỘI DUNG CHẶT CHẼ):
- Unbroken cause-and-effect narrative progression across all ${sceneCount} scenes:
  * Scene 1: Establish world & character motivation. Joyful chore decision on a bright sunny morning.
  * Scene 2: Preparation & starting the main activity (e.g., bubbly suds in laundry tub, playful teamwork).
  * Scene 3: Rising action / progressing the task (e.g., cleaning together, handling towels/mops naturally).
  * Scene 4: Transition to destination / outdoor setting (e.g., heading to sunny balcony, carrying fresh clothes).
  * Scene 5: Joyful climax / playful highlight (e.g., hanging laundry on the clothesline, catching bubbles).
  * Scene 6: Wholesome resolution & celebration (e.g., relaxing together, sipping lemonade, pristine clean result).
- Every object, prop, and state changes naturally and carries over logically to the next scene.

4. STRICT COMPLIANCE WITH HUMAN DIRECTOR GUIDANCE (TUYỆT ĐỐI TUÂN THỦ GÓP Ý & CHỈ ĐẠO CỦA NGƯỜI DÙNG):
- If the human director / user provides feedback, critiques, or specific scene instructions (e.g. "sao lại ra 2 gấu đen ở step 2, phải là 2 chú mèo", or changes to character actions/props/background in specific scenes), you MUST IMMEDIATELY and UNCONDITIONALLY fulfill and fix those exact points!
- Never ignore, contradict, or override user feedback.

5. STUBBY CHIBI PROPORTIONS MANDATE (KHÓA TỶ LỆ CHIBI MẬP LÙN, CHỐNG BIẾN THÀNH NGƯỜI LỚN):
- For cartoon/plush/chibi characters: All characters MUST strictly be described with miniature chibi toddler proportions: oversized spherical round heads (1:1 or 1:2 head-to-body ratio), soft chubby bellies, and short stubby arms/legs with cute waddling gait.
- STRICT NEGATIVE: Explicitly forbid tall elongated bodies, adult limb proportions, or humanoid anatomy so Veo will never render them as tall humanoids!

6. SEAMLESS SCENE TRANSITION & MATCH-CUT CONTINUITY (CHUYỂN CẢNH LIỀN MẠCH, NỐI NHAU KHÔNG GIẬT KHUNG):
- Ensure unbroken visual momentum between consecutive scenes (Scene 1 -> Scene 2 -> Scene 3 -> Scene 4 -> Scene 5 -> Scene 6):
  * The ending action/pose and camera momentum of Scene N MUST seamlessly match the opening action/pose and camera angle of Scene N+1 (e.g., holding a kite in cottage -> carrying the kite stepping onto path -> running with kite in meadow).
  * Held objects, props, and room coordinates carry over seamlessly without sudden teleportation.
  * Lighting direction, color grading, and environmental continuity remain cohesive and fluid across all scenes.

LANGUAGE & SCRIPT STRUCTURE:
- Visual Prompts (prompt1..prompt${sceneCount}): 100% descriptive English for Google Veo. Start with "Cinematic 3D Pixar-style animation...". Include camera movement, 3-layer spatial layout, character anatomy, lighting, chibi proportion lock, seamless match-cut transition links, and negative prompts.
- Dialogue (dialogue1..dialogue${sceneCount}): 100% natural, heartwarming Vietnamese for children. Cute character personality dynamics.

OUTPUT FORMAT:
Provide the complete screenplay with [CHARACTER_BIBLE], followed by Scene 1 to Scene ${sceneCount}, clearly marking prompt1..prompt${sceneCount} and dialogue1..dialogue${sceneCount}.`;

  const schemaKeys = Array.from({ length: sceneCount }, (_, i) => `
  "prompt${i + 1}": "Detailed 3D Pixar animation prompt in English for Scene ${i + 1}",
  "dialogue${i + 1}": "Heartwarming dialogue in Vietnamese for Scene ${i + 1}"`).join(",");

  const ai2BaseSystemPrompt = `You are the Supreme Animation Director, Master Cinematographer, and Lead AI Prompt Auditor.
Your sole mission is to audit AI 1's 3D animation script and enforce absolute 100% perfection before granting consensus.

AUDIT CRITERIA (WEIGHTED BREAKDOWN):
1. Character Fidelity & Reference Match (Weight: 25%):
   - Are characters 100% faithful to the reference image and description?
   - SPECIES LOCK: Are species and anatomy strictly preserved across every scene?
   - CHIBI PROPORTION LOCK: Are chibi characters strictly miniature/stubby with zero adult stretching?
2. Human Director Feedback Adherence (Weight: 25% - CRITICAL GATE):
   - Did AI 1 faithfully follow and implement 100% of all feedback and critiques given by the human director?
   - If AI 1 failed to address ANY part of the user feedback, you MUST REJECT WITH consensus_percentage < 100 and consensus_reached = false!
3. Composition Tightness & 3-Layer Spatial Staging (Weight: 20%):
   - Does EVERY scene have clear foreground props, midground acting, and background atmosphere?
   - Is camera blocking purposeful, cinematic, and stable for Veo?
4. Seamless Scene Transition & Match-Cut Continuity (Weight: 15%):
   - Does each scene naturally and fluidly flow into the next scene without jarring cuts or teleports?
   - Are ending/opening character poses, camera momentum, and held props logically matched between adjacent scenes?
5. Language & Veo Feasibility (Weight: 10%):
   - Are all visual prompts 100% fluent, descriptive English with zero Vietnamese?
   - Are camera movements smooth and renderable for Veo without morphing?
6. Vietnamese Dialogue Quality (Weight: 5%):
   - Is dialogue natural, cute, and matching character emotions?

CRITICAL CONSENSUS RULE:
- You MUST only grant consensus_reached = true when ALL criteria reach 100% (consensus_percentage = 100).
- If there is ANY weakness, vagueness, slight character drift, loose composition, narrative gap, or UNRESOLVED user feedback:
  * Set consensus_percentage < 100.
  * Set consensus_reached = false.
  * Provide uncompromising, specific, numbered critique and required fixes in "critique_and_required_fixes" (in Vietnamese).
- When ALL criteria are completely satisfied with 100% perfection:
  * Set consensus_percentage = 100.
  * Set consensus_reached = true.
  * Output final prompts strictly in the JSON fields: prompt1..prompt${sceneCount} and dialogue1..dialogue${sceneCount}.

OUTPUT FORMAT (STRICT JSON ONLY):
{
  "consensus_percentage": 100,
  "consensus_reached": true,
  "character_fidelity_score": 100,
  "human_director_compliance_score": 100,
  "composition_tightness_score": 100,
  "narrative_continuity_score": 100,
  "language_compliance_score": 100,
  "dialogue_quality_score": 100,
  "critique_and_required_fixes": "Specific points that must be corrected (in Vietnamese)",
  "consensus_note": "A concise summary in Vietnamese explaining why consensus was reached",
  ${schemaKeys}
}`;

  let currentRound = startRound;
  let consensusReached = false;
  let latestAi1Proposal = previousProposal || "";
  let lastCritique = "";
  let finalPromptsObj: Record<string, string> = {};
  let finalSummary = "";

  try {
    while (!consensusReached && currentRound <= maxRounds) {
      console.log(`\n${"-".repeat(50)}`);
      console.log(`🔄 [2-AI Debate] Round ${currentRound} in progress (No round limit, debating until strict 100%)...`);
      console.log(`${"-".repeat(50)}`);

      onProgress?.({ type: "round_start", round: currentRound });

      // Drain any live feedbacks that arrived during execution
      if (sessionId && activeDebateSessions.has(sessionId)) {
        const sess = activeDebateSessions.get(sessionId)!;
        if (sess.pendingFeedbacks.length > 0) {
          const incoming = sess.pendingFeedbacks.splice(0);
          for (const fb of incoming) {
            allUserFeedbacks.push(fb);
            const liveUserMsg: AiDebateMessage = {
              agent: "Đạo Diễn (Bạn / User)",
              model: "Human Director",
              role: "Chỉ Đạo & Góp Ý Trực Tiếp",
              title: `📢 Góp Ý Trực Tiếp Của Đạo Diễn (Round ${currentRound})`,
              content: fb,
              timestamp: new Date().toLocaleTimeString("vi-VN")
            };
            debateLog.push(liveUserMsg);
            onProgress?.({
              type: "user_feedback",
              round: currentRound,
              feedback: fb,
              message: liveUserMsg
            });
          }
        }
      }

      let ai1UserPrompt = userContext;

      if (allUserFeedbacks.length > 0) {
        ai1UserPrompt += `\n\n═══════════════════════════════════════════════════════
📢 GÓP Ý & CHỈ ĐẠO TRỰC TIẾP TỪ ĐẠO DIỄN (HUMAN DIRECTOR FEEDBACK):
${allUserFeedbacks.map((fb, idx) => `${idx + 1}. ${fb}`).join("\n")}
═══════════════════════════════════════════════════════
MANDATE: You must strictly comply with 100% of the above user feedback. If the user pointed out issues in specific scenes (e.g. Scene 2 unwanted elements/animals/props), fix them immediately and thoroughly!`;
      }

      if (currentRound === startRound && previousProposal) {
        ai1UserPrompt += `\n\n═══════════════════════════════════════════════════════
PREVIOUS SCRIPT DRAFT TO REVISE FROM:
${previousProposal}
═══════════════════════════════════════════════════════
Please revise the screenplay above to incorporate all user feedback and directives perfectly.`;
      } else if (currentRound > startRound && lastCritique) {
        ai1UserPrompt += `\n\n═══════════════════════════════════════════════════════
AUDIT CRITIQUE FROM AI 2 (ROUND ${currentRound - 1} FAILED 100% CONSENSUS):
${lastCritique}
═══════════════════════════════════════════════════════
You must revise the entire proposal to address 100% of the above feedback.
Strictly ensure:
1. Characters match the reference image and description 100% (Character Bible locked, species strictly preserved).
2. All human director feedback and instructions are 100% satisfied.
3. Composition is extremely tight with 3 spatial depth layers (foreground props, midground acting, background environment).
4. Narrative is continuous and tightly connected across all ${sceneCount} scenes.`;
      }

      console.log(`🎭 [Round ${currentRound}] AI 1 (AGY Gemini 3.8) is ${currentRound === 1 && !previousProposal ? "drafting" : "revising"} proposal...`);
      onProgress?.({ type: "ai1_start", round: currentRound });

      const hb1 = setInterval(() => {
        onProgress?.({
          type: "heartbeat",
          elapsedSec: Math.floor((Date.now() - startTime) / 1000),
          currentRound,
          stage: "ai1"
        });
      }, 3000);

      try {
        latestAi1Proposal = await callBedrock(
          ai1BaseSystemPrompt,
          ai1UserPrompt,
          imageUrl,
          false,
          AGY_DEFAULT_MODEL
        );
      } finally {
        clearInterval(hb1);
      }

      const ai1Msg: AiDebateMessage = {
        agent: "AI 1 (AGY Gemini 3.8)",
        model: AGY_DEFAULT_MODEL,
        role: "Biên Kịch Hoạt Hình 3D (Kids 3D Screenwriter)",
        title: currentRound === 1 && !previousProposal
          ? (allUserFeedbacks.length > 0 ? `Đề Xuất Kịch Bản Tiếp Thu Góp Ý (Round 1)` : `Đề Xuất Kịch Bản Hoạt Hình 3D (Bản Thảo Round 1)`)
          : `Bản Kịch Bản Tiếp Thu & Khắc Phục Góp Ý (Round ${currentRound})`,
        content: latestAi1Proposal,
        timestamp: new Date().toLocaleTimeString("vi-VN")
      };
      debateLog.push(ai1Msg);
      onProgress?.({ type: "ai1_done", round: currentRound, message: ai1Msg });
      console.log(`✅ [Round ${currentRound}] AI 1 submitted proposal (${latestAi1Proposal.length} chars)`);

      // Check again if user submitted feedback while AI 1 was drafting
      if (sessionId && activeDebateSessions.has(sessionId)) {
        const sess = activeDebateSessions.get(sessionId)!;
        if (sess.pendingFeedbacks.length > 0) {
          const incoming = sess.pendingFeedbacks.splice(0);
          for (const fb of incoming) {
            allUserFeedbacks.push(fb);
            const liveUserMsg: AiDebateMessage = {
              agent: "Đạo Diễn (Bạn / User)",
              model: "Human Director",
              role: "Chỉ Đạo & Góp Ý Trực Tiếp",
              title: `📢 Góp Ý Trực Tiếp Của Đạo Diễn (Round ${currentRound})`,
              content: fb,
              timestamp: new Date().toLocaleTimeString("vi-VN")
            };
            debateLog.push(liveUserMsg);
            onProgress?.({
              type: "user_feedback",
              round: currentRound,
              feedback: fb,
              message: liveUserMsg
            });
          }
        }
      }

      console.log(`🧐 [Round ${currentRound}] AI 2 (GLM-5) is auditing for 100% consensus...`);
      onProgress?.({ type: "ai2_start", round: currentRound });

      let ai2AuditUserPrompt = `Here is AI 1's proposal for "${productName}" (Round ${currentRound}):\n\n${latestAi1Proposal}\n\nEVALUATION MANDATE:
- There is NO limit on debate rounds. Do NOT award 100% consensus unless every single requirement is 100% satisfied.
- Character fidelity must match the reference image & description 100%: exact species (cats remain cats, never bears/dogs/humanoids), exact wardrobe, exact anatomy, cute natural animal postures.
- Composition must be tight with clear 3-layer spatial depth (foreground props, midground acting, background atmosphere) and purposeful cinematic camera blocking.
- Narrative continuity must be tight with unbroken cause-and-effect progression from Scene 1 to Scene ${sceneCount}.`;

      if (allUserFeedbacks.length > 0) {
        ai2AuditUserPrompt += `\n\n═══════════════════════════════════════════════════════
📢 USER DIRECTOR MANDATE & CRITIQUE (GÓP Ý CỦA NGƯỜI DÙNG):
${allUserFeedbacks.map((fb, idx) => `${idx + 1}. ${fb}`).join("\n")}
═══════════════════════════════════════════════════════
MANDATORY AUDIT RULE: Check strictly whether AI 1 faithfully addressed 100% of the user's feedback above. If AI 1 failed to address any part of the user feedback (e.g. still has black bears in step 2), YOU MUST REJECT WITH consensus_percentage < 100 and consensus_reached = false!`;
      }

      ai2AuditUserPrompt += `\n\n- If ANY criterion is not completely flawless, you MUST set consensus_percentage < 100, consensus_reached = false, and provide specific, demanding critique in Vietnamese.
- ONLY award consensus_percentage = 100 and consensus_reached = true when the proposal is genuinely perfect.
Output STRICT JSON matching schema.`;

      const hb2 = setInterval(() => {
        onProgress?.({
          type: "heartbeat",
          elapsedSec: Math.floor((Date.now() - startTime) / 1000),
          currentRound,
          stage: "ai2"
        });
      }, 3000);

      let ai2AuditRaw = "";
      try {
        ai2AuditRaw = await callBedrock(
          ai2BaseSystemPrompt,
          ai2AuditUserPrompt,
          imageUrl,
          true,
          "zai.glm-5"
        );
      } finally {
        clearInterval(hb2);
      }

      let parsedAudit: any = {};
      try {
        let cleanJson = ai2AuditRaw.trim();
        if (cleanJson.startsWith("```")) {
          cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }
        parsedAudit = JSON.parse(cleanJson);
      } catch {
        parsedAudit = {};
      }

      const percentage = Number(parsedAudit.consensus_percentage) || 0;
      const reached = Boolean(parsedAudit.consensus_reached) && percentage === 100;
      lastCritique = 
        parsedAudit.critique_and_required_fixes || 
        "Tiếp tục hoàn thiện 100% độ khớp nhân vật, 3 lớp không gian và tính mạch lạc.";
      finalSummary = parsedAudit.consensus_note || `Đồng thuận 100% đạt được tại Round ${currentRound}.`;

      if (reached) {
        consensusReached = true;
        console.log(`🎉 [2-AI Debate] STRICT 100% CONSENSUS REACHED at Round ${currentRound}! Score: 100%`);
        
        const ai2SuccessMsg: AiDebateMessage = {
          agent: "AI 2 (Zhipu AI GLM-5)",
          model: "zai.glm-5",
          role: "Đạo Diễn & Giám Đốc Kiểm Định (Quality Auditor)",
          title: `✅ ĐỒNG THUẬN 100% HOÀN HẢO ĐẠT ĐƯỢC TẠI ROUND ${currentRound}!`,
          content: `🎯 ĐÁNH GIÁ CHẤT LƯỢNG: 100% HOÀN HẢO\n${allUserFeedbacks.length > 0 ? `- Tiếp thu góp ý Đạo diễn: ${parsedAudit.human_director_compliance_score || 100}% (Hoàn thành 100%)\n` : ""}- Độ khớp nhân vật mô tả: ${parsedAudit.character_fidelity_score || 100}%\n- Bố cục phân cảnh chặt chẽ: ${parsedAudit.composition_tightness_score || 100}%\n- Tính mạch lạc nội dung & cốt truyện: ${parsedAudit.narrative_continuity_score || 100}%\n- Ngôn ngữ tiếng Anh chuẩn Veo: ${parsedAudit.language_compliance_score || 100}%\n- Thoại Tiếng Việt tự nhiên: ${parsedAudit.dialogue_quality_score || 100}%\n\n📝 Nhận xét kiểm định:\n${finalSummary}`,
          timestamp: new Date().toLocaleTimeString("vi-VN")
        };
        debateLog.push(ai2SuccessMsg);
        onProgress?.({
          type: "ai2_done",
          round: currentRound,
          percentage: 100,
          reached: true,
          message: ai2SuccessMsg
        });

        for (let i = 1; i <= sceneCount; i++) {
          const p = parsedAudit[`prompt${i}`] || "";
          const d = parsedAudit[`dialogue${i}`] || "";
          if (p) finalPromptsObj[`prompt${i}`] = String(p);
          if (d) finalPromptsObj[`dialogue${i}`] = String(d);
        }

        if (Object.keys(finalPromptsObj).length < sceneCount && latestAi1Proposal) {
          try {
            const { parseTextPromptToObj } = await import("./scheduler.js");
            const extracted = parseTextPromptToObj(latestAi1Proposal);
            if (extracted) {
              for (let i = 1; i <= sceneCount; i++) {
                if (!finalPromptsObj[`prompt${i}`] && extracted[`prompt${i}`]) {
                  finalPromptsObj[`prompt${i}`] = extracted[`prompt${i}`];
                }
                if (!finalPromptsObj[`dialogue${i}`] && extracted[`dialogue${i}`]) {
                  finalPromptsObj[`dialogue${i}`] = extracted[`dialogue${i}`];
                }
              }
            }
          } catch {}
        }
      } else {
        console.log(`⚠️ [2-AI Debate] Round ${currentRound} Consensus Score: ${percentage}% (Requires revision)`);
        const ai2ReviewMsg: AiDebateMessage = {
          agent: "AI 2 (Zhipu AI GLM-5)",
          model: "zai.glm-5",
          role: "Đạo Diễn & Giám Đốc Kiểm Định (Quality Auditor)",
          title: `Phản Biện & Kiểm Định Chất Lượng (Round ${currentRound}: ${percentage}%)`,
          content: `⚠️ CHƯA ĐẠT 100% ĐỒNG THUẬN (Hiện tại: ${percentage}%)\n\nCÁC ĐIỂM BẮT BUỘC SỬA ĐỔI ĐỂ ĐẠT 100%:\n${lastCritique}`,
          timestamp: new Date().toLocaleTimeString("vi-VN")
        };
        debateLog.push(ai2ReviewMsg);
        onProgress?.({
          type: "ai2_done",
          round: currentRound,
          percentage,
          reached: false,
          message: ai2ReviewMsg
        });

        currentRound++;
      }
    }
  } finally {
    if (sessionId) {
      activeDebateSessions.delete(sessionId);
    }
  }

  // Fallback prompt generation if empty
  if (Object.keys(finalPromptsObj).length === 0) {
    for (let i = 1; i <= sceneCount; i++) {
      finalPromptsObj[`prompt${i}`] = `Cinematic 3D Pixar animation of ${productName}, scene ${i}, adorable character, beautiful natural sunlight, rich environment props, smooth cinematic camera motion.`;
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`\n✨ [2-AI Debate] Final Consensus completed in ${currentRound} rounds (${(durationMs / 1000).toFixed(1)}s)!`);

  const finalResult: AiConsensusResult = {
    success: true,
    consensus: true,
    rounds: currentRound,
    promptsObj: finalPromptsObj,
    debateLog,
    summary: finalSummary
  };
  onProgress?.({ type: "complete", result: finalResult });

  return finalResult;
}

export async function generateSixVideoPrompts(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string,
  useConsensus: boolean = true
): Promise<{
  prompt1: string;
  prompt2: string;
  prompt3: string;
  prompt4: string;
  prompt5: string;
  prompt6: string;
  dialogue1?: string;
  dialogue2?: string;
  dialogue3?: string;
  dialogue4?: string;
  dialogue5?: string;
  dialogue6?: string;
  voice1?: string;
  voice2?: string;
  voice3?: string;
  voice4?: string;
  voice5?: string;
  voice6?: string;
}> {
  if (useConsensus) {
    try {
      const res = await generatePromptsWithAiConsensus(productName, category, imageUrl, productDescription, 6);
      if (res.promptsObj.prompt1 && res.promptsObj.prompt2 && res.promptsObj.prompt3) {
        return {
          prompt1: res.promptsObj.prompt1 || "",
          prompt2: res.promptsObj.prompt2 || "",
          prompt3: res.promptsObj.prompt3 || "",
          prompt4: res.promptsObj.prompt4 || "",
          prompt5: res.promptsObj.prompt5 || "",
          prompt6: res.promptsObj.prompt6 || "",
          dialogue1: res.promptsObj.dialogue1,
          dialogue2: res.promptsObj.dialogue2,
          dialogue3: res.promptsObj.dialogue3,
          dialogue4: res.promptsObj.dialogue4,
          dialogue5: res.promptsObj.dialogue5,
          dialogue6: res.promptsObj.dialogue6,
        };
      }
    } catch (consensusErr: any) {
      console.warn(`⚠️ [PromptGen] 2-AI Consensus failed, falling back to standard generation: ${consensusErr.message}`);
    }
  }
  const sixPromptsSystemPrompt = `You are a world-class Vietnamese short-film screenwriter and AI Video Prompt Engineer.
Your mission: Write a 6-scene micro-movie (60 seconds total, 10 seconds per scene) that tells a complete, emotionally resonant human story — where the product naturally solves a real-life emotional or relational problem.

═══════════════════════════════════════════════════════
CORE PHILOSOPHY — THE STORY IS THE AD
═══════════════════════════════════════════════════════
The product must NOT be advertised directly. It must emerge organically as the solution to a real human emotion or relationship tension. Think of it like a Pixar short film: the product is a magical helper in a meaningful story — NOT the hero itself. The audience should feel something (nostalgia, warmth, empathy, surprise, laughter, inspiration) BEFORE they even realize they are watching an ad.

═══════════════════════════════════════════════════════
MANDATORY STORY STRUCTURE (6 SCENES × 10s)
═══════════════════════════════════════════════════════
Scene 1 — ESTABLISH THE WORLD & CHARACTERS (10s):
  - Introduce 2 to 3 lovable cartoon characters with clear roles and relationship (e.g., an old grandmother & her grandson, two childhood best friends who drifted apart, a shy child and a stray animal companion).
  - Set a vivid, specific world: NOT a generic "living room" but a cozy rainy afternoon with steam rising from a cup of tea, or a dusty sunlit school corridor.
  - The mood is warm, gentle, authentic. NO random dancing, NO forced cheering. Let the characters simply BE in their world.

Scene 2 — THE EMOTIONAL CONFLICT (10s):
  - A small but deeply felt emotional tension surfaces (NOT a comedy slapstick problem). Examples: the grandmother forgets her grandson's favorite food; the two friends realize they've become strangers; the child feels invisible and overlooked.
  - Show this through REACTIONS: a character pauses, looks down, bites their lip, holds back emotion. The camera closes in on a meaningful detail (hands, eyes, a faded photo).
  - This scene must make the audience feel — not laugh.

Scene 3 — THE DISCOVERY / TURNING POINT (10s):
  - A character notices or finds the product in a meaningful, non-commercial way (e.g., it was always there; someone else left it as a gift; it arrives at exactly the right moment).
  - The moment of discovery must feel like a small miracle or a gentle nudge of fate — NOT an "unboxing" or "product reveal".
  - Continue the emotional thread from Scene 2. DO NOT break mood with humor or sudden energy.

Scene 4 — THE PRODUCT AS BRIDGE / CATALYST (10s):
  - The product enables an action that begins to resolve the emotional tension. It brings people closer, reminds someone of something important, or creates a shared moment.
  - Show the product's function through the CHARACTERS' emotional experience — NOT through feature listing or visual specs.
  - Camera: warm medium shots, hands touching, eyes meeting, a soft smile returning.

Scene 5 — THE PEAK EMOTIONAL MOMENT (10s):
  - The emotional payoff: the tension resolves in a tender, human, and authentic way. A hug, a shared laugh with tears, a look that says everything without words, a small but meaningful gesture.
  - The product is present but secondary — what matters is the HUMAN CONNECTION it facilitated.
  - This scene should be the most beautiful and emotionally charged of the six.

Scene 6 — THE RESONANT ENDING (10s):
  - A quiet, reflective moment: the characters have changed. They're closer, warmer, wiser. The product sits naturally in the scene, no longer the focus.
  - End on a detail with symbolic weight: a smile, two cups of tea side by side, a child asleep in a grandparent's arms, two hands intertwined.
  - The final image should linger in the viewer's memory long after the video ends.

═══════════════════════════════════════════════════════
CHARACTER & DIALOGUE RULES
═══════════════════════════════════════════════════════
- Characters must feel like REAL people (or lovable cartoon representations of real people), NOT marketing mascots.
- Each character must have a distinct personality, backstory hint, and emotional arc over the 6 scenes.
- DIALOGUES (dialogue1–dialogue6) must be:
  ✅ Colloquial, authentic Vietnamese — the way real people talk, with warmth, hesitation, affection
  ✅ Character-specific — reflecting their personality and emotional state in that exact moment
  ✅ Advancing the story or revealing emotion — every line must matter
  ✅ Short enough to be read as a subtitle (max 2 lines, ~15 words per line)
  ❌ NEVER generic ad lines: "Xin chào mọi người", "Hôm nay mình sẽ giới thiệu", "Mua ngay", "Sản phẩm chất lượng"
  ❌ NEVER fourth-wall breaks or audience address
  ❌ NEVER forced enthusiasm or exclamation at irrelevant moments

Example of BAD dialogue: "Ôi trời ơi sản phẩm này xịn quá nè mọi người ơi!"
Example of GOOD dialogue: "Bà không nhớ con thích ăn cái gì rồi..." / "Con nhớ bà vẫn nhớ mà... chỉ là bà cần một chút thời gian thôi."

═══════════════════════════════════════════════════════
VISUAL PROMPT RULES
═══════════════════════════════════════════════════════
- Each visual prompt (prompt1–prompt6) must be 2–3 sentences in English only.
- Describe: character(s), their emotional state/action, environment (specific details), lighting (warm/cool/natural), camera movement (e.g., "slow push in", "gentle low-angle looking up", "handheld intimacy shot").
- Maintain visual consistency: same character designs, art style (3D Pixar/animated), color palette across all 6 scenes.
- DO NOT write text overlays or subtitle instructions inside visual prompts.
- Avoid forbidden Gemini/Veo words: 'panic', 'scared', 'scream', 'fire', 'hit', 'destroy', 'broken', 'fall', 'collision', 'blood', 'violence', 'explosive'.
- DO NOT name real copyrighted characters or IP.

═══════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT — VALID JSON ONLY)
═══════════════════════════════════════════════════════
{
  "story_title": "A short Vietnamese title for the mini-movie (e.g., Tách Trà Của Bà)",
  "story_theme": "One sentence describing the core human theme (e.g., The warmth of rediscovered connection between a grandmother and grandchild)",
  "prompt1": "English visual prompt for scene 1",
  "prompt2": "English visual prompt for scene 2",
  "prompt3": "English visual prompt for scene 3",
  "prompt4": "English visual prompt for scene 4",
  "prompt5": "English visual prompt for scene 5",
  "prompt6": "English visual prompt for scene 6",
  "dialogue1": "Colloquial Vietnamese dialogue/subtitle for scene 1",
  "dialogue2": "Colloquial Vietnamese dialogue/subtitle for scene 2",
  "dialogue3": "Colloquial Vietnamese dialogue/subtitle for scene 3",
  "dialogue4": "Colloquial Vietnamese dialogue/subtitle for scene 4",
  "dialogue5": "Colloquial Vietnamese dialogue/subtitle for scene 5",
  "dialogue6": "Colloquial Vietnamese dialogue/subtitle for scene 6"
}`;


  try {
    let userMessage = `Create a 6-scene emotionally resonant mini-movie story for this product.

PRODUCT: "${productName}"
CATEGORY: ${category}`;

    if (productDescription) {
      userMessage += `\nPRODUCT DETAILS: "${productDescription.slice(0, 800)}"`;
    }

    userMessage += `

YOUR TASK:
1. Invent a meaningful human story (NOT a product ad) where THIS product naturally solves a real emotional or relational problem.
2. Choose a specific human relationship as the emotional core (e.g., grandparent & grandchild, two estranged friends, a lonely child, a tired parent).
3. Build a 6-scene narrative arc: establish world → emotional conflict → product discovery → product as bridge → peak emotional moment → resonant ending.
4. All 6 visual prompts must be in English. Translate ALL Vietnamese product names/features into English equivalents.
5. All 6 dialogues must be colloquial, authentic Vietnamese — real human speech, NOT advertising copy.
6. Output ONLY valid JSON. Include story_title and story_theme fields.`;

    const resJson = await callBedrock(sixPromptsSystemPrompt, userMessage, imageUrl, true);
    console.log("🤖 [PromptGen] Raw Bedrock Response:\n", resJson);
    const parsed = JSON.parse(resJson);

    const getVal = (obj: any, baseKey: string, idx: number, defaultValue: string = ""): string => {
      const variants = [
        `${baseKey}${idx}`,
        `${baseKey}_${idx}`,
        `${baseKey} ${idx}`,
        `${baseKey}${idx}_vi`,
        `${baseKey}_${idx}_vi`,
        `${baseKey}${idx}Vi`,
      ];
      for (const v of variants) {
        if (obj[v] !== undefined && obj[v] !== null) return String(obj[v]);
      }
      const targetLower = `${baseKey.toLowerCase()}${idx}`;
      const targetLowerVi = `${baseKey.toLowerCase()}${idx}vi`;
      for (const [k, val] of Object.entries(obj)) {
        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleanK === targetLower || cleanK === targetLowerVi) {
          return String(val);
        }
      }
      return defaultValue;
    };

    let p1 = "", p2 = "", p3 = "", p4 = "", p5 = "", p6 = "";
    let d1 = "", d2 = "", d3 = "", d4 = "", d5 = "", d6 = "";
    let v1 = "be_trai", v2 = "be_trai", v3 = "be_trai", v4 = "be_trai", v5 = "be_trai", v6 = "be_trai";

    if (Array.isArray(parsed.prompts) && parsed.prompts.length >= 6) {
      p1 = String(parsed.prompts[0]);
      p2 = String(parsed.prompts[1]);
      p3 = String(parsed.prompts[2]);
      p4 = String(parsed.prompts[3]);
      p5 = String(parsed.prompts[4]);
      p6 = String(parsed.prompts[5]);
    } else {
      p1 = getVal(parsed, "prompt", 1);
      p2 = getVal(parsed, "prompt", 2);
      p3 = getVal(parsed, "prompt", 3);
      p4 = getVal(parsed, "prompt", 4);
      p5 = getVal(parsed, "prompt", 5);
      p6 = getVal(parsed, "prompt", 6);
    }

    if (Array.isArray(parsed.dialogues) && parsed.dialogues.length >= 6) {
      d1 = String(parsed.dialogues[0]);
      d2 = String(parsed.dialogues[1]);
      d3 = String(parsed.dialogues[2]);
      d4 = String(parsed.dialogues[3]);
      d5 = String(parsed.dialogues[4]);
      d6 = String(parsed.dialogues[5]);
    } else {
      d1 = getVal(parsed, "dialogue", 1);
      d2 = getVal(parsed, "dialogue", 2);
      d3 = getVal(parsed, "dialogue", 3);
      d4 = getVal(parsed, "dialogue", 4);
      d5 = getVal(parsed, "dialogue", 5);
      d6 = getVal(parsed, "dialogue", 6);
    }

    if (Array.isArray(parsed.voices) && parsed.voices.length >= 6) {
      v1 = String(parsed.voices[0]);
      v2 = String(parsed.voices[1]);
      v3 = String(parsed.voices[2]);
      v4 = String(parsed.voices[3]);
      v5 = String(parsed.voices[4]);
      v6 = String(parsed.voices[5]);
    } else {
      v1 = getVal(parsed, "voice", 1, "be_trai");
      v2 = getVal(parsed, "voice", 2, "be_trai");
      v3 = getVal(parsed, "voice", 3, "be_trai");
      v4 = getVal(parsed, "voice", 4, "be_trai");
      v5 = getVal(parsed, "voice", 5, "be_trai");
      v6 = getVal(parsed, "voice", 6, "be_trai");
    }

    if (p1 && p2 && p3 && p4 && p5 && p6) {
      console.log("✅ [PromptGen] Generated 6 consistent cartoon prompts successfully!");
      return {
        prompt1: p1,
        prompt2: p2,
        prompt3: p3,
        prompt4: p4,
        prompt5: p5,
        prompt6: p6,
        dialogue1: d1,
        dialogue2: d2,
        dialogue3: d3,
        dialogue4: d4,
        dialogue5: d5,
        dialogue6: d6,
        voice1: v1,
        voice2: v2,
        voice3: v3,
        voice4: v4,
        voice5: v5,
        voice6: v6
      };
    }
    throw new Error("JSON structure did not contain all 6 prompts");
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to generate 6 prompts: ${err.message}. Using fallback prompts.`);
    return buildFallbackSixPrompts(productName, category);
  }
}

function buildFallbackSixPrompts(productName: string, category: string): any {
  const cleanName = removeVietnameseTones(productName);
  return {
    prompt1: `A 10-second whimsical 3D Pixar-style animation introducing ${cleanName} on a bright, colorful stylized table, soft warm lighting, vibrant colors.`,
    prompt2: `Continuing the animation, this 10-second scene shows a cute cartoon character approaching ${cleanName} with wide curious eyes, smooth claymation style.`,
    prompt3: `Continuing the action, this 10-second scene shows the cute cartoon character happily interacting with ${cleanName}, whimsical magic sparkles in the air.`,
    prompt4: `Continuing from the previous shot, this 10-second animation has the cartoon character demonstrating the key feature of ${cleanName} with playful expressions.`,
    prompt5: `Continuing the scene, a funny 10-second micro-action occurs as the character enjoys using ${cleanName}, bright and cheerful environment.`,
    prompt6: `Concluding the cartoon animation, this 10-second outro displays a heroic final presentation of ${cleanName} with the happy characters waving in the background, Pixar style.`,
    dialogue1: `Wow, cái gì xinh xắn thế này!`,
    dialogue2: `Để mình khám phá xem có điều kỳ diệu gì nào!`,
    dialogue3: `Thật sự quá bất ngờ luôn nha!`,
    dialogue4: `Hiệu năng mượt mà thế này mới đã chứ!`,
    dialogue5: `Tiện lợi cực kỳ, giải quyết mọi lo lắng luôn!`,
    dialogue6: `Thích quá đi mất, rinh ngay một em thôi nào!`,
    voice1: "be_trai",
    voice2: "be_trai",
    voice3: "be_trai",
    voice4: "be_trai",
    voice5: "be_trai",
    voice6: "be_trai"
  };
}


export async function generateVideoDescriptionVi(
  productName: string,
  category: string = "tech",
  imageUrl?: string
): Promise<string> {
  const systemPromptVi = `You are a professional social media marketing copywriter specializing in product reviews on TikTok, Facebook Reels, and affiliate marketing.
Your goal is to write a highly detailed, beautifully structured, and persuasive product review caption in Vietnamese (Tiếng Việt).

Format requirements:
1. Start with a catchy headline with emojis (e.g., "🌟 ĐÁNH GIÁ CHI TIẾT: [Tên Sản Phẩm] 🌟")
2. Leave one blank line, then write a brief, engaging 1-sentence introduction.
3. Leave one blank line, then write "✨ Tính năng nổi bật:" followed by exactly 3 bullet points using appropriate emojis (e.g., "- 🔋 Pin cực trâu...", "- ⚡ Sạc siêu tốc...") and indenting them cleanly.
4. Leave one blank line, then write an energetic Call-To-Action (e.g., "🎁 Click giỏ hàng bên dưới góc trái video để săn ngay voucher giảm giá cực khủng hôm nay nha cả nhà!")

Rules:
- Output ONLY the final structured description in Vietnamese.
- Do NOT include any intro, outro, or explanations.
- Do NOT include hashtags (they will be appended separately).`;

  try {
    const userMessage = `Product name: "${productName}"\nCategory: ${category}\n\nGenerate structured Vietnamese caption:`;
    const desc = await callBedrock(systemPromptVi, userMessage, imageUrl, false);
    return desc;
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to generate Vietnamese caption: ${err.message}`);
    return buildFallbackDescriptionVi(productName, category);
  }
}

function buildFallbackPrompt(productName: string, category: string): string {
  const cleanName = removeVietnameseTones(productName);
  const templates: Record<string, string> = {
    tech: `Cinematic 4K close-up shot of ${cleanName} on a clean minimalist desk with soft RGB backlighting, slow panning camera revealing intricate details, shallow depth of field with bokeh background, professional studio lighting, ultra-detailed product photography style.`,
    beauty: `Luxurious close-up of ${productName} with golden liquid droplets falling in slow motion against a soft pastel background, warm diffused studio lighting, macro lens revealing smooth texture, elegant and aspirational aesthetic, 4K cinematic quality.`,
    fashion: `Stylish model confidently showcasing ${productName} on a vibrant urban street at golden hour, dynamic low-angle tracking shot, cinematic film grain, rich saturated colors, highly detailed fabric texture, lifestyle brand aesthetic.`,
    food: `Mouth-watering close-up of ${productName} with steam rising gently in a warm cozy kitchen setting, soft natural window lighting, shallow depth of field bokeh, food photography style, cinematic 4K slow motion.`,
    fitness: `Dynamic energetic shot of ${productName} in a modern gym environment, dramatic side lighting, motivated athlete in background, cinematic action angles, high contrast dramatic mood, 4K ultra-detailed.`,
    toys: `Whimsical close-up of ${cleanName} in a brightly lit colorful toy room, soft volumetric lighting, playful animations and magic sparkles, claymation style, goofy and cheerful atmosphere, ultra-detailed toy texture.`,
    household: `Warm close-up of ${cleanName} in a clean, modern cozy living room setup, soft natural ambient lighting, peaceful home atmosphere, high-definition product photography.`,
    baby: `Gentle warm close-up of ${cleanName} in a cozy pastel nursery, soft diffused nursery lighting, clean child-safe environment, sweet and whimsical aesthetic.`,
    pets: `Playful action shot of ${cleanName} in a bright cheerful pet area, warm sunny lighting, dynamic happy pet accessories in background, energetic and funny product focus.`,
  };
  return templates[category] || templates["tech"];
}

function buildFallbackDescriptionVi(productName: string, category: string): string {
  const templates: Record<string, string> = {
    tech: `🌟 CỰC PHẨM CÔNG NGHỆ: ${productName} 🌟

💻 Thiết bị đẳng cấp nâng tầm góc làm việc và trải nghiệm của bạn lên một tầm cao mới.

✨ Tính năng nổi bật:
  - ⚡ Thiết kế hiện đại, sang trọng và tối giản
  - 🎮 Hiệu năng đỉnh cao, xử lý mượt mà mọi tác vụ làm việc & giải trí
  - 🔋 Công nghệ thông minh, tiết kiệm điện năng vượt trội

🎁 Nhận ngay ưu đãi:
👉 Click giỏ hàng góc trái video để săn deal cực hời hôm nay nhé!`,

    beauty: `🌟 BÍ QUYẾT TỎA SÁNG: ${productName} 🌟

🌸 Chăm sóc da chuyên sâu mang lại vẻ rạng rỡ, tự tin cuốn hút mỗi ngày.

✨ Tính năng nổi bật:
  - 💧 Cung cấp độ ẩm dồi dào cho da mịn màng, làm dịu da tức thì
  - 🍀 Thành phần tự nhiên lành tính, an toàn tuyệt đối khi sử dụng
  - ✨ Nuôi dưỡng chuyên sâu, mang lại làn da trắng sáng khỏe mạnh

🎁 Ưu đãi độc quyền:
👉 Mua ngay tại giỏ hàng góc trái video để nhận voucher đặc biệt!`,

    fashion: `🌟 PHONG CÁCH THỜI THƯỢNG: ${productName} 🌟

👗 Đón đầu xu hướng thời trang mới nhất giúp bạn luôn nổi bật và cá tính.

✨ Tính năng nổi bật:
  - 💎 Thiết kế sang xịn mịn, đường may tỉ mỉ, tôn dáng cực tốt
  - 🧶 Chất liệu vải cao cấp, thoáng mát, co giãn thoải mái khi mặc
  - 🎨 Màu sắc trẻ trung, cực kỳ dễ dàng phối với mọi phụ kiện

🎁 Săn deal giá hời:
👉 Click ngay giỏ hàng góc dưới video để chốt đơn ngay nha!`,

    food: `🌟 THỰC PHẨM THƠM NGON: ${productName} 🌟

🍲 Bữa ăn hoàn hảo, thơm ngon trọn vị cho cả gia đình cùng thưởng thức.

✨ Tính năng nổi bật:
  - 😋 Hương vị đậm đà, chuẩn vị truyền thống cực kỳ ngon miệng
  - 🥦 Nguyên liệu sạch tự nhiên, bảo đảm an toàn vệ sinh thực phẩm
  - ⏱️ Tiết kiệm thời gian, chế biến nhanh gọn, vô cùng tiện lợi

🎁 Đặt mua ngay:
👉 Click giỏ hàng góc trái video để nhận giá ưu đãi tốt nhất!`,

    fitness: `🌟 ĐỒNG HÀNH LUYỆN TẬP: ${productName} 🌟

💪 Năng lượng bứt phá, bảo vệ và hỗ trợ tối đa cho hành trình tập luyện.

✨ Tính năng nổi bật:
  - 🏋️‍♂️ Thiết kế năng động, bảo vệ tối ưu, giảm chấn thương khi tập
  - 🏃‍♂️ Chất liệu thun dệt cao cấp, siêu thấm hút và thoáng khí tốt
  - 💎 Độ bền bỉ vượt trội, đồng hành bền lâu trong mọi bài tập nặng

🎁 Ưu đãi hôm nay:
👉 Săn ngay tại giỏ hàng bên dưới video để nhận deal hời!`,

    toys: `🌟 ĐỒ CHƠI CAO CẤP: ${productName} 🌟

🧸 Mang lại thế giới giải trí đầy sáng tạo, tiếng cười và niềm vui cho các bé mỗi ngày.

✨ Đặc điểm nổi bật:
  - 🎨 Màu sắc sinh động, thu hút kích thích trí tưởng tượng phong phú
  - 🍀 Chất liệu an toàn tuyệt đối, độ bền cao, bảo vệ sức khỏe bé yêu
  - 🧠 Phát triển tư duy logic và kỹ năng khéo léo thông qua trò chơi

🎁 Ưu đãi độc quyền:
👉 Click ngay giỏ hàng bên dưới để mang niềm vui về cho bé nhé!`,

    household: `🌟 ĐỒ GIA DỤNG TIỆN ÍCH: ${productName} 🌟

🏠 Người trợ thủ đắc lực nâng tầm tiện nghi, giúp tổ ấm của bạn luôn gọn gàng và hiện đại.

✨ Đặc điểm nổi bật:
  - 🛠️ Thiết kế thông minh tối ưu diện tích, vô cùng tiện ích khi sử dụng
  - 💎 Chất liệu cao cấp bền bỉ, dễ dàng vệ sinh làm sạch nhanh chóng
  - 🎨 Phong cách trang nhã tinh tế, phù hợp mọi không gian sống

🎁 Săn ngay giá tốt:
👉 Click giỏ hàng góc trái video để đặt mua với giá ưu đãi cực hấp dẫn!`,

    baby: `🌟 SẢN PHẨM MẸ & BÉ: ${productName} 🌟

🍼 Người bạn đồng hành chu đáo chăm sóc từng khoảnh khắc lớn khôn của bé yêu.

✨ Đặc điểm nổi bật:
  - 👶 Thiết kế vô cùng êm ái, thân thiện, bảo vệ tối đa làn da nhạy cảm của bé
  - 🍀 Nguyên liệu sạch lành tính, đáp ứng tiêu chuẩn an toàn nhi khoa
  - 🧸 Tiện dụng, giúp hành trình chăm con của mẹ trở nên nhẹ nhàng hơn

🎁 Quà tặng hấp dẫn:
👉 Bấm ngay vào giỏ hàng góc dưới để săn voucher giảm giá mẹ nhé!`,

    pets: `🌟 PHỤ KIỆN THÚ CƯNG: ${productName} 🌟

🐶 Chăm sóc chu đáo cho những người bạn bốn chân tinh nghịch luôn khỏe mạnh và hạnh phúc.

✨ Đặc điểm nổi bật:
  - 🧶 Thiết kế năng động, tạo sự thích thú tối đa cho bé cưng
  - 💎 Độ bền cao chống cắn rách tốt, cực kỳ an toàn khi sử dụng
  - 🧼 Chất liệu thoáng khí, giữ thú cưng luôn sạch sẽ và thơm mát

🎁 Deal hời cho Boss:
👉 Mua ngay tại giỏ hàng bên dưới để nhận quà tặng kèm siêu cưng!`,
  };
  return templates[category] || templates["tech"];
}

export function removeVietnameseTones(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9\s-_]/g, "");
}

/**
 * Revises specific scene prompts and dialogues (e.g. Part 3 and Part 6) based on user instructions,
 * while maintaining 3D Pixar character consistency and overall storyline flow.
 */
/**
 * Revises specific scene prompts and dialogues (e.g. Part 3 and Part 6) based on user instructions,
 * while maintaining 3D Pixar character consistency and overall storyline flow using 2-AI Debate.
 */
export async function reviseScenePrompts(
  productName: string,
  category: string = "tech",
  currentPromptsObj: Record<string, any> = {},
  sceneIndices: number[] = [2, 5], // 0-based index: 2 = Part 3, 5 = Part 6
  userFeedback: string = "",
  imageUrl?: string,
  feedbackImageUrl?: string
): Promise<{
  promptsObj: Record<string, any>;
  revisionNote?: string;
  ai1Proposal?: string;
  ai2Audit?: string;
}> {
  const targetPartNames = sceneIndices.map(i => `Part ${i + 1}`).join(", ");
  console.log(`\n🎭 [PromptGen] 2-AI Debate Revising Scene Prompts for [${targetPartNames}]...`);
  console.log(`💬 User feedback: "${userFeedback}"${feedbackImageUrl ? " [Attached Image/Screenshot for Visual Audit]" : ""}`);

  const activeVisualRef = feedbackImageUrl || imageUrl;
  const visualAuditNote = feedbackImageUrl
    ? `\n\n═══════════════════════════════════════════════════════
📸 ATTACHED SCREENSHOT / VISUAL ISSUE AUDIT (FROM HUMAN DIRECTOR):
The human director has attached an image/screenshot above showing the current rendering defect or character issue (e.g., duplicate brown fur, color confusion between white/brown bears, incorrect attire or scene composition).
INSPECT THE ATTACHED IMAGE VERY CAREFULLY! You must diagnose the visual discrepancy and ensure the revised prompts for [${targetPartNames}] fix it with 100% precision.
═══════════════════════════════════════════════════════`
    : "";

  const currentScenesSummary = [1, 2, 3, 4, 5, 6].map(i => {
    const isTarget = sceneIndices.includes(i - 1);
    const p = currentPromptsObj[`prompt${i}`] || "";
    const d = currentPromptsObj[`dialogue${i}`] || "";
    return `[Part ${i}${isTarget ? " -> CẦN SỬA LẠI THEO GÓP Ý" : " -> GIỮ NGUYÊN HOẶC TINH CHỈNH NHẸ"}]
Prompt: ${p}
Dialogue: ${d}`;
  }).join("\n\n");

  // Step 1: AI 1 (AGY Gemini 3.8) generates the creative draft.
  const ai1SystemPrompt = `You are a world-class 3D Pixar animation director and viral TikTok ad scriptwriter (AGY Gemini 3.8).
Your job is to creatively REVISE specific scenes ([${targetPartNames}]) of a 6-scene 3D cartoon video storyboard based on human director feedback and visual inspection.

CRITICAL RULES:
1. TARGET SCENES: Revise specifically [${targetPartNames}].
2. CHARACTER LOCK & DISTINCTION: Preserve the exact 3D Pixar character visual style, species, distinct colors (e.g. clearly distinguish Gấu Nâu vs Gấu Trắng/Panda), clothing, and charm across all scenes.
3. VISUAL PROMPTS: Rich cinematic 3D Pixar descriptions in ENGLISH with 3 depth layers (foreground, midground, background), camera motion, lighting, and expressions.
4. DIALOGUES: Natural, witty, heartwarming VIETNAMESE dialogue.
5. DIRECTOR FEEDBACK: You MUST faithfully follow 100% of the user's instructions and visual audit findings.${visualAuditNote}`;

  const ai1UserPrompt = `Product Name: ${productName}
Category: ${category}

CURRENT 6-SCENE STORYBOARD:
${currentScenesSummary}

HUMAN DIRECTOR INSTRUCTIONS / FEEDBACK:
"${userFeedback || "Làm cho các part được chọn sinh động, biểu cảm rõ nét và phân biệt rõ nhân vật"}"${visualAuditNote}

Please provide your creative revision draft for [${targetPartNames}] explaining your artistic choices and writing out the revised visual prompts and Vietnamese dialogues.`;

  let ai1Draft = "";
  try {
    ai1Draft = await callBedrock(ai1SystemPrompt, ai1UserPrompt, activeVisualRef, false, AGY_DEFAULT_MODEL);
  } catch (err: any) {
    console.warn(`⚠️ [PromptGen] AGY call failed for revise-scene, falling back to default model: ${err.message}`);
    ai1Draft = await callBedrock(ai1SystemPrompt, ai1UserPrompt, activeVisualRef, false);
  }

  // Step 2: AI 2 (GLM-5 / Auditor) audits the revision, verifies compliance, and generates strict JSON
  const ai2SystemPrompt = `You are the Supreme Animation Auditor & Lead Prompt Engineer (GLM-5).
Your mission is to audit AI 1's draft for [${targetPartNames}], ensure 100% compliance with user feedback, character locks/color distinctions, and output the final validated JSON schema.

OUTPUT FORMAT (STRICT JSON ONLY):
{
  "story_title": "string",
  "ai2_audit_note": "A concise professional audit summary in Vietnamese verifying adherence to user feedback and character lock",
  "revision_note": "Brief explanation in Vietnamese of changes made to ${targetPartNames}",
  "prompt1": "string",
  "prompt2": "string",
  "prompt3": "string",
  "prompt4": "string",
  "prompt5": "string",
  "prompt6": "string",
  "dialogue1": "string",
  "dialogue2": "string",
  "dialogue3": "string",
  "dialogue4": "string",
  "dialogue5": "string",
  "dialogue6": "string"
}`;

  const ai2UserPrompt = `Product Name: ${productName}
Category: ${category}

ORIGINAL STORYBOARD:
${currentScenesSummary}

HUMAN DIRECTOR INSTRUCTIONS:
"${userFeedback}"${visualAuditNote}

AI 1 (AGY GEMINI 3.8) PROPOSAL:
${ai1Draft}

Please audit AI 1's proposal, refine prompts/dialogues for perfection, and output the final 6-part screenplay JSON.`;

  try {
    const ai2ResJson = await callBedrock(ai2SystemPrompt, ai2UserPrompt, activeVisualRef, true, "zai.glm-5");
    let parsed: any;
    try {
      const cleanJson = ai2ResJson.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
      parsed = JSON.parse(cleanJson);
    } catch {
      const match = ai2ResJson.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error("Could not parse JSON from Bedrock response");
    }

    const updatedPromptsObj: Record<string, any> = { ...currentPromptsObj };
    for (let i = 1; i <= 6; i++) {
      if (parsed[`prompt${i}`]) updatedPromptsObj[`prompt${i}`] = parsed[`prompt${i}`];
      if (parsed[`dialogue${i}`]) updatedPromptsObj[`dialogue${i}`] = parsed[`dialogue${i}`];
    }
    if (parsed.story_title) updatedPromptsObj.story_title = parsed.story_title;

    return {
      promptsObj: updatedPromptsObj,
      revisionNote: parsed.revision_note || `Đã cập nhật ${targetPartNames} thành công`,
      ai1Proposal: ai1Draft,
      ai2Audit: parsed.ai2_audit_note || "Đã kiểm định 100% đạt chuẩn nhân vật và chỉ đạo đạo diễn.",
    };
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to revise scene prompts with 2-AI: ${err.message}`);
    throw err;
  }
}
