import React, { useState, useMemo, memo } from 'react';
import { ChevronDown, ChevronUp, Edit3, Copy, Check, Sparkles, Film, MessageSquare, Eye, FileText, CheckCircle, AlertTriangle } from 'lucide-react';

export interface AiDebateMessage {
  agent: string;
  role: string;
  title: string;
  content: string;
  timestamp: string;
  round?: number;
  model?: string;
}

interface DebateFeedViewProps {
  messages: AiDebateMessage[];
  currentRound: number;
  isDebating: boolean;
  onOpenPartEditor?: (partNum: number, initialPrompt?: string, initialDialogue?: string) => void;
  onSavePartPrompt?: (partNum: number, newPrompt: string, newDialogue: string) => void;
  onApplyFullScript?: (parts: ParsedScenePart[], bibles: ScriptBibles) => void;
}

interface ParsedScenePart {
  partNum: number;
  prompt: string;
  dialogue: string;
}

interface ScriptBibles {
  characterBible?: string;
  audioBible?: string;
}

/**
 * Intelligent parser that extracts Character Bible, Audio Bible, and Scene/Part 1..6
 */
function parseScriptFromContent(content: string): { parts: ParsedScenePart[]; bibles: ScriptBibles } {
  const partsMap: Record<number, { prompt: string; dialogue: string }> = {};
  const bibles: ScriptBibles = {};

  // 1. Try parsing JSON if content is a JSON string or contains markdown json block
  let jsonParsed: any = null;
  try {
    const jsonMatch = content.match(/```json([\s\S]*?)```/) || content.match(/(\{[\s\S]*"prompt\d"[\s\S]*\})/);
    if (jsonMatch) {
      jsonParsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
      jsonParsed = JSON.parse(content.trim());
    }
  } catch {}

  if (jsonParsed && typeof jsonParsed === 'object') {
    for (let i = 1; i <= 20; i++) {
      const p = jsonParsed[`prompt${i}`] || jsonParsed[`scene${i}`] || '';
      const d = jsonParsed[`dialogue${i}`] || '';
      if (p || d) {
        partsMap[i] = { prompt: String(p).trim(), dialogue: String(d).trim() };
      }
    }
    if (jsonParsed.character_bible || jsonParsed.CharacterBible) {
      bibles.characterBible = String(jsonParsed.character_bible || jsonParsed.CharacterBible);
    }
    if (jsonParsed.audio_voice_bible || jsonParsed.AudioVoiceBible) {
      bibles.audioBible = String(jsonParsed.audio_voice_bible || jsonParsed.AudioVoiceBible);
    }
  }

  // 2. Extract Character Bible & Audio Bible from markdown text
  const charBibleMatch = content.match(/(?:###?\s*)?\[?CHARACTER_BIBLE\]?[\s\S]*?(?=(?:###?\s*)?\[?AUDIO_AND_VOICE_BIBLE\]?|(?:###?\s*|\*\*|\b)(?:Scene|Part|Cảnh|Phân cảnh)\s*1\b|$)/i);
  if (charBibleMatch && !bibles.characterBible) {
    const extracted = charBibleMatch[0].replace(/^(?:###?\s*)?\[?CHARACTER_BIBLE\]?/i, '').trim();
    if (extracted.length > 20) bibles.characterBible = extracted;
  }

  const audioBibleMatch = content.match(/(?:###?\s*)?\[?AUDIO_AND_VOICE_BIBLE\]?[\s\S]*?(?=(?:###?\s*|\*\*|\b)(?:Scene|Part|Cảnh|Phân cảnh)\s*1\b|$)/i);
  if (audioBibleMatch && !bibles.audioBible) {
    const extracted = audioBibleMatch[0].replace(/^(?:###?\s*)?\[?AUDIO_AND_VOICE_BIBLE\]?/i, '').trim();
    if (extracted.length > 20) bibles.audioBible = extracted;
  }

  // 3. Regex parser for scenes if JSON did not provide all parts
  if (Object.keys(partsMap).length < 2) {
    for (let i = 1; i <= 20; i++) {
      // Look for Scene i header
      const sceneRegex = new RegExp(
        `(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*\\d+[:\\*\\s\\-]|$)`,
        'i'
      );
      const sMatch = content.match(sceneRegex);
      const sceneBlock = sMatch ? sMatch[1].trim() : '';

      let promptText = '';
      let dialogueText = '';

      if (sceneBlock) {
        // Find dialogue tag within this scene block
        const diaMatch = sceneBlock.match(/(?:\*{0,2}(?:dialogue|thoại|lời thoại)\s*\d*\*{0,2}[:\s\-]+)([\s\S]*)$/i);
        if (diaMatch) {
          dialogueText = diaMatch[1].trim();
          promptText = sceneBlock.substring(0, diaMatch.index).trim();
        } else {
          promptText = sceneBlock;
        }
      } else {
        // Fallback: search prompt i and dialogue i directly
        const pMatch = content.match(new RegExp(`\\*{0,2}(?:prompt|visual prompt)\\s*${i}\\*{0,2}[:\\s\\-]+([\\s\\S]*?)(?=\\*{0,2}(?:prompt|dialogue|scene|part|cảnh)|$)`, 'i'));
        const dMatch = content.match(new RegExp(`\\*{0,2}(?:dialogue|thoại|lời thoại)\\s*${i}\\*{0,2}[:\\s\\-]+([\\s\\S]*?)(?=\\*{0,2}(?:prompt|dialogue|scene|part|cảnh)|$)`, 'i'));
        if (pMatch) promptText = pMatch[1].trim();
        if (dMatch) dialogueText = dMatch[1].trim();
      }

      // Clean leading markdown prefixes except sound effect asterisks
      promptText = promptText.replace(/^[\-_#\s]+/, '').trim();
      dialogueText = dialogueText.replace(/^[\-_#\s]+/, '').trim();

      if (promptText || dialogueText) {
        partsMap[i] = { prompt: promptText, dialogue: dialogueText };
      }
    }
  }

  const partIndices = Object.keys(partsMap).map(k => parseInt(k, 10)).sort((a, b) => a - b);
  const maxPartParsed = partIndices.length > 0 ? Math.max(6, ...partIndices) : 6;
  const results: ParsedScenePart[] = [];
  for (let i = 1; i <= maxPartParsed; i++) {
    if (partsMap[i]) {
      results.push({
        partNum: i,
        prompt: partsMap[i].prompt,
        dialogue: partsMap[i].dialogue,
      });
    }
  }

  return { parts: results, bibles };
}

/**
 * Group raw messages by Round
 */
interface RoundGroup {
  roundNum: number;
  messages: AiDebateMessage[];
  hasConsensus100: boolean;
  consensusScore?: number;
}

export const DebateFeedView: React.FC<DebateFeedViewProps> = memo(({
  messages,
  currentRound,
  isDebating,
  onOpenPartEditor,
  onSavePartPrompt,
  onApplyFullScript,
}) => {
  // Group messages by Round
  const roundGroups = useMemo<RoundGroup[]>(() => {
    if (messages.length === 0) return [];
    const groups: Record<number, AiDebateMessage[]> = {};

    messages.forEach((msg) => {
      let r = msg.round;
      if (!r) {
        const match = msg.title.match(/Round\s*(\d+)/i) || msg.content.match(/Round\s*(\d+)/i);
        r = match ? parseInt(match[1], 10) : 1;
      }
      if (!groups[r]) groups[r] = [];
      groups[r].push(msg);
    });

    const sortedRounds = Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b);

    return sortedRounds.map((rNum) => {
      const rMsgs = groups[rNum];
      const hasConsensus100 = rMsgs.some((m) => m.title.includes('100%') || m.content.includes('100%'));

      let consensusScore: number | undefined;
      for (const m of rMsgs) {
        const scoreMatch = m.title.match(/(\d+)%\s*đồng thuận/i) || m.content.match(/consensus_percentage"?\s*:\s*(\d+)/i) || m.title.match(/Round\s*\d+:\s*(\d+)%/i);
        if (scoreMatch) {
          consensusScore = parseInt(scoreMatch[1], 10);
        }
      }

      return {
        roundNum: rNum,
        messages: rMsgs,
        hasConsensus100,
        consensusScore,
      };
    });
  }, [messages]);

  // Track collapsed rounds (latest round expanded by default)
  const [collapsedRounds, setCollapsedRounds] = useState<Record<number, boolean>>({});
  const toggleRound = (rNum: number) => {
    setCollapsedRounds((prev) => ({ ...prev, [rNum]: !prev[rNum] }));
  };

  // Track active Part tab per proposal message
  const [activePartTabs, setActivePartTabs] = useState<Record<string, number | 'bible'>>({});
  // Track raw view toggle per proposal message
  const [rawViewToggles, setRawViewToggles] = useState<Record<string, boolean>>({});

  // Inline edit state
  const [editingCardKey, setEditingCardKey] = useState<string | null>(null);
  const [inlinePrompt, setInlinePrompt] = useState<string>('');
  const [inlineDialogue, setInlineDialogue] = useState<string>('');
  const [copiedPart, setCopiedPart] = useState<string | null>(null);

  const handleStartInlineEdit = (key: string, prompt: string, dialogue: string) => {
    setEditingCardKey(key);
    setInlinePrompt(prompt);
    setInlineDialogue(dialogue);
  };

  const handleSaveInlineEdit = (partNum: number) => {
    if (onSavePartPrompt) {
      onSavePartPrompt(partNum, inlinePrompt, inlineDialogue);
    }
    setEditingCardKey(null);
  };

  const handleCopyPrompt = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPart(id);
    setTimeout(() => setCopiedPart(null), 1800);
  };

  if (messages.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)', fontSize: '12px' }}>
        Chưa có phiên tranh biện 2 AI. Bấm <strong>"✨ Thảo luận 2 AI ngay"</strong> để bắt đầu.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {roundGroups.map((group) => {
        const isLatest = group.roundNum === (roundGroups[roundGroups.length - 1]?.roundNum ?? 1);
        const isCollapsed = collapsedRounds[group.roundNum] ?? (!isLatest && roundGroups.length > 2);
        const isCurrentRunning = isDebating && group.roundNum === currentRound;

        return (
          <div
            key={group.roundNum}
            style={{
              background: 'var(--bg2)',
              border: group.hasConsensus100
                ? '2px solid #10b981'
                : isCurrentRunning
                ? '2px solid #ec4899'
                : '1px solid var(--border)',
              borderRadius: '14px',
              overflow: 'hidden',
              boxShadow: group.hasConsensus100
                ? '0 0 20px rgba(16,185,129,0.22)'
                : isCurrentRunning
                ? '0 0 16px rgba(236,72,153,0.2)'
                : '0 2px 8px rgba(0,0,0,0.25)',
              transition: 'all 0.25s ease',
            }}
          >
            {/* 🌟 Big Round Header Banner */}
            <div
              onClick={() => toggleRound(group.roundNum)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: group.hasConsensus100
                  ? 'linear-gradient(90deg, rgba(16,185,129,0.25) 0%, rgba(59,130,246,0.18) 100%)'
                  : isCurrentRunning
                  ? 'linear-gradient(90deg, rgba(236,72,153,0.25) 0%, rgba(139,92,246,0.22) 100%)'
                  : 'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
                borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 900,
                    letterSpacing: '0.8px',
                    color: group.hasConsensus100 ? '#34d399' : isCurrentRunning ? '#f472b6' : '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{group.hasConsensus100 ? '🎉' : isCurrentRunning ? '🔥' : '🔄'}</span>
                  <span>ROUND {group.roundNum}</span>
                </span>

                {group.hasConsensus100 ? (
                  <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '20px', background: 'rgba(16,185,129,0.25)', color: '#34d399', border: '1.5px solid #10b981', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <CheckCircle size={13} />
                    <span>★ 100% ĐỒNG THUẬN HOÀN HẢO</span>
                  </span>
                ) : group.consensusScore !== undefined ? (
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', background: 'rgba(245,158,11,0.18)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.45)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <AlertTriangle size={13} />
                    <span>Độ khớp: {group.consensusScore}%</span>
                  </span>
                ) : isCurrentRunning ? (
                  <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', background: 'rgba(236,72,153,0.25)', color: '#f472b6', border: '1px solid #ec4899', animation: 'livePulse 1.2s infinite' }}>
                    ● Đang phản biện trực tiếp
                  </span>
                ) : null}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px', color: 'var(--muted)' }}>
                <span style={{ background: 'var(--bg3)', padding: '2px 8px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                  {group.messages.length} lượt tranh biện
                </span>
                {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </div>
            </div>

            {/* Round Messages Body */}
            {!isCollapsed && (
              <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {group.messages.map((msg, mIdx) => {
                  const msgKey = `r${group.roundNum}_m${mIdx}`;
                  const isUser = msg.agent.includes('Đạo Diễn') || msg.role.includes('Chỉ Đạo');
                  const isAi1 = msg.agent.includes('AI 1');
                  const isConsensus100 = msg.title.includes('100%');

                  // Parse proposal into 6 parts and Character/Voice bibles
                  const { parts: parsedParts, bibles } = isAi1 || isConsensus100 ? parseScriptFromContent(msg.content) : { parts: [], bibles: {} };
                  const hasParts = parsedParts.length > 0;
                  const hasBibles = Boolean(bibles.characterBible || bibles.audioBible);
                  const activeTab = activePartTabs[msgKey] ?? (hasParts ? 1 : hasBibles ? 'bible' : 1);
                  const isRawView = rawViewToggles[msgKey] ?? false;

                  const currentPartData = typeof activeTab === 'number' ? (parsedParts.find((p) => p.partNum === activeTab) || parsedParts[0]) : null;
                  const isInlineEditing = editingCardKey === `${msgKey}_p${activeTab}`;

                  return (
                    <div
                      key={mIdx}
                      style={{
                        background: isUser
                          ? 'rgba(6,182,212,0.08)'
                          : isConsensus100
                          ? 'rgba(16,185,129,0.07)'
                          : isAi1
                          ? 'rgba(139,92,246,0.06)'
                          : 'rgba(245,158,11,0.06)',
                        border: `1px solid ${
                          isUser
                            ? 'rgba(6,182,212,0.4)'
                            : isConsensus100
                            ? 'rgba(16,185,129,0.4)'
                            : isAi1
                            ? 'rgba(139,92,246,0.35)'
                            : 'rgba(245,158,11,0.35)'
                        }`,
                        borderLeftWidth: '5px',
                        borderLeftColor: isUser ? '#06b6d4' : isConsensus100 ? '#10b981' : isAi1 ? '#8b5cf6' : '#f59e0b',
                        borderRadius: '12px',
                        padding: '14px',
                      }}
                    >
                      {/* Message Author Banner */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '15px' }}>{isUser ? '👤' : isAi1 ? '🎭' : '🧐'}</span>
                          <span style={{ fontSize: '12.5px', fontWeight: 800, color: isUser ? '#22d3ee' : isConsensus100 ? '#34d399' : isAi1 ? '#c084fc' : '#fbbf24' }}>
                            {msg.agent}
                          </span>
                          <span style={{ fontSize: '10.5px', color: 'var(--muted)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                            {msg.role}
                          </span>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'monospace' }}>{msg.timestamp}</span>
                      </div>

                      {/* Message Title */}
                      <div style={{ fontSize: '13px', fontWeight: 700, color: isConsensus100 ? '#34d399' : isUser ? '#38bdf8' : '#f1f5f9', marginBottom: '10px' }}>
                        {msg.title}
                      </div>

                      {/* User Director Guidance Card */}
                      {isUser && (
                        <div style={{ background: 'var(--bg3)', border: '1px solid rgba(6,182,212,0.35)', borderRadius: '8px', padding: '12px', fontSize: '12.5px', color: '#e0f2fe', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                          {msg.content}
                        </div>
                      )}

                      {/* 🎬 Structured Proposal: Character Bible & Parts 1..6 Tabs */}
                      {!isUser && hasParts && !isRawView && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {/* Part Tab Bar */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              {hasBibles && (
                                <button
                                  type="button"
                                  onClick={() => setActivePartTabs((prev) => ({ ...prev, [msgKey]: 'bible' }))}
                                  style={{
                                    padding: '5px 11px',
                                    borderRadius: '7px',
                                    border: activeTab === 'bible' ? '1.5px solid #ec4899' : '1px solid var(--border)',
                                    background: activeTab === 'bible' ? 'rgba(236,72,153,0.25)' : 'var(--bg3)',
                                    color: activeTab === 'bible' ? '#f472b6' : 'var(--muted)',
                                    fontSize: '11px',
                                    fontWeight: activeTab === 'bible' ? 800 : 500,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                  }}
                                >
                                  🐻 Khóa Nhân Vật & Voice
                                </button>
                              )}

                              {parsedParts.map((p) => {
                                const isSelected = activeTab === p.partNum;
                                return (
                                  <button
                                    key={p.partNum}
                                    type="button"
                                    onClick={() => setActivePartTabs((prev) => ({ ...prev, [msgKey]: p.partNum }))}
                                    style={{
                                      padding: '5px 12px',
                                      borderRadius: '7px',
                                      border: isSelected ? '1.5px solid #8b5cf6' : '1px solid var(--border)',
                                      background: isSelected ? 'linear-gradient(135deg, rgba(139,92,246,0.3) 0%, rgba(124,58,237,0.2) 100%)' : 'var(--bg3)',
                                      color: isSelected ? '#ddd6fe' : 'var(--muted)',
                                      fontSize: '11.5px',
                                      fontWeight: isSelected ? 800 : 500,
                                      cursor: 'pointer',
                                      boxShadow: isSelected ? '0 0 10px rgba(139,92,246,0.3)' : 'none',
                                      transition: 'all 0.15s',
                                    }}
                                  >
                                    Part {p.partNum}
                                  </button>
                                );
                              })}
                            </div>

                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              {onApplyFullScript && (
                                <button
                                  type="button"
                                  onClick={() => onApplyFullScript(parsedParts, bibles)}
                                  style={{
                                    background: 'rgba(16, 185, 129, 0.15)',
                                    border: '1px solid rgba(16, 185, 129, 0.4)',
                                    color: '#34d399',
                                    padding: '4px 9px',
                                    borderRadius: '6px',
                                    fontSize: '10.5px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    transition: 'all 0.15s',
                                  }}
                                  title="Đồng bộ toàn bộ kịch bản và các Part từ bản thảo này vào kịch bản dự án"
                                >
                                  <CheckCircle size={12} />
                                  <span>📌 Dùng bản thảo này</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setRawViewToggles((prev) => ({ ...prev, [msgKey]: true }))}
                                style={{
                                  background: 'var(--bg3)',
                                  border: '1px solid var(--border)',
                                  color: 'var(--muted)',
                                  padding: '4px 9px',
                                  borderRadius: '6px',
                                  fontSize: '10.5px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <FileText size={12} />
                                <span>Toàn văn kịch bản</span>
                              </button>
                            </div>
                          </div>

                          {/* 🐻 Character & Voice Bible Display */}
                          {activeTab === 'bible' && hasBibles && (
                            <div style={{ background: 'var(--bg3)', border: '1px solid rgba(236,72,153,0.35)', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 800, color: '#f472b6', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Sparkles size={14} />
                                <span>HỒ SƠ KHÓA NHÂN VẬT & ÂM THANH (CHARACTER & VOICE BIBLE)</span>
                              </div>
                              {bibles.characterBible && (
                                <div style={{ background: 'var(--bg2)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '11.5px', color: '#f1f5f9', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                  {bibles.characterBible}
                                </div>
                              )}
                              {bibles.audioBible && (
                                <div style={{ background: 'var(--bg2)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '11.5px', color: '#fef08a', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                  {bibles.audioBible}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 🎬 Selected Part Display & Actions */}
                          {typeof activeTab === 'number' && currentPartData && (
                            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {/* Part Header & Action Buttons */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#c4b5fd' }}>
                                    🎬 Phân Cảnh Part {currentPartData.partNum} / 6
                                  </span>
                                </div>

                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  {/* Quick Inline Edit Toggle */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isInlineEditing) {
                                        setEditingCardKey(null);
                                      } else {
                                        handleStartInlineEdit(`${msgKey}_p${currentPartData.partNum}`, currentPartData.prompt, currentPartData.dialogue);
                                      }
                                    }}
                                    style={{
                                      background: isInlineEditing ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                                      color: isInlineEditing ? '#000' : '#e2e8f0',
                                      border: '1px solid var(--border)',
                                      padding: '5px 10px',
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '5px',
                                    }}
                                  >
                                    <Edit3 size={12} />
                                    <span>{isInlineEditing ? 'Đang sửa nhanh' : 'Sửa nhanh'}</span>
                                  </button>

                                  {/* Deep Part Editor Modal */}
                                  {onOpenPartEditor && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenPartEditor(currentPartData.partNum, currentPartData.prompt, currentPartData.dialogue)}
                                      style={{
                                        background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
                                        color: '#fff',
                                        border: 'none',
                                        padding: '5px 12px',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
                                      }}
                                    >
                                      <Sparkles size={12} />
                                      <span>✏️ Sửa Part {currentPartData.partNum} (Đầy đủ)</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Inline Edit Form */}
                              {isInlineEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg2)', padding: '10px', borderRadius: '8px', border: '1.5px solid #f59e0b' }}>
                                  <div>
                                    <label style={{ fontSize: '11px', fontWeight: 700, color: '#c4b5fd', marginBottom: '3px', display: 'block' }}>
                                      📝 Visual Prompt Part {currentPartData.partNum} (English):
                                    </label>
                                    <textarea
                                      rows={4}
                                      value={inlinePrompt}
                                      onChange={(e) => setInlinePrompt(e.target.value)}
                                      style={{ width: '100%', padding: '8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11.5px', lineHeight: 1.4, resize: 'vertical' }}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '3px', display: 'block' }}>
                                      💬 Thoại & Lồng Tiếng Part {currentPartData.partNum} (Tiếng Việt):
                                    </label>
                                    <textarea
                                      rows={3}
                                      value={inlineDialogue}
                                      onChange={(e) => setInlineDialogue(e.target.value)}
                                      style={{ width: '100%', padding: '8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11.5px', lineHeight: 1.4, resize: 'vertical' }}
                                    />
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                    <button
                                      type="button"
                                      onClick={() => setEditingCardKey(null)}
                                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '4px 10px', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}
                                    >
                                      Hủy
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveInlineEdit(currentPartData.partNum)}
                                      style={{ background: '#10b981', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <Check size={12} />
                                      <span>Lưu ngay vào kịch bản</span>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {/* Prompt Card */}
                                  {currentPartData.prompt && (
                                    <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', padding: '10px 12px', position: 'relative' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                        <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                          <Film size={12} />
                                          <span>3D PIXAR VISUAL PROMPT (GOOGLE VEO):</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleCopyPrompt(currentPartData.prompt, `p_${currentPartData.partNum}`)}
                                          title="Sao chép Prompt"
                                          style={{ background: 'transparent', border: 'none', color: copiedPart === `p_${currentPartData.partNum}` ? '#34d399' : 'var(--muted)', cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}
                                        >
                                          {copiedPart === `p_${currentPartData.partNum}` ? <Check size={12} /> : <Copy size={12} />}
                                          <span>{copiedPart === `p_${currentPartData.partNum}` ? 'Đã copy' : 'Copy'}</span>
                                        </button>
                                      </div>
                                      <div style={{ fontSize: '11.5px', color: '#f1f5f9', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                                        {currentPartData.prompt}
                                      </div>
                                    </div>
                                  )}

                                  {/* Dialogue Card */}
                                  {currentPartData.dialogue && (
                                    <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '10px 12px' }}>
                                      <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <MessageSquare size={12} />
                                        <span>LỜI THOẠI & LỒNG TIẾNG (VIETNAMESE DIALOGUE):</span>
                                      </div>
                                      <div style={{ fontSize: '12px', color: '#fef3c7', lineHeight: 1.55, fontWeight: 500, whiteSpace: 'pre-wrap' }}>
                                        {currentPartData.dialogue}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Raw Full Text View */}
                      {(!hasParts || isRawView) && !isUser && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {hasParts && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                onClick={() => setRawViewToggles((prev) => ({ ...prev, [msgKey]: false }))}
                                style={{
                                  background: 'var(--bg3)',
                                  border: '1.5px solid #8b5cf6',
                                  color: '#c4b5fd',
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                }}
                              >
                                <Eye size={12} />
                                <span>📑 Xem chia theo từng Part (1 ➔ 6)</span>
                              </button>
                            </div>
                          )}
                          <div
                            style={{
                              background: 'var(--bg3)',
                              border: '1px solid var(--border)',
                              borderRadius: '8px',
                              padding: '12px',
                              fontSize: '11.5px',
                              lineHeight: 1.55,
                              color: '#f1f5f9',
                              whiteSpace: 'pre-wrap',
                              maxHeight: '400px',
                              overflowY: 'auto',
                            }}
                          >
                            {msg.content}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
