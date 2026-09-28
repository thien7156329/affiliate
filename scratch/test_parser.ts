function parseScenePartsFromContent(content: string) {
  const partsMap: Record<number, { prompt: string; dialogue: string }> = {};

  // 1. JSON parse attempt
  try {
    const jsonMatch = content.match(/```json([\s\S]*?)```/) || content.match(/(\{[\s\S]*"prompt\d"[\s\S]*\})/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : (content.trim().startsWith('{') && content.trim().endsWith('}') ? content.trim() : null);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      for (let i = 1; i <= 6; i++) {
        const p = parsed[`prompt${i}`] || parsed[`scene${i}`] || '';
        const d = parsed[`dialogue${i}`] || '';
        if (p || d) {
          partsMap[i] = { prompt: String(p).trim(), dialogue: String(d).trim() };
        }
      }
    }
  } catch {}

  // 2. If already found via JSON, return
  if (Object.keys(partsMap).length >= 2) {
    return Object.entries(partsMap).map(([num, val]) => ({
      partNum: parseInt(num, 10),
      prompt: val.prompt,
      dialogue: val.dialogue,
    }));
  }

  // 3. Regex parser
  for (let i = 1; i <= 6; i++) {
    // Regex for Scene/Part i header
    const sceneRegex = new RegExp(
      `(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*\\d+[:\\*\\s\\-]|$)`,
      'i'
    );
    const sMatch = content.match(sceneRegex);
    const sceneBlock = sMatch ? sMatch[1].trim() : '';

    let promptText = '';
    let dialogueText = '';

    if (sceneBlock) {
      // Find dialogue within this scene block
      const diaMatch = sceneBlock.match(/(?:\*{0,2}(?:dialogue|thoại|lời thoại)\s*\d*\*{0,2}[:\s\-]+)([\s\S]*)$/i);
      if (diaMatch) {
        dialogueText = diaMatch[1].trim();
        promptText = sceneBlock.substring(0, diaMatch.index).trim();
      } else {
        promptText = sceneBlock;
      }
    } else {
      // Fallback: search prompti and dialoguei directly
      const pMatch = content.match(new RegExp(`\\*{0,2}(?:prompt|visual prompt)\\s*${i}\\*{0,2}[:\\s\\-]+([\\s\\S]*?)(?=\\*{0,2}(?:prompt|dialogue|scene|part|cảnh)|$)`, 'i'));
      const dMatch = content.match(new RegExp(`\\*{0,2}(?:dialogue|thoại|lời thoại)\\s*${i}\\*{0,2}[:\\s\\-]+([\\s\\S]*?)(?=\\*{0,2}(?:prompt|dialogue|scene|part|cảnh)|$)`, 'i'));
      if (pMatch) promptText = pMatch[1].trim();
      if (dMatch) dialogueText = dMatch[1].trim();
    }

    // Clean markdown markers from edges
    promptText = promptText.replace(/^[\*\-_#\s]+/, '').replace(/[\*\-_#\s]+$/, '').trim();
    dialogueText = dialogueText.replace(/^[\*\-_#\s]+/, '').replace(/[\*\-_#\s]+$/, '').trim();

    if (promptText || dialogueText) {
      partsMap[i] = { prompt: promptText, dialogue: dialogueText };
    }
  }

  return Object.entries(partsMap).map(([num, val]) => ({
    partNum: parseInt(num, 10),
    prompt: val.prompt,
    dialogue: val.dialogue,
  }));
}

const sample = `
### Scene 1:
Cinematic 3D Pixar-style animation. Foreground picnic blanket...
**STRICT NEGATIVE**: No cats.

**dialogue1:**
*Tiếng chim hót*
**DuDu:** Chào BuBu!

### Scene 6:
Cinematic 3D Pixar-style animation. MATCH-CUT CONTINUITY - exact same teddy bears...
**STRICT NEGATIVE**: No cats.

**dialogue6:**
*Tiếng nước chảy*
**BuBu:** Ngon quá!
**DuDu:** Ừ em!
`;

console.log(JSON.stringify(parseScenePartsFromContent(sample), null, 2));
