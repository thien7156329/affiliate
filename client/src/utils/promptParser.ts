/**
 * promptParser.ts — Robust parser to synchronize any prompt input format
 * (Strict JSON, relaxed JSON, scenes array, Part/Scene markdown, or plain text)
 * into a standardized Record<string, string> with prompt1..N, dialogue1..N.
 */

export function parsePromptInputToObj(input: any, fallbackSceneCount: number = 4): Record<string, string> {
  if (!input) return {};

  let rawObj: any = input;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};

    // 1. Try JSON parsing
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        rawObj = JSON.parse(trimmed);
      } catch {
        // Try fixing unquoted keys or relaxed JSON
        try {
          const relaxed = trimmed
            .replace(/,\s*([}\]])/g, '$1') // remove trailing commas
            .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":'); // quote keys
          rawObj = JSON.parse(relaxed);
        } catch {}
      }
    }
  }

  const result: Record<string, string> = {};

  // Case A: rawObj is an Array of scene objects
  if (Array.isArray(rawObj)) {
    rawObj.forEach((item: any, idx: number) => {
      const num = item.scene_index || item.scene || item.part || (idx + 1);
      const p = item.prompt || item.prompt_veo || item.visual_prompt || (typeof item === 'string' ? item : '');
      const d = item.dialogue || item.dialogue_vi || item.dialog || '';
      if (p) result[`prompt${num}`] = String(p);
      if (d) result[`dialogue${num}`] = String(d);
    });
    if (Object.keys(result).length > 0) return result;
  }

  // Case B: rawObj is an Object
  if (typeof rawObj === 'object' && rawObj !== null) {
    // Check if wrapped in scenes, prompts, storyboard, or data
    const scenesArray = Array.isArray(rawObj.scenes)
      ? rawObj.scenes
      : Array.isArray(rawObj.parts)
      ? rawObj.parts
      : Array.isArray(rawObj.storyboard)
      ? rawObj.storyboard
      : null;

    if (scenesArray) {
      scenesArray.forEach((item: any, idx: number) => {
        const num = item.scene_index || item.scene || item.part || (idx + 1);
        const p = item.prompt || item.prompt_veo || item.visual_prompt || '';
        const d = item.dialogue || item.dialogue_vi || item.dialog || '';
        if (p) result[`prompt${num}`] = String(p);
        if (d) result[`dialogue${num}`] = String(d);
      });
      if (rawObj.story_title) result.story_title = String(rawObj.story_title);
      if (Object.keys(result).length > 0) return result;
    }

    const subObj = rawObj.prompts || rawObj.storyboard || rawObj.data || rawObj;
    for (const [k, v] of Object.entries(subObj)) {
      if (typeof v === 'string') {
        const pMatch = k.match(/^(?:prompt|scene|part)[_-\s]*(\d+)$/i);
        if (pMatch) {
          result[`prompt${pMatch[1]}`] = v;
          continue;
        }
        const dMatch = k.match(/^(?:dialogue|dialog)[_-\s]*(\d+)$/i);
        if (dMatch) {
          result[`dialogue${dMatch[1]}`] = v;
          continue;
        }
        result[k] = v;
      } else if (typeof v === 'object' && v !== null) {
        const sMatch = k.match(/^(?:scene|part)[_-\s]*(\d+)$/i);
        if (sMatch) {
          const inner: any = v;
          if (inner.prompt) result[`prompt${sMatch[1]}`] = String(inner.prompt);
          if (inner.dialogue) result[`dialogue${sMatch[1]}`] = String(inner.dialogue);
        }
      }
    }

    if (Object.keys(result).some((k) => /^prompt\d+$/i.test(k))) {
      return result;
    }
  }

  // Case C: Plain text or Markdown string
  if (typeof input === 'string') {
    const text = input.trim();

    // 0. Extract Character Bible & Audio Bible if present
    const charBibleMatch = text.match(/(?:###?\s*)?\[?CHARACTER_BIBLE\]?[\s\S]*?(?=(?:###?\s*)?\[?AUDIO_AND_VOICE_BIBLE\]?|(?:###?\s*|\*\*|\b)(?:Scene|Part|Cảnh|Phân cảnh)\s*1\b|$)/i);
    if (charBibleMatch) {
      const extracted = charBibleMatch[0].replace(/^(?:###?\s*)?\[?CHARACTER_BIBLE\]?/i, '').trim();
      if (extracted.length > 10) result.character_bible = extracted;
    }

    const audioBibleMatch = text.match(/(?:###?\s*)?\[?AUDIO_AND_VOICE_BIBLE\]?[\s\S]*?(?=(?:###?\s*|\*\*|\b)(?:Scene|Part|Cảnh|Phân cảnh)\s*1\b|$)/i);
    if (audioBibleMatch) {
      const extracted = audioBibleMatch[0].replace(/^(?:###?\s*)?\[?AUDIO_AND_VOICE_BIBLE\]?/i, '').trim();
      if (extracted.length > 10) result.audio_bible = extracted;
    }

    // 1. Intelligent multi-part parser (scans Part/Scene 1..20)
    for (let i = 1; i <= 20; i++) {
      const sceneRegex = new RegExp(
        `(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*\\d+[:\\*\\s\\-]|$)`,
        'i'
      );
      const sMatch = text.match(sceneRegex);
      const sceneBlock = sMatch ? sMatch[1].trim() : '';

      let promptText = '';
      let dialogueText = '';

      if (sceneBlock) {
        // Check for visual prompt subheader
        const pInnerMatch = sceneBlock.match(/(?:\*{0,2}(?:prompt|visual prompt)\s*\d*\*{0,2}[:\s\-]+)([\s\S]*?)(?=(?:\*{0,2}(?:lời thoại|thoại|dialogue)|$))/i);
        if (pInnerMatch) {
          promptText = pInnerMatch[1].trim();
        }

        // Check for dialogue subheader
        const diaMatch = sceneBlock.match(/(?:\*{0,2}(?:lời thoại(?:\s*&\s*lồng tiếng)?(?:\s*\(vietnamese dialogue\))?|thoại tiếng việt|thoại|dialogue|vietnamese dialogue)\s*\d*\*{0,2}[:\s\-]+)([\s\S]*)$/i);
        if (diaMatch) {
          dialogueText = diaMatch[1].trim();
          if (!promptText) {
            promptText = sceneBlock.substring(0, diaMatch.index).trim();
          }
        } else if (!promptText) {
          promptText = sceneBlock;
        }
      } else {
        // Fallback: search prompt i and dialogue i directly in document
        const pMatch = text.match(new RegExp(`(?:^|\\r?\\n)[#*\`\\s-]*(?:prompt|visual prompt)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:(?:\\r?\\n)+[#*\`\\s-]*(?:dialogue|thoại|lời thoại|prompt|scene|part|cảnh|---))|$)`, 'i'));
        const dMatch = text.match(new RegExp(`(?:^|\\r?\\n)[#*\`\\s-]*(?:dialogue|thoại|lời thoại)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:(?:\\r?\\n)+[#*\`\\s-]*(?:prompt|dialogue|scene|part|cảnh|---))|$)`, 'i'));
        if (pMatch) promptText = pMatch[1].trim();
        if (dMatch) dialogueText = dMatch[1].trim();
      }

      // Clean headers from prompt text
      promptText = promptText
        .replace(/^[\s\S]*?\b(?:prompt\d*|visual prompt)[:\s\-]*/i, '')
        .replace(/^[\-_#\s*]+/, '')
        .replace(/[\-_#\s*]+$/, '')
        .trim();

      dialogueText = dialogueText
        .replace(/^[\-_#\s*]+/, '')
        .replace(/[\-_#\s*]+$/, '')
        .trim();

      if (promptText) result[`prompt${i}`] = promptText;
      if (dialogueText) result[`dialogue${i}`] = dialogueText;
    }

    if (Object.keys(result).some((k) => /^prompt\d+$/i.test(k))) {
      return result;
    }

    // 2. Legacy CẢNH / SCENE block parser
    const sceneBlocks = text.split(/(?:CẢNH|SCENE|PART)\s*(\d+)/i);
    if (sceneBlocks.length > 1) {
      for (let i = 1; i < sceneBlocks.length; i += 2) {
        const sceneNum = sceneBlocks[i];
        const blockContent = sceneBlocks[i + 1] || '';
        let promptText = '';
        let dialogueText = '';

        if (/THOẠI(?:\s*TIẾNG\s*VIỆT)?:/i.test(blockContent)) {
          const parts = blockContent.split(/THOẠI(?:\s*TIẾNG\s*VIỆT)?:/i);
          promptText = parts[0].replace(/PROMPT(?:\s*VEO)?:/i, '').replace(/^[\s=:-]+/, '').trim();
          dialogueText = (parts[1] || '').trim();
        } else if (/PROMPT(?:\s*VEO)?:/i.test(blockContent)) {
          const parts = blockContent.split(/PROMPT(?:\s*VEO)?:/i);
          promptText = (parts[1] || '').trim();
        } else {
          promptText = blockContent.replace(/^[\s=:-]+/, '').trim();
        }

        if (promptText) result[`prompt${sceneNum}`] = promptText;
        if (dialogueText) result[`dialogue${sceneNum}`] = dialogueText;
      }
      if (Object.keys(result).length > 0) return result;
    }

    // 3. Fallback: single prompt text
    result.prompt = text;
    result.prompt1 = text;
  }

  return result;
}
