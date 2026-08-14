/**
 * Prompt Generator — Uses Gemini Flash API (free tier) to generate
 * a Veo-optimized cinematic prompt from an affiliate product name.
 * Uses native fetch — no SDK dependency required.
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
- fitness: gym environment, motivational energy, dynamic angles, dramatic lighting`;

import axios from "axios";
import "dotenv/config";

export async function callBedrock(
  systemPrompt: string,
  userPrompt: string,
  imageUrl?: string,
  jsonMode: boolean = false
): Promise<string> {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) {
    throw new Error("AWS_BEARER_TOKEN_BEDROCK is not set in environmental variables.");
  }
  const region = process.env.AWS_REGION || "us-east-1";
  const endpoint = `https://bedrock-mantle.${region}.api.aws/v1/chat/completions`;

  const fallbackModels = [
    "moonshotai.kimi-k2.5",
    "deepseek.v3.2",
    "moonshotai.kimi-k2-thinking"
  ];

  let imagePart: any = null;
  if (imageUrl) {
    try {
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
    } catch (err: any) {
      console.warn(`⚠️  [Bedrock] Failed to download image for multimodal input: ${err.message}`);
    }
  }

  const messages: any[] = [];
  messages.push({ role: "system", content: systemPrompt });

  if (imagePart) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        imagePart
      ]
    });
  } else {
    messages.push({ role: "user", content: userPrompt });
  }

  let lastError: Error | null = null;
  for (const modelName of fallbackModels) {
    try {
      console.log(`🤖 [Bedrock] Trying model ${modelName}...`);
      const payload: any = {
        model: modelName,
        messages: messages,
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
          timeout: 60000,
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
      console.error(`❌ [Bedrock] Failed with model ${modelName}: ${errMsg}`);
      lastError = new Error(errMsg);
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

    const prompt = await callBedrock(SYSTEM_PROMPT, userMessage, imageUrl, false);
    return prompt;
  } catch (err: any) {
    console.error(`❌ [PromptGen] Bedrock API error: ${err.message}`);
    return buildFallbackPrompt(productName, category);
  }
}

export async function generateThreeVideoPrompts(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string
): Promise<{ prompt1: string; prompt2: string; prompt3: string }> {
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


