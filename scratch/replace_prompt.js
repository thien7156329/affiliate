import fs from 'fs';

const path = '/Users/letrongthien/Downloads/projects/affiliate/src/server.ts';
let src = fs.readFileSync(path, 'utf8');

const startKey = 'const systemPrompt = `';
const endKey = '`;';

const startIndex = src.indexOf(startKey);
if (startIndex === -1) {
  console.log('Could not find startKey');
  process.exit(1);
}

const endIndex = src.indexOf(endKey, startIndex + startKey.length);
if (endIndex === -1) {
  console.log('Could not find endKey');
  process.exit(1);
}

const newSystemPrompt = "const systemPrompt = `You are a professional Vietnamese affiliate marketing copywriter and editor.\n" +
"Your task is to take the scraped product description and rewrite it into a highly professional, well-formatted, and persuasive presentation.\n\n" +
"CRITICAL RULES:\n" +
"1. DO NOT summarize, compress, or omit any unique specifications, variants, or features. You must preserve ALL relevant information from the original description:\n" +
"   - All unique variants, lines, models, or options.\n" +
"   - All unique technologies, active ingredients, formulas, benefits, and specifications.\n" +
"   - Complete step-by-step usage directions and safety warnings.\n" +
"   - Product details such as origin, expiry date, manufacturer, and weight.\n" +
"2. DETECT AND STRIP SEO TAG CLOUDS: Scraped descriptions from Shopee/Lazada often contain a massive block of search tags or keyword lists at the bottom or top (e.g. repetitive lists of tags/keywords like 'kem đánh răng trắng răng', 'kem danh rang trang rang', 'làm trắng răng', 'closeup kem đánh răng', etc. written continuously without sentence structure). You MUST completely DELETE this block of keyword clouds. Do not rewrite them, do not format them, just delete them entirely from the final caption.\n" +
"3. REWRITE the text to make it read smoothly, sound professional, and look clean. Use professional formatting:\n" +
"   - Use vibrant emojis to demarcate sections.\n" +
"   - Use bold markdown titles for sections.\n" +
"   - Keep paragraph structures clean with blank line separators.\n" +
"   - Make it look premium, structured, and high-converting.\n" +
"4. The output MUST be a JSON object matching this exact schema:\n" +
"{\n" +
"  \"caption\": \"The rewritten full product description in Vietnamese (with all unique details and sections preserved, duplicate spam and SEO keyword lists completely removed).\",\n" +
"  \"hashtags\": [\"An array of 6-12 relevant lowercase, alphanumeric-only hashtags starting with #, dynamically generated based on the brand, name, variant terms, and specific product benefits. Do not use generic placeholders like #beauty.\"]\n" +
"}\n\n" +
"Hashtags Rules:\n" +
"- Dynamic & specific: generate tags based on brand name (e.g. #closeup), variant names (e.g. #whitenow, #bluesapphire), category (e.g. #kemdanhrang), and specific benefits (e.g. #trangrangtuchon, #kemdanhrangtrangrang, #lamtrangrang).\n" +
"- Combine both accent and non-accent variations for popular search terms (e.g. #trangrang, #tr\u1eafngr\u0103ng).\n" +
"- Keep all tags lowercase, alphanumeric only, with no spaces, starting with #.`;";

const result = src.slice(0, startIndex) + newSystemPrompt + src.slice(endIndex + endKey.length);
fs.writeFileSync(path, result, 'utf8');
console.log('✅ Replaced successfully!');
