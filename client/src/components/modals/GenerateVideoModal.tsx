import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { Product, ProductCategory, EpisodeDefinition, GeneratedEpisode } from '../../types';
import { StoryboardGrid } from '../storyboard/StoryboardGrid';
import { PartEditorModal } from '../storyboard/PartEditorModal';
import { PromptValidationErrorDialog } from './PromptValidationErrorDialog';
import { YouTubePublishModal } from './YouTubePublishModal';
import { FacebookPublishModal } from './FacebookPublishModal';
import { TikTokPublishModal } from './TikTokPublishModal';
import { DebateFeedView } from '../storyboard/DebateFeedView';
import { Lightbox } from '../common/Lightbox';
import { useToast } from '../../context/ToastContext';
import { SCENE_OPTIONS, SceneSuggestion, analyzeStorySceneCount } from '../../utils/sceneAnalyzer';
import { WORLD_STYLE_OPTIONS, getWorldStyleDirective } from '../../utils/worldStyles';
import { ActiveAiModelsState, DEFAULT_AI_MODELS, fetchActiveAiModels } from '../../utils/aiModels';
import { parsePromptInputToObj } from '../../utils/promptParser';

interface GenerateVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProduct?: Product | null;
  onSuccess: () => void;
  onZoomImage: (url: string) => void;
}

export const GenerateVideoModal: React.FC<GenerateVideoModalProps> = memo(({
  isOpen,
  onClose,
  initialProduct,
  onSuccess,
  onZoomImage,
}) => {
  const { showToast } = useToast();

  // Form Fields
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState<ProductCategory>('tech');
  const [imageUrl, setImageUrl] = useState('');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [hoverRefPreview, setHoverRefPreview] = useState<{
    src: string;
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const [customPromptText, setCustomPromptText] = useState('');
  const [promptsObj, setPromptsObj] = useState<Record<string, string>>({});
  const promptsObjRef = useRef(promptsObj);
  useEffect(() => {
    promptsObjRef.current = promptsObj;
  }, [promptsObj]);
  useEffect(() => {
    fetchActiveAiModels().then(setAiModels);
  }, []);
  const [currentProductId, setCurrentProductId] = useState<string | null>(null);
  const [isSavingPromptMain, setIsSavingPromptMain] = useState(false);

  // Chrome Status
  const [chromeReady, setChromeReady] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [chromeStatusText, setChromeStatusText] = useState('Checking Chrome...');

  // 2-AI Consensus Debate
  const [aiModels, setAiModels] = useState<ActiveAiModelsState>(DEFAULT_AI_MODELS);
  const [aiConsensusEnabled, setAiConsensusEnabled] = useState(true);
  const [consensusPreFeedback, setConsensusPreFeedback] = useState('');
  const [partFeedback, setPartFeedback] = useState('');
  const [liveDebateFeedback, setLiveDebateFeedback] = useState('');
  const [isDebating, setIsDebating] = useState(false);
  const [currentDebateRound, setCurrentDebateRound] = useState<number>(1);
  const [currentActiveAi, setCurrentActiveAi] = useState<'ai1' | 'ai2' | null>(null);
  const [debateMessages, setDebateMessages] = useState<{
    agent: string;
    role: string;
    title: string;
    content: string;
    timestamp: string;
  }[]>([]);
  const [debateStatusText, setDebateStatusText] = useState('');
  const [showDebateBox, setShowDebateBox] = useState(false);
  const [debateElapsedSec, setDebateElapsedSec] = useState(0);
  const debateMessagesRef = useRef(debateMessages);
  useEffect(() => {
    debateMessagesRef.current = debateMessages;
  }, [debateMessages]);

  // Prompt Revision stream states (2-AI live interaction)
  const [isRevisingPrompts, setIsRevisingPrompts] = useState(false);
  const [revisingStage, setRevisingStage] = useState<'ai1' | 'ai2' | 'done' | null>(null);
  const [revisingElapsedSec, setRevisingElapsedSec] = useState(0);
  const [revisingStatusText, setRevisingStatusText] = useState('');
  const [revisingTargetParts, setRevisingTargetParts] = useState<number[]>([]);

  // Storyboard Part states
  const [autoSceneImages, setAutoSceneImages] = useState(true);
  const [isGeneratingAllImages, setIsGeneratingAllImages] = useState(false);
  const [generateImagesElapsedSec, setGenerateImagesElapsedSec] = useState(0);
  const [sceneImages, setSceneImages] = useState<string[]>(() => new Array(8).fill(''));
  const sceneImagesRef = useRef(sceneImages);
  useEffect(() => {
    sceneImagesRef.current = sceneImages;
  }, [sceneImages]);
  const [sceneUrls, setSceneUrls] = useState<string[]>(() => new Array(8).fill(''));
  const [drawingParts, setDrawingParts] = useState<boolean[]>(() => new Array(8).fill(false));
  const [renderingParts, setRenderingParts] = useState<boolean[]>(() => new Array(8).fill(false));
  const [selectedSceneCount, setSelectedSceneCount] = useState<number>(8);
  const [productDescription, setProductDescription] = useState('');
  const [suggestedScenes, setSuggestedScenes] = useState<SceneSuggestion | null>(null);
  const [isAnalyzingAi, setIsAnalyzingAi] = useState<boolean>(false);
  const [showSceneBreakdown, setShowSceneBreakdown] = useState<boolean>(false);
  const [worldStyle, setWorldStyle] = useState<string>('auto');
  const [visualStyle, setVisualStyle] = useState<'real' | '3d' | 'stickman'>('real');
  const [suggestedWorldStyle, setSuggestedWorldStyle] = useState<{ style: string; reason: string } | null>(null);
  const [isAnalyzingWorldStyle, setIsAnalyzingWorldStyle] = useState(false);
  const [safetyIssues, setSafetyIssues] = useState<Array<{ category: string; label: string; guidance: string; matchedTerms?: string[] }>>([]);
  const [promptValidationError, setPromptValidationError] = useState<{
    sceneIndex: number;
    attempts: number;
    issues: Array<{ type: string; text: string; reason: string }>;
    error?: string;
    currentPrompt?: string;
  } | null>(null);
  const [isPreflightChecking, setIsPreflightChecking] = useState<boolean>(false);

  const ensureGeminiSafe = async (content: string, feedback: string = ''): Promise<boolean> => {
    // Tạm thời tắt kiểm tra content safety
    setSafetyIssues([]);
    return true;
  };

  const handleAnalyzeWorldStyle = async (storyText = productDescription) => {
    const story = storyText.trim();
    if (!story) return;
    if (!await ensureGeminiSafe(story)) return;
    setIsAnalyzingWorldStyle(true);
    try {
      const res = await fetch('/api/prompts/suggest-world-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: story, product_name: productName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setSuggestedWorldStyle({ style: data.style, reason: data.reason });
      setWorldStyle(data.style);
      persistProductFeedback({ world_style: data.style });
      showToast(`🎨 AI đề xuất phong cách ${WORLD_STYLE_OPTIONS.find((item) => item.id === data.style)?.label || data.style}`);
    } catch (err: any) {
      showToast(`⚠️ Không thể phân tích phong cách: ${err.message}`);
    } finally {
      setIsAnalyzingWorldStyle(false);
    }
  };

  // Apply scene count with synchronous array resizing, DB persistence, and toast notification
  const applySceneCount = (val: number, showToastMsg: boolean = true) => {
    setSelectedSceneCount(val);
    setSceneImages((prev) => {
      if (prev.length < val) {
        return [...prev, ...new Array(val - prev.length).fill('')];
      }
      return prev.slice(0, val);
    });
    setSceneUrls((prev) => {
      if (prev.length < val) {
        return [...prev, ...new Array(val - prev.length).fill('')];
      }
      return prev.slice(0, val);
    });
    setDrawingParts(new Array(val).fill(false));
    setRenderingParts(new Array(val).fill(false));
    const nextPrompts: Record<string, string> = {};
    for (const [k, v] of Object.entries(promptsObjRef.current || {})) {
      const m = k.match(/^(?:prompt|dialogue)(\d+)$/i);
      if (m) {
        const idx = parseInt(m[1], 10);
        if (idx <= val) nextPrompts[k] = v;
      } else {
        nextPrompts[k] = v;
      }
    }
    nextPrompts._sceneCount = String(val);
    promptsObjRef.current = nextPrompts;
    setPromptsObj(nextPrompts);

    const nextEpisodes = [
      { id: 'ep_1', title: 'Tập 1 (Full Story)', startScene: 1, endScene: val }
    ];
    setEpisodes(nextEpisodes);

    // Persist chosen sceneCount & episodes to product DB immediately so reopening modal never reverts
    const targetId = currentProductId || initialProduct?.id;
    if (targetId) {
      fetch(`/api/products/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptsObj: nextPrompts,
          episodes: nextEpisodes,
        }),
      }).catch(() => {});
    }

    if (showToastMsg) {
      showToast(`🎯 Đã áp dụng phân cảnh: ${val} Cảnh (~${val * 10}s) - Mặc định Full 1 Tập`);
    }
    refreshPartsStatus(productName, val);
  };

  // Deep AI analysis of story scenes using Gemini / Codex backend
  const handleDeepAiAnalyzeScenes = async () => {
    const text = productDescription.trim();
    if (!text) {
      showToast('⚠️ Vui lòng nhập nội dung Cốt truyện gốc trước!');
      return;
    }
    if (!await ensureGeminiSafe(text)) return;
    setIsAnalyzingAi(true);
    try {
      const res = await fetch('/api/prompts/suggest-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: text,
          product_name: productName,
          use_ai: true,
        }),
      });
      const data = await res.json();
      if (data.success && data.suggested_scenes) {
        setSuggestedScenes({
          count: data.suggested_scenes,
          label: data.label,
          reason: data.reason,
          breakdown: data.breakdown,
        });
        setShowSceneBreakdown(true);
        showToast(`🤖 AI đề xuất: ${data.label}`);
      } else {
        showToast('⚠️ Không thể lấy gợi ý AI: ' + (data.error || 'Lỗi không xác định'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi kết nối AI: ' + err.message);
    } finally {
      setIsAnalyzingAi(false);
    }
  };

  const [pipelineStatusText, setPipelineStatusText] = useState('Sẵn sàng');
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [isDubbing, setIsDubbing] = useState(false);
  const isAbortRequested = useRef(false);
  const inFlightRenderingPartsRef = useRef<Set<number>>(new Set());
  const debateAbortControllerRef = useRef<AbortController | null>(null);
  const pipelineAbortControllerRef = useRef<AbortController | null>(null);

  const getDynamicSceneCount = () => {
    // The director's selection is authoritative. Extra saved prompt keys can be
    // stale after reducing an 8-scene story to 5 and must not create extra cards.
    return selectedSceneCount || 8;
  };

  // Episode boundaries state for multi-episode shorts export
  const [episodes, setEpisodes] = useState<EpisodeDefinition[]>([]);
  const [mergedEpisodesResult, setMergedEpisodesResult] = useState<GeneratedEpisode[]>([]);
  const [mergedFullUrl, setMergedFullUrl] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [showYouTubeModal, setShowYouTubeModal] = useState<boolean>(false);
  const [youtubeTarget, setYoutubeTarget] = useState<string>('full');
  const [showFacebookModal, setShowFacebookModal] = useState<boolean>(false);
  const [facebookTarget, setFacebookTarget] = useState<string>('full');
  const [showTikTokModal, setShowTikTokModal] = useState<boolean>(false);
  const [tiktokTarget, setTiktokTarget] = useState<string>('full');

  const applyPresetEpisodes = (count: number) => {
    const total = getDynamicSceneCount();
    if (count === 1) {
      setEpisodes([
        { id: 'ep_1', title: 'Tập 1 (Full Story)', startScene: 1, endScene: total }
      ]);
      showToast('✂️ Đã đặt cấu hình: 1 Tập duy nhất (Toàn bộ Scene)');
      return;
    }
    if (count === 2) {
      const mid = Math.ceil(total / 2);
      setEpisodes([
        { id: 'ep_1', title: 'Tập 1: Mở Đầu & Thách Đấu', startScene: 1, endScene: mid },
        { id: 'ep_2', title: 'Tập 2: Cao Trào & Về Đích', startScene: mid + 1, endScene: total },
      ]);
      showToast(`✂️ Đã chia 2 Tập (Tập 1: Cảnh 1..${mid}, Tập 2: Cảnh ${mid + 1}..${total})`);
      return;
    }
    if (count === 3) {
      const s1 = Math.max(1, Math.round(total / 3));
      const s2 = Math.max(s1 + 1, Math.round((2 * total) / 3));
      setEpisodes([
        { id: 'ep_1', title: 'Tập 1: Khởi Đầu & Xung Đột', startScene: 1, endScene: s1 },
        { id: 'ep_2', title: 'Tập 2: Diễn Biến & Đỉnh Điểm', startScene: s1 + 1, endScene: s2 },
        { id: 'ep_3', title: 'Tập 3: Kết Cục & Bài Học', startScene: s2 + 1, endScene: total },
      ]);
      showToast(`✂️ Đã chia 3 Tập (Cảnh 1..${s1}, ${s1 + 1}..${s2}, ${s2 + 1}..${total})`);
      return;
    }
  };

  const handleAddEpisode = () => {
    const total = getDynamicSceneCount();
    setEpisodes(prev => {
      const last = prev[prev.length - 1];
      const start = last ? Math.min(total, last.endScene + 1) : 1;
      const end = total;
      const newEp: EpisodeDefinition = {
        id: `ep_${Date.now()}`,
        title: `Tập ${prev.length + 1}`,
        startScene: start,
        endScene: end,
      };
      return [...prev, newEp];
    });
  };

  const handleRemoveEpisode = (idx: number) => {
    setEpisodes(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateEpisode = (idx: number, field: keyof EpisodeDefinition, val: any) => {
    setEpisodes(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  // Upload S3 & TikTok toggles
  const [uploadS3, setUploadS3] = useState(true);
  const [publishTiktok, setPublishTiktok] = useState(false);

  // Video Render Mode & Image Attachment Modes
  const [videoRenderMode, setVideoRenderMode] = useState<'browser'>('browser');
  const [includePrevFrame, setIncludePrevFrame] = useState<boolean | string>(true);
  const [refImagesMode, setRefImagesMode] = useState<string>('all');

  const handleSetVideoRenderMode = (_mode: 'browser') => {
    setVideoRenderMode('browser');
  };

  // Modals inside Generate
  const [editingPartNum, setEditingPartNum] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [refLightboxIndex, setRefLightboxIndex] = useState<number | null>(null);

  const handleOpenPartEditor = (partNum: number, promptOverride?: string, dialogueOverride?: string) => {
    if (promptOverride !== undefined || dialogueOverride !== undefined) {
      setPromptsObj((prev) => {
        const next = { ...prev };
        if (promptOverride !== undefined && promptOverride.trim()) {
          next[`prompt${partNum}`] = promptOverride.trim();
        }
        if (dialogueOverride !== undefined) {
          next[`dialogue${partNum}`] = dialogueOverride.trim();
        }
        promptsObjRef.current = next;
        setCustomPromptText(JSON.stringify(next, null, 2));
        persistPrompts(next).catch(console.error);
        return next;
      });
    }
    setEditingPartNum(partNum);
    refreshPartsStatus(productName);
  };

  const handleApplyFullScriptFromDebate = (parts: any[], bibles?: any) => {
    if (!parts || parts.length === 0) return;
    const next: Record<string, string> = { ...promptsObj };
    parts.forEach((p) => {
      if (p.prompt) next[`prompt${p.partNum}`] = p.prompt;
      if (p.dialogue !== undefined) next[`dialogue${p.partNum}`] = p.dialogue;
    });
    if (bibles?.characterBible) next.character_bible = bibles.characterBible;
    if (bibles?.audioBible) next.audio_bible = bibles.audioBible;

    promptsObjRef.current = next;
    setPromptsObj(next);
    setCustomPromptText(JSON.stringify(next, null, 2));
    const newCount = Object.keys(next).filter((k) => /^prompt\d+$/i.test(k)).length;
    if (newCount > 0) setSelectedSceneCount(newCount);
    persistPrompts(next).catch(console.error);
    showToast(`✅ Đã đồng bộ toàn bộ kịch bản (${parts.length} Part) vào kịch bản dự án!`);
  };

  const handleModalRefreshPartsStatus = useCallback(async () => {
    await refreshPartsStatus(productName);
  }, [productName]);

  // Refresh job parts from server (with timestamp cache buster to guarantee fresh images)
  const refreshPartsStatus = async (targetProduct = productName, explicitSceneCount?: number) => {
    const prod = targetProduct.trim();
    try {
      const countParam = explicitSceneCount || getDynamicSceneCount();
      const res = await fetch(`/api/pipeline/job-parts-status?product_name=${encodeURIComponent(prod)}&scene_count=${countParam}&_t=${Date.now()}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.parts)) {
        const now = Date.now();
        // Limit parts to countParam so we don't pick up old ghost parts beyond current scene count
        const limitedParts = data.parts.slice(0, countParam);
        const updatedImages = limitedParts.map((p: any, idx: number) => {
          const raw = p.image?.url;
          if (!raw) return '';
          const clean = raw.split('?')[0];
          const prevClean = (sceneImagesRef.current[idx] || '').split('?')[0];
          if (clean === prevClean && sceneImagesRef.current[idx]) {
            return sceneImagesRef.current[idx]; // Keep unchanged, avoid re-fetching & flicker
          }
          return `${clean}?t=${now}`;
        });
        sceneImagesRef.current = updatedImages;
        setSceneImages(updatedImages);
        setSceneUrls((prevVids) => {
          return limitedParts.map((p: any, idx: number) => {
            const raw = p.video?.url;
            if (!raw) return '';
            // If raw url (including query timestamp) is identical, keep reference to avoid player flicker
            if (prevVids[idx] && prevVids[idx] === raw) {
              return prevVids[idx];
            }
            return raw;
          });
        });
      }
    } catch (e) {
      console.warn('refreshPartsStatus error:', e);
    }
  };

  // Check Chrome status
  const checkChromeStatus = async () => {
    try {
      const res = await fetch('/api/chrome/status');
      const data = await res.json();
      if (data.ready) {
        setChromeReady(true);
        setChromeVisible(Boolean(data.visible));
        setChromeStatusText(`Chrome Ready (${data.port || 9222}) • ${data.browser || 'Chromium'}`);
      } else {
        setChromeReady(false);
        setChromeStatusText(data.message || 'Chrome is not running');
      }
    } catch {
      setChromeReady(false);
      setChromeStatusText('Chrome is not running');
    }
  };

  const handleStartChrome = async () => {
    try {
      setChromeStatusText('Starting Chrome...');
      const res = await fetch('/api/chrome/start', { method: 'POST' });
      const data = await res.json();
      if (data.ready || data.success) {
        setChromeReady(true);
        setChromeStatusText('Chrome Started!');
        showToast('🚀 Đã khởi động Chrome thành công!');
        checkChromeStatus();
      } else {
        showToast('❌ Lỗi mở Chrome: ' + (data.error || 'Unknown'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    }
  };

  const handleToggleChrome = async () => {
    try {
      if (chromeVisible) {
        const res = await fetch('/api/chrome/hide', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          setChromeVisible(false);
          showToast('🙈 Đã ẩn Chrome');
        }
      } else {
        const res = await fetch('/api/chrome/show', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          setChromeVisible(true);
          showToast('👁️ Đã hiện Chrome');
        }
      }
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    }
  };

  // Populate product info on open
  useEffect(() => {
    if (initialProduct) {
      setCurrentProductId(initialProduct.id || null);
      setProductName(initialProduct.name || '');
      setCategory(initialProduct.category || 'tech');
      const initialDesc = initialProduct.description || '';
      setProductDescription(initialDesc);
      setWorldStyle(initialProduct.world_style || 'auto');
      const savedVis = (initialProduct.promptsObj as any)?._visualStyle;
      setVisualStyle(savedVis === '3d' || savedVis === 'stickman' ? savedVis : 'real');
      setSuggestedWorldStyle(null);
      const sugg = analyzeStorySceneCount(initialDesc);
      setSuggestedScenes(sugg);
      setShowSceneBreakdown(false);

      const rawImgs = Array.isArray(initialProduct.images) && initialProduct.images.length > 0
        ? initialProduct.images.filter((u: any) => typeof u === 'string' && u.trim().length > 0)
        : (initialProduct.image_url ? [initialProduct.image_url] : []);
      setGalleryImages(rawImgs);
      const img = initialProduct.image_url || rawImgs[0] || '';
      setImageUrl(img);

      let targetSceneCount = 8;
      if (initialProduct.promptsObj) {
        setPromptsObj(initialProduct.promptsObj);
        promptsObjRef.current = initialProduct.promptsObj;
        setCustomPromptText(JSON.stringify(initialProduct.promptsObj, null, 2));
        const savedCount = Number((initialProduct.promptsObj as any)._sceneCount);
        const pKeys = Object.keys(initialProduct.promptsObj).map(k => {
          const m = k.match(/^prompt(\d+)$/i);
          return m ? parseInt(m[1], 10) : 0;
        }).filter(n => n > 0);
        if (Number.isFinite(savedCount) && savedCount > 0) {
          targetSceneCount = savedCount;
        } else if (pKeys.length > 0) {
          targetSceneCount = Math.max(...pKeys);
        } else if (initialProduct.episodes && initialProduct.episodes.length > 0) {
          const maxEpEnd = Math.max(...initialProduct.episodes.map((ep: any) => Number(ep.endScene) || 0));
          if (maxEpEnd > 0) targetSceneCount = maxEpEnd;
        }
      } else {
        setPromptsObj({});
        promptsObjRef.current = {};
        setCustomPromptText('');
        if (initialProduct.episodes && initialProduct.episodes.length > 0) {
          const maxEpEnd = Math.max(...initialProduct.episodes.map((ep: any) => Number(ep.endScene) || 0));
          if (maxEpEnd > 0) targetSceneCount = maxEpEnd;
        }
      }
      setSelectedSceneCount(targetSceneCount);

      if (initialProduct.id) {
        fetch(`/api/products/${initialProduct.id}`)
          .then((res) => res.json())
          .then((resData) => {
            const p = resData.data || resData;
            if (p && p.promptsObj && Object.keys(p.promptsObj).length > 0) {
              promptsObjRef.current = p.promptsObj;
              setPromptsObj(p.promptsObj);
              setCustomPromptText(JSON.stringify(p.promptsObj, null, 2));
              if ((p.promptsObj as any)._visualStyle === '3d' || (p.promptsObj as any)._visualStyle === 'real' || (p.promptsObj as any)._visualStyle === 'stickman') {
                setVisualStyle((p.promptsObj as any)._visualStyle);
              }
              const dbSavedCount = Number((p.promptsObj as any)._sceneCount);
              const dbPKeys = Object.keys(p.promptsObj).map(k => {
                const m = k.match(/^prompt(\d+)$/i);
                return m ? parseInt(m[1], 10) : 0;
              }).filter(n => n > 0);
              const resolvedCount =
                Number.isFinite(dbSavedCount) && dbSavedCount > 0
                  ? dbSavedCount
                  : dbPKeys.length > 0
                    ? Math.max(...dbPKeys)
                    : targetSceneCount;
              setSelectedSceneCount(resolvedCount);
            }
          })
          .catch(() => {});
      }

      setConsensusPreFeedback(initialProduct.consensus_feedback || '');
      setPartFeedback(initialProduct.part_feedback || '');
      // ── Reset ALL debate state when switching products ──
      setDebateStatusText('');
      setDebateElapsedSec(0);
      setCurrentDebateRound(1);
      setCurrentActiveAi(null);
      setIsDebating(false);
      setLiveDebateFeedback('');
      if (initialProduct.debate_messages && initialProduct.debate_messages.length > 0) {
        setDebateMessages(initialProduct.debate_messages);
        setShowDebateBox(true);
      } else {
        setDebateMessages([]);
        setShowDebateBox(false);
      }

      // ── Reset revision state ──
      setIsRevisingPrompts(false);
      setRevisingStage(null);
      setRevisingElapsedSec(0);
      setRevisingStatusText('');
      setRevisingTargetParts([]);

      // ── Reset scene images/urls to match current product ──
      const emptyImages = new Array(targetSceneCount).fill('');
      const emptyUrls = new Array(targetSceneCount).fill('');
      // CRITICAL: Clear the ref SYNCHRONOUSLY before refreshPartsStatus
      // so the ref-based dedup logic doesn't retain old product's images
      sceneImagesRef.current = emptyImages;
      setSceneImages(emptyImages);
      setSceneUrls(emptyUrls);
      setDrawingParts(new Array(targetSceneCount).fill(false));
      setRenderingParts(new Array(targetSceneCount).fill(false));
      // Reset additional pipeline states
      setIsGeneratingAllImages(false);
      setGenerateImagesElapsedSec(0);
      setIsDubbing(false);

      // Mặc định lúc nào cũng là Full 1 Tập
      if (initialProduct.episodes && initialProduct.episodes.length > 1) {
        setEpisodes(initialProduct.episodes);
      } else if (initialProduct.promptsObj && (initialProduct.promptsObj as any).episodes && Array.isArray((initialProduct.promptsObj as any).episodes) && (initialProduct.promptsObj as any).episodes.length > 1) {
        setEpisodes((initialProduct.promptsObj as any).episodes);
      } else {
        setEpisodes([
          { id: 'ep_1', title: 'Tập 1 (Full Story)', startScene: 1, endScene: targetSceneCount },
        ]);
      }
      setMergedEpisodesResult([]);
      setMergedFullUrl(null);

      // Delay refreshPartsStatus slightly to let React flush the empty state first
      // so users see a clean slate before new data arrives
      setTimeout(() => refreshPartsStatus(initialProduct.name || '', targetSceneCount), 50);
    } else {
      setCurrentProductId(null);
      setProductName('');
      setCategory('tech');
      setProductDescription('');
      setWorldStyle('auto');
      setVisualStyle('real');
      setSuggestedWorldStyle(null);
      setSuggestedScenes(null);
      setShowSceneBreakdown(false);
      setImageUrl('');
      setGalleryImages([]);
      setPromptsObj({});
      setCustomPromptText('');
      // CRITICAL: Clear ref synchronously
      sceneImagesRef.current = new Array(8).fill('');
      setSceneImages(new Array(8).fill(''));
      setSceneUrls(new Array(8).fill(''));
      setDrawingParts(new Array(8).fill(false));
      setRenderingParts(new Array(8).fill(false));
      setIsGeneratingAllImages(false);
      setGenerateImagesElapsedSec(0);
      setIsDubbing(false);
      setConsensusPreFeedback('');
      setPartFeedback('');
      // ── Reset ALL debate state ──
      setDebateMessages([]);
      setShowDebateBox(false);
      setDebateStatusText('');
      setDebateElapsedSec(0);
      setCurrentDebateRound(1);
      setCurrentActiveAi(null);
      setIsDebating(false);
      setLiveDebateFeedback('');
      // ── Reset revision state ──
      setIsRevisingPrompts(false);
      setRevisingStage(null);
      setRevisingElapsedSec(0);
      setRevisingStatusText('');
      setRevisingTargetParts([]);
      setSelectedSceneCount(8);
      setEpisodes([
        { id: 'ep_1', title: 'Tập 1 (Full Story)', startScene: 1, endScene: 8 },
      ]);
      setMergedEpisodesResult([]);
      setMergedFullUrl(null);
    }

    setPipelineStatusText('Sẵn sàng');
    setIsPipelineRunning(false);
    isAbortRequested.current = false;

    if (isOpen) {
      checkChromeStatus();
    }
  }, [initialProduct, isOpen]);

  if (!isOpen) return null;

  // Handle custom prompt edit & immediate sync to promptsObj
  const handleCustomPromptChange = (val: string) => {
    setCustomPromptText(val);
    const parsed = parsePromptInputToObj(val, selectedSceneCount);
    if (parsed && Object.keys(parsed).length > 0) {
      setPromptsObj(parsed);
      promptsObjRef.current = parsed;
      const newCount = Object.keys(parsed).filter((k) => /^prompt\d+$/i.test(k)).length;
      if (newCount > 0) setSelectedSceneCount(newCount);
    }
  };

  const handleCustomPromptBlur = () => {
    if (!customPromptText.trim()) return;
    const parsed = parsePromptInputToObj(customPromptText, selectedSceneCount);
    if (parsed && Object.keys(parsed).length > 0) {
      setPromptsObj(parsed);
      promptsObjRef.current = parsed;
      const newCount = Object.keys(parsed).filter((k) => /^prompt\d+$/i.test(k)).length;
      if (newCount > 0) setSelectedSceneCount(newCount);
      // Auto-format cleanly if structured prompts exist
      if (Object.keys(parsed).some((k) => /^prompt\d+$/i.test(k))) {
        setCustomPromptText(JSON.stringify(parsed, null, 2));
      }
      persistPrompts(parsed).catch(console.error);
    }
  };

  // Helper to persist feedbacks and debate messages to DB
  const persistProductFeedback = async (overrides?: {
    consensus_feedback?: string;
    part_feedback?: string;
    debate_messages?: any[];
    description?: string;
    world_style?: string;
  }) => {
    const trimmedName = productName.trim();
    if (!trimmedName) return;

    let targetId = currentProductId || initialProduct?.id;
    if (!targetId) {
      try {
        const checkRes = await fetch('/api/products');
        const checkData = await checkRes.json();
        if (checkData.success && Array.isArray(checkData.data)) {
          const found = checkData.data.find(
            (p: any) => p.name && p.name.trim().toLowerCase() === trimmedName.toLowerCase()
          );
          if (found) targetId = found.id;
        }
      } catch (err) {
        console.error('Error finding product for feedback persistence:', err);
      }
    }

    if (!targetId) return;

    const payload: Record<string, any> = {
      consensus_feedback: overrides?.consensus_feedback !== undefined ? overrides.consensus_feedback : consensusPreFeedback,
      part_feedback: overrides?.part_feedback !== undefined ? overrides.part_feedback : partFeedback,
      debate_messages: overrides?.debate_messages !== undefined ? overrides.debate_messages : debateMessagesRef.current,
      ...(overrides?.description !== undefined ? { description: overrides.description } : (productDescription ? { description: productDescription } : {})),
      world_style: overrides?.world_style !== undefined ? overrides.world_style : worldStyle,
    };

    try {
      await fetch(`/api/products/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('Error persisting feedback:', err);
    }
  };

  // Check product on blur to load existing feedback or clear for new product
  const handleProductNameBlur = async () => {
    const trimmed = productName.trim();
    refreshPartsStatus(trimmed);
    if (!trimmed) {
      setCurrentProductId(null);
      setConsensusPreFeedback('');
      setPartFeedback('');
      setDebateMessages([]);
      setShowDebateBox(false);
      return;
    }
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const found = data.data.find(
          (p: any) => p.name && p.name.trim().toLowerCase() === trimmed.toLowerCase()
        );
        if (found) {
          setCurrentProductId(found.id);
          setCategory(found.category || 'tech');
          setWorldStyle(found.world_style || 'auto');
          if (!productDescription.trim() && found.description) {
            setProductDescription(found.description);
          }
          const rawImgs = Array.isArray(found.images) && found.images.length > 0
            ? found.images.filter((u: any) => typeof u === 'string' && u.trim().length > 0)
            : (found.image_url ? [found.image_url] : []);
          if (galleryImages.length === 0 && rawImgs.length > 0) {
            setGalleryImages(rawImgs);
          }
          if (!imageUrl) {
            if (found.image_url) setImageUrl(found.image_url);
            else if (rawImgs[0]) setImageUrl(rawImgs[0]);
          }
          // Only auto-populate promptsObj from DB if user has NOT already pasted/typed a custom prompt or new storyline
          if (found.promptsObj && !customPromptText.trim()) {
            setPromptsObj(found.promptsObj);
            promptsObjRef.current = found.promptsObj;
            setCustomPromptText(JSON.stringify(found.promptsObj, null, 2));
            const savedCount = Number((found.promptsObj as any)._sceneCount);
            const pKeys = Object.keys(found.promptsObj).map(k => {
              const m = k.match(/^prompt(\d+)$/i);
              return m ? parseInt(m[1], 10) : 0;
            }).filter(n => n > 0);
            const nextCount =
              Number.isFinite(savedCount) && savedCount > 0
                ? savedCount
                : pKeys.length > 0
                  ? Math.max(...pKeys)
                  : 0;
            if (nextCount > 0) {
              setSelectedSceneCount(nextCount);
              refreshPartsStatus(trimmed, nextCount);
            }
          }
          setConsensusPreFeedback(found.consensus_feedback || '');
          setPartFeedback(found.part_feedback || '');
          if (found.episodes && found.episodes.length > 0) {
            setEpisodes(found.episodes);
          }
          if (found.debate_messages && found.debate_messages.length > 0) {
            setDebateMessages(found.debate_messages);
            setShowDebateBox(true);
          } else {
            setDebateMessages([]);
            setShowDebateBox(false);
          }
        } else {
          setCurrentProductId(null);
          setConsensusPreFeedback('');
          setPartFeedback('');
          setDebateMessages([]);
          setShowDebateBox(false);
        }
      }
    } catch (err) {
      console.error('Error checking product on blur:', err);
    }
  };

  // Persist prompt to product database
  const persistPrompts = async (promptsToSave: Record<string, string>): Promise<boolean> => {
    const trimmedName = productName.trim();
    if (!trimmedName) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm trước khi lưu kịch bản!');
      return false;
    }
    const promptsWithCount: Record<string, string> = {
      ...promptsToSave,
      _sceneCount: String(selectedSceneCount || 8),
    };
    try {
      let targetId = currentProductId || initialProduct?.id;
      if (!targetId) {
        try {
          const checkRes = await fetch('/api/products');
          const checkData = await checkRes.json();
          if (checkData.success && Array.isArray(checkData.data)) {
            const found = checkData.data.find(
              (p: any) => p.name && p.name.trim().toLowerCase() === trimmedName.toLowerCase()
            );
            if (found) {
              targetId = found.id;
            }
          }
        } catch (findErr) {
          console.error('Error finding existing product:', findErr);
        }
      }

      if (targetId) {
        const updateRes = await fetch(`/api/products/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promptsObj: promptsWithCount,
            category,
            description: productDescription,
            image_url: imageUrl || undefined,
            images: galleryImages.length > 0 ? galleryImages : (imageUrl ? [imageUrl] : undefined),
            consensus_feedback: consensusPreFeedback,
            part_feedback: partFeedback,
            episodes,
            debate_messages: debateMessagesRef.current,
            world_style: worldStyle,
          }),
        });
        const updateData = await updateRes.json();
        if (!updateData.success) throw new Error(updateData.error || 'Lỗi cập nhật sản phẩm');
        setCurrentProductId(targetId);
      } else {
        const createRes = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            category,
            description: productDescription,
            image_url: imageUrl || '',
            images: galleryImages.length > 0 ? galleryImages : (imageUrl ? [imageUrl] : []),
            promptsObj: promptsWithCount,
            consensus_feedback: consensusPreFeedback,
            part_feedback: partFeedback,
            episodes,
            debate_messages: debateMessagesRef.current,
            world_style: worldStyle,
          }),
        });
        const createData = await createRes.json();
        if (!createData.success) throw new Error(createData.error || 'Lỗi tạo sản phẩm mới');
        if (createData.data?.id) {
          setCurrentProductId(createData.data.id);
        }
      }
      onSuccess?.();
      return true;
    } catch (err: any) {
      console.error('Error persisting script:', err);
      showToast(`❌ Lỗi lưu dữ liệu: ${err.message}`);
      return false;
    }
  };

  // Save prompt to product / local state
  const handleSavePrompt = async () => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm!');
      return;
    }
    const pObj = customPromptText.trim()
      ? parsePromptInputToObj(customPromptText, selectedSceneCount)
      : promptsObj;

    setIsSavingPromptMain(true);
    try {
      setPromptsObj(pObj);
      promptsObjRef.current = pObj;
      const saved = await persistPrompts(pObj);
      if (saved) {
        showToast('💾 Đã lưu kịch bản phân cảnh thành công!');
      }
    } finally {
      setIsSavingPromptMain(false);
    }
  };

  const formatTimer = (sec: number = 0) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}s`;
  };

  // 2-AI Consensus Debate Stream
  const triggerAiConsensusDebate = async (customFb?: string, continuePrev = false) => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm trước khi thảo luận 2 AI!');
      return;
    }
    if (!await ensureGeminiSafe(productDescription, customFb || consensusPreFeedback)) return;

    setIsDebating(true);
    setShowDebateBox(true);
    setDebateElapsedSec(0);
    const debateTimer = setInterval(() => {
      setDebateElapsedSec((prev) => prev + 1);
    }, 1000);

    // Dynamic next round calculation
    const maxExistingRound = (debateMessagesRef.current || []).reduce((max: number, m: any) => {
      let r = m.round;
      if (!r) {
        const match = m.title?.match(/Round\s*(\d+)/i) || m.content?.match(/Round\s*(\d+)/i);
        r = match ? parseInt(match[1], 10) : 1;
      }
      return Math.max(max, Number(r) || 1);
    }, currentDebateRound || 1);

    const targetStartRound = continuePrev ? maxExistingRound + 1 : 1;

    if (!continuePrev) {
      setPromptValidationError(null);
      setDebateMessages([]);
      setCurrentDebateRound(1);
      setCurrentActiveAi('ai1');
      setDebateStatusText(`🎭 ${aiModels.ai1.name} & 🧐 ${aiModels.ai2.name} đang khởi tạo phiên kiểm định Round 1...`);
    } else {
      setPromptValidationError(null);
      setCurrentDebateRound(targetStartRound);
      setCurrentActiveAi('ai1');
      setDebateStatusText(`📢 Tiếp thu góp ý của Đạo diễn và bắt đầu tranh biện Round ${targetStartRound}...`);
    }

    // Capture previous proposal so AI 1 can revise from it instead of starting from scratch
    const existingProposalDraft = customPromptText || (promptsObj && Object.keys(promptsObj).length > 0 ? JSON.stringify(promptsObj, null, 2) : undefined);

    const accumulatedMessages: any[] = continuePrev ? [...debateMessagesRef.current] : [];

    // Append user feedback directly into the debate stream message list
    if (continuePrev && customFb) {
      const userMsg: any = {
        agent: "Đạo Diễn (Bạn / User)",
        model: "Human Director",
        role: "Chỉ Đạo Kịch Bản Trực Tiếp",
        title: `📢 Góp Ý Trực Tiếp Từ Đạo Diễn (Round ${targetStartRound})`,
        content: customFb,
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        round: targetStartRound,
      };
      accumulatedMessages.push(userMsg);
      setDebateMessages((prev) => [...prev, userMsg]);
    }

    try {
      try {
        debateAbortControllerRef.current?.abort();
      } catch {}
      const abortController = new AbortController();
      debateAbortControllerRef.current = abortController;

      const res = await fetch('/api/prompts/consensus-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          product_name: productName.trim(),
          category,
          product_image_url: imageUrl || undefined,
          product_images: galleryImages.length > 0 ? galleryImages : (imageUrl ? [imageUrl] : undefined),
          product_description: productDescription.trim(),
          world_style: worldStyle,
          visual_style: visualStyle,
          scene_count: selectedSceneCount,
          user_feedback: customFb || consensusPreFeedback.trim() || undefined,
          previous_proposal: continuePrev ? existingProposalDraft : undefined,
          start_round: targetStartRound,
        }),
      });

      if (!res.ok) {
        const rawErr = await res.text();
        if (res.status === 524 || rawErr.includes('<!DOCTYPE html>')) {
          throw new Error(`HTTP ${res.status}: Kết nối qua Cloudflare quá 100s (Timeout)`);
        }
        throw new Error(`HTTP ${res.status}: ${rawErr.slice(0, 200)}`);
      }
      if (!res.body) throw new Error('Trình duyệt không hỗ trợ đọc luồng stream.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        if (abortController.signal.aborted) {
          await reader.cancel().catch(() => {});
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.replace(/^data:\s*/, '');
            try {
              const evt = JSON.parse(jsonStr);
              if (evt.type === 'round_start') {
                setCurrentDebateRound(evt.round || 1);
                setCurrentActiveAi('ai1');
                setDebateStatusText(`🔄 Round ${evt.round}: Đang tranh biện kịch bản & kiểm định độ khớp nhân vật...`);
              } else if (evt.type === 'ai1_start') {
                setCurrentDebateRound(evt.round || 1);
                setCurrentActiveAi('ai1');
                setDebateStatusText(evt.message || `🎭 ${aiModels.ai1.name} đang sáng tác và tối ưu kịch bản 3D (Round ${evt.round})...`);
              } else if (evt.type === 'ai1_done') {
                if (evt.message) {
                  const effectiveRound = evt.round || evt.message.round || targetStartRound;
                  const msgWithRound = { ...evt.message, round: effectiveRound };
                  accumulatedMessages.push(msgWithRound);
                  setDebateMessages((prev) => [...prev, msgWithRound]);
                }
                const candidateObj =
                  evt.prompts_obj && typeof evt.prompts_obj === 'object' && Object.keys(evt.prompts_obj).length > 0
                    ? evt.prompts_obj
                    : evt.message?.content
                    ? parsePromptInputToObj(evt.message.content, selectedSceneCount)
                    : null;

                if (candidateObj && Object.keys(candidateObj).some((k) => /^prompt\d+$/i.test(k))) {
                  promptsObjRef.current = candidateObj;
                  setPromptsObj(candidateObj);
                  setCustomPromptText(JSON.stringify(candidateObj, null, 2));
                  const newCount = Object.keys(candidateObj).filter((k) => /^prompt\d+$/i.test(k)).length;
                  if (newCount > 0) {
                    setSelectedSceneCount(newCount);
                  }
                  persistPrompts(candidateObj).catch(console.error);
                }
                setCurrentActiveAi('ai2');
              } else if (evt.type === 'ai2_start') {
                setCurrentDebateRound(evt.round || targetStartRound);
                setCurrentActiveAi('ai2');
                if (evt.ai2_name) {
                  setAiModels((prev) => ({
                    ...prev,
                    ai2: {
                      ...prev.ai2,
                      name: evt.ai2_name.startsWith('AI 2') ? evt.ai2_name : `AI 2 (${evt.ai2_name})`,
                      label: evt.ai2_name,
                    },
                  }));
                }
                setDebateStatusText(evt.message || `🧐 ${evt.ai2_name ? (evt.ai2_name.startsWith('AI 2') ? evt.ai2_name : `AI 2 (${evt.ai2_name})`) : aiModels.ai2.name} đang kiểm định tiêu chí nhân vật & bố cục (Round ${evt.round || targetStartRound})...`);
              } else if (evt.type === 'ai2_fallback') {
                setCurrentActiveAi('ai2');
                if (evt.ai2_name) {
                  setAiModels((prev) => ({
                    ...prev,
                    ai2: {
                      ...prev.ai2,
                      name: evt.ai2_name.startsWith('AI 2') ? evt.ai2_name : `AI 2 (${evt.ai2_name})`,
                      label: evt.ai2_name,
                    },
                  }));
                }
                if (evt.message) setDebateStatusText(evt.message);
              } else if (evt.type === 'ai2_done') {
                if (evt.message) {
                  const effectiveRound = evt.round || evt.message.round || targetStartRound;
                  const msgWithRound = { ...evt.message, round: effectiveRound };
                  accumulatedMessages.push(msgWithRound);
                  setDebateMessages((prev) => [...prev, msgWithRound]);
                }
                if (evt.reached) {
                  setDebateStatusText(`🎉 ĐỒNG THUẬN 100% HOÀN HẢO ĐẠT ĐƯỢC TẠI ROUND ${evt.round || targetStartRound}!`);
                  setCurrentActiveAi(null);
                } else {
                  setDebateStatusText(`⚠️ Round ${evt.round || targetStartRound} đạt ${evt.percentage}%. Chuyển sang Round ${(evt.round || targetStartRound) + 1}...`);
                  setCurrentDebateRound((evt.round || targetStartRound) + 1);
                  setCurrentActiveAi('ai1');
                }
              } else if (evt.type === 'preflight_start') {
                setDebateStatusText(evt.message || `🛡️ ${aiModels.validator.label} đang kiểm tra bản quyền & lỗi từng prompt...`);
              } else if (evt.type === 'validating_scene') {
                setDebateStatusText(evt.message || `🛡️ Đang kiểm định Phân cảnh ${evt.scene_index} (Lần ${evt.attempt}/${evt.max_attempts})...`);
              } else if (evt.type === 'scene_issues_found') {
                setDebateStatusText(evt.message || `⚠️ Phân cảnh ${evt.scene_index} có rủi ro. Đang tự động sửa (Lần ${evt.attempt}/${evt.max_attempts})...`);
              } else if (evt.type === 'scene_passed') {
                setDebateStatusText(evt.message || `✅ Phân cảnh ${evt.scene_index}: Đạt chuẩn an toàn Veo 3!`);
              } else if (evt.type === 'preflight_passed') {
                setDebateStatusText(evt.message || '🎉 100% prompt an toàn và sẵn sàng cho Veo 3!');
              } else if (evt.type === 'prompt_validation_error') {
                const sIdx = evt.scene_index || evt.failed_scene?.scene_index || 1;
                const errObj = {
                  sceneIndex: sIdx,
                  attempts: evt.attempt || evt.attempts || 3,
                  issues: evt.issues || evt.failed_scene?.issues || [],
                  error: evt.error || 'Prompt phân cảnh không đạt chuẩn Veo 3 sau 3 lần sửa.',
                  currentPrompt: evt.prompt || evt.failed_scene?.final_prompt || promptsObjRef.current[`prompt${sIdx}`] || '',
                };
                setPromptValidationError(errObj);
                setDebateStatusText(`❌ Dừng kịch bản: Phân cảnh ${errObj.sceneIndex} vẫn lỗi sau 3 lần sửa. Vui lòng đổi nội dung!`);
                showToast(`❌ Dừng kịch bản: Phân cảnh ${errObj.sceneIndex} bị lỗi sau 3 lần sửa!`);
                setIsDebating(false);
                setCurrentActiveAi(null);
                clearInterval(debateTimer);
                return;
              } else if (evt.type === 'complete') {
                if (evt.result?.promptsObj) {
                  promptsObjRef.current = evt.result.promptsObj;
                  setPromptsObj(evt.result.promptsObj);
                  setCustomPromptText(JSON.stringify(evt.result.promptsObj, null, 2));
                  const displayRounds = evt.result.rounds || targetStartRound;
                  setDebateStatusText(`🎉 ĐỒNG THUẬN 100% (${displayRounds} rounds): Nhân vật & bố cục chuẩn 100%`);
                  showToast(`🎉 2 AI đã tiếp thu góp ý và đạt 100% đồng thuận tại Round ${displayRounds}!`);
                  persistPrompts(evt.result.promptsObj).catch(console.error);

                  const newCount = Object.keys(evt.result.promptsObj).filter(k => /^prompt\d+$/i.test(k)).length;
                  if (newCount > 0) {
                    setSelectedSceneCount(newCount);
                    setSceneImages(prev => prev.slice(0, newCount));
                    setSceneUrls(prev => prev.slice(0, newCount));
                    setEpisodes((prev) => {
                      if (prev.length <= 1) {
                        return [{ id: 'ep_1', title: 'Tập 1 (Full Story)', startScene: 1, endScene: newCount }];
                      }
                      return prev;
                    });
                  }
                }
                persistProductFeedback({ debate_messages: accumulatedMessages });
                setCurrentActiveAi(null);
              } else if (evt.type === 'error') {
                if (evt.code === 'GEMINI_SAFETY_POLICY_BLOCK' && Array.isArray(evt.issues)) setSafetyIssues(evt.issues);
                throw new Error(evt.error || 'Lỗi phiên phản biện');
              }
            } catch (pErr: any) {
              if (pErr.message && !pErr.message.includes('JSON')) throw pErr;
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || debateAbortControllerRef.current?.signal.aborted || String(err?.message || '').includes('Đã hủy')) {
        setDebateStatusText('⛔ Đã hủy thảo luận 2 AI theo yêu cầu');
        showToast('⛔ Đã hủy thảo luận 2 AI.');
      } else {
        setDebateStatusText(`❌ Lỗi thảo luận: ${err.message}`);
        showToast(`❌ Lỗi: ${err.message}`);
      }
    } finally {
      clearInterval(debateTimer);
      setIsDebating(false);
      setCurrentActiveAi(null);
    }
  };

  const handleManualPreflightCheck = async () => {
    const currentPrompts = promptsObjRef.current;
    if (!currentPrompts || Object.keys(currentPrompts).filter((k) => /^prompt\d+$/i.test(k)).length === 0) {
      showToast('⚠️ Chưa có kịch bản/prompt nào để kiểm tra!');
      return;
    }
    setIsPreflightChecking(true);
    setPromptValidationError(null);
    showToast(`🛡️ ${aiModels.validator.label} đang kiểm tra từng prompt của kịch bản...`);
    try {
      const res = await fetch('/api/prompts/preflight-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompts_obj: currentPrompts,
          scene_count: selectedSceneCount,
          product_name: productName.trim(),
          product_description: productDescription.trim() || undefined,
          world_style: worldStyle,
          visual_style: visualStyle,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.failedScene) {
          setPromptValidationError({
            sceneIndex: data.failedScene.scene_index,
            attempts: data.failedScene.attempts,
            issues: data.failedScene.issues || [],
            error: data.error,
            currentPrompt: data.failedScene.final_prompt || currentPrompts[`prompt${data.failedScene.scene_index}`] || '',
          });
        }
        throw new Error(data.error || 'Kiểm định kịch bản thất bại.');
      }
      if (data.promptsObj) {
        promptsObjRef.current = data.promptsObj;
        setPromptsObj(data.promptsObj);
        setCustomPromptText(JSON.stringify(data.promptsObj, null, 2));
        persistPrompts(data.promptsObj).catch(console.error);
      }
      if (data.repairedCount > 0) {
        showToast(`🎉 Đã tự động sửa ${data.repairedCount} cảnh có rủi ro đạt chuẩn Veo 3!`);
      } else {
        showToast('✅ 100% prompt an toàn, không có rủi ro bản quyền và sẵn sàng cho Veo 3!');
      }
    } catch (err: any) {
      showToast(`❌ ${err.message}`);
    } finally {
      setIsPreflightChecking(false);
    }
  };

  const handleSendLiveDebateFeedback = () => {
    if (!liveDebateFeedback.trim()) return;
    const fb = liveDebateFeedback.trim();
    setLiveDebateFeedback('');
    triggerAiConsensusDebate(fb, true);
  };

  // Generate 6 scene images sequentially with step-by-step animation and instant preview
  const handleGenerateSceneImages = async () => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm!');
      return;
    }
    if (!await ensureGeminiSafe(JSON.stringify(promptsObjRef.current))) return;

    isAbortRequested.current = false;
    setIsPipelineRunning(true);
    setIsGeneratingAllImages(true);
    setGenerateImagesElapsedSec(0);
    const genTimer = setInterval(() => {
      setGenerateImagesElapsedSec((prev) => prev + 1);
    }, 1000);

    const totalScenes = getDynamicSceneCount();
    setPipelineStatusText(`🎨 Gemini đang bắt đầu tạo ${totalScenes} ảnh phân cảnh theo từng Part...`);
    showToast(`🎨 Bắt đầu tạo ${totalScenes} ảnh phân cảnh: Card từng Part sẽ cập nhật ảnh ngay khi vẽ xong!`);

    try {
      for (let idx = 0; idx < totalScenes; idx++) {
        if (isAbortRequested.current) {
          showToast('⛔ Đã dừng tạo ảnh theo yêu cầu.');
          break;
        }
        const partNum = idx + 1;
        setPipelineStatusText(`🎨 Gemini đang tạo ảnh Part ${partNum}/${totalScenes}...`);
        showToast(`🎨 Đang tạo ảnh Part ${partNum}/${totalScenes}...`);
        const customRef = idx === 0 ? -1 : idx - 1;
        const success = await handleRedrawSingleImage(partNum, customRef);
        if (!success) {
          throw new Error(`Không thể tạo ảnh Part ${partNum}. Đã dừng để tránh render video bằng ảnh cũ/fallback.`);
        }
      }

      if (!isAbortRequested.current) {
        showToast(`🎉 Đã tạo xong toàn bộ ${totalScenes} ảnh phân cảnh 3D Pixar!`, 4000);
        setPipelineStatusText(`✅ Đã tạo xong ${totalScenes} ảnh phân cảnh!`);
      }
    } catch (err: any) {
      showToast(`❌ Lỗi tạo ảnh: ${err.message}`);
      setPipelineStatusText(`❌ Lỗi: ${err.message}`);
    } finally {
      clearInterval(genTimer);
      setIsGeneratingAllImages(false);
      setIsPipelineRunning(false);
    }
  };

  // Redraw single scene image with instant cache-busting URL apply
  const handleRedrawSingleImage = async (partNum: number, refSource: number, notes?: string, promptOverride?: string, dialogueOverride?: string): Promise<boolean> => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm trước khi vẽ ảnh!');
      return false;
    }
    if (!await ensureGeminiSafe(promptOverride || JSON.stringify(promptsObjRef.current), notes || dialogueOverride || '')) return false;
    const curSceneImgs = sceneImagesRef.current;
    const effectiveImageUrl = imageUrl || curSceneImgs[0] || (curSceneImgs.find(Boolean) ?? '');
    const sIdx = partNum - 1;
    setDrawingParts((prev) => {
      const copy = [...prev];
      copy[sIdx] = true;
      return copy;
    });

    setPipelineStatusText(`🎨 Gemini Web (Trình duyệt) đang vẽ ảnh Part ${partNum}...`);

    try {
        const curPrompts = promptsObjRef.current;
        const prompt = promptOverride ?? (curPrompts[`prompt${partNum}`] || (partNum === 1 ? curPrompts.prompt : '') || `3D Pixar scene ${partNum}`);
        const dialogue = dialogueOverride ?? (curPrompts[`dialogue${partNum}`] || '');

        const effectiveImages = (galleryImages && galleryImages.length > 0)
          ? galleryImages
          : (initialProduct?.images && initialProduct.images.length > 0
              ? initialProduct.images
              : (effectiveImageUrl ? [effectiveImageUrl] : []));

        const payload: any = {
          product_id: currentProductId || initialProduct?.id,
          product_name: productName.trim(),
          image_url: effectiveImageUrl || '',
          images: effectiveImages,
          scene_index: sIdx,
          prompt,
          dialogue,
          render_mode: 'browser',
          world_style: worldStyle,
          visual_style: visualStyle,
        };

      if (refSource !== undefined && refSource !== null) {
        payload.reference_part_index = refSource;
      }
      if (notes && notes.trim()) {
        payload.redraw_instructions = notes.trim();
      }

      const abortController = new AbortController();
      pipelineAbortControllerRef.current = abortController;

      const res = await fetch('/api/pipeline/generate-single-scene-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const rawErr = await res.text();
        if (res.status === 524 || rawErr.includes('<!DOCTYPE html>')) {
          throw new Error(`HTTP ${res.status}: Kết nối qua Cloudflare quá 100s (Timeout)`);
        }
        throw new Error(`HTTP ${res.status}: ${rawErr.slice(0, 200)}`);
      }

      const data = await res.json();
      if (data.success && data.scene_image_url) {
        showToast(`🎉 Đã vẽ xong ảnh Part ${partNum}!`);
        const cleanUrl = data.scene_image_url.split('?')[0];
        const freshUrl = `${cleanUrl}?t=${Date.now()}`;
        sceneImagesRef.current[sIdx] = freshUrl;
        setSceneImages((prev) => {
          const copy = [...prev];
          copy[sIdx] = freshUrl;
          return copy;
        });
        await refreshPartsStatus();
        return true;
      } else {
        showToast(`❌ Lỗi vẽ Part ${partNum}: ${data.error || 'Server error'}`);
        return false;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || pipelineAbortControllerRef.current?.signal.aborted || isAbortRequested.current || String(err?.message || '').includes('Đã hủy')) {
        showToast(`⛔ Đã hủy vẽ ảnh Part ${partNum}.`);
        return false;
      }
      await refreshPartsStatus().catch(() => {});
      showToast(`❌ Lỗi: ${err.message}`);
      return false;
    } finally {
      setDrawingParts((prev) => {
        const copy = [...prev];
        copy[sIdx] = false;
        return copy;
      });
      if (!isAbortRequested.current && !pipelineAbortControllerRef.current?.signal.aborted) {
        setPipelineStatusText(`Hoàn tất vẽ ảnh Part ${partNum}`);
      }
    }
  };

  // Render single video
  const handleRenderSingleVideo = async (
    partNum: number,
    promptOverride?: string,
    dialogueOverride?: string,
    optionsOverride?: {
      includePrevFrame?: boolean | string;
      prevFrameParts?: number[];
      refImagesMode?: string;
    }
  ) => {
    if (!productName.trim()) return false;
    if (inFlightRenderingPartsRef.current.has(partNum)) {
      showToast(`⚠️ Part ${partNum} đang được render, vui lòng đợi hoàn tất.`);
      return false;
    }
    if (!await ensureGeminiSafe(promptOverride || JSON.stringify(promptsObjRef.current), dialogueOverride || '')) return false;

    inFlightRenderingPartsRef.current.add(partNum);
    const sIdx = partNum - 1;
    setRenderingParts((prev) => {
      const copy = [...prev];
      copy[sIdx] = true;
      return copy;
    });
    setPipelineStatusText(`🌐 Trình duyệt Chrome đang tạo video Part ${partNum}...`);

    try {
      const curPrompts = promptsObjRef.current;
      const curImages = sceneImagesRef.current;
      const prompt = promptOverride ?? (curPrompts[`prompt${partNum}`] || (partNum === 1 ? curPrompts.prompt : '') || '');
      const dialogue = dialogueOverride ?? (curPrompts[`dialogue${partNum}`] || '');

      const slug = productName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-_]/g, '')
        .replace(/[\s_]+/g, '-') || 'scene';
      const fallbackSceneUrl = `/downloads/${slug}/scenes/scene_${partNum}.png`;

      const partImg = curImages[sIdx] || fallbackSceneUrl || imageUrl;

      if (!prompt.trim()) {
        showToast(`❌ Part ${partNum} chưa có prompt. Không gửi request Veo.`);
        return false;
      }
      if (!partImg) {
        showToast(`❌ Part ${partNum} chưa có ảnh nguồn. Không gửi request Veo.`);
        return false;
      }

      const allOriginalImages = Array.from(new Set([
        ...(imageUrl ? [imageUrl] : []),
        ...(galleryImages || [])
      ].filter(Boolean)));

      const effectiveIncludePrev = optionsOverride?.includePrevFrame !== undefined
        ? optionsOverride.includePrevFrame
        : includePrevFrame;
      const effectiveRefMode = optionsOverride?.refImagesMode || refImagesMode;

      const abortController = new AbortController();
      pipelineAbortControllerRef.current = abortController;

      const res = await fetch('/api/pipeline/generate-single-scene-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          product_name: productName.trim(),
          scene_index: sIdx,
          prompt,
          dialogue,
          image_url: partImg,
          scene_image_path: curImages[sIdx] || fallbackSceneUrl,
          images: allOriginalImages,
          include_prev_frame: effectiveIncludePrev,
          prev_frame_parts: optionsOverride?.prevFrameParts,
          ref_images_mode: effectiveRefMode,
          render_mode: videoRenderMode,
          world_style: worldStyle,
          visual_style: visualStyle,
        }),
      });

      if (!res.ok) {
        const rawErr = await res.text();
        if (res.status === 524 || rawErr.includes('<!DOCTYPE html>')) {
          throw new Error(`HTTP ${res.status}: Kết nối qua Cloudflare quá 100s (Timeout)`);
        }
        throw new Error(`HTTP ${res.status}: ${rawErr.slice(0, 200)}`);
      }

      const data = await res.json();
      if (data.success && data.video_url && data.video_path) {
        showToast(`🎉 Render video Part ${partNum} thành công!`);
        await refreshPartsStatus();
        return true;
      } else {
        showToast(`❌ Lỗi render Part ${partNum}: ${data.error || 'Server chưa xác nhận video đã tải về local'}`);
        return false;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || pipelineAbortControllerRef.current?.signal.aborted || isAbortRequested.current || String(err?.message || '').includes('Đã hủy')) {
        showToast(`⛔ Đã hủy tiến trình render video Part ${partNum}.`);
        return false;
      }
      await refreshPartsStatus().catch(() => {});
      showToast(`❌ Lỗi: ${err.message}`);
      return false;
    } finally {
      inFlightRenderingPartsRef.current.delete(partNum);
      setRenderingParts((prev) => {
        const copy = [...prev];
        copy[sIdx] = false;
        return copy;
      });
      if (!isAbortRequested.current && !pipelineAbortControllerRef.current?.signal.aborted) {
        setPipelineStatusText(`Hoàn tất render video Part ${partNum}`);
      }
    }
  };

  // Batch revise prompts with 2-AI Stream
  const handleBatchRevisePrompts = async (selectedIndices: number[], feedback: string, attachedImg?: string) => {
    if (!await ensureGeminiSafe(JSON.stringify(promptsObjRef.current), feedback)) return;
    setIsRevisingPrompts(true);
    setRevisingTargetParts(selectedIndices);
    setRevisingStage('ai1');
    setRevisingElapsedSec(0);
    const revisionTimer = setInterval(() => {
      setRevisingElapsedSec((prev) => prev + 1);
    }, 1000);

    setRevisingStatusText(`🤖 Đang yêu cầu AI sửa kịch bản cho Part ${selectedIndices.map((i) => i + 1).join(', ')}...`);
    setPipelineStatusText(`🤖 AI đang sửa kịch bản Part ${selectedIndices.map((i) => i + 1).join(', ')}...`);
    showToast(`🤖 AI đang sửa kịch bản Part ${selectedIndices.map((i) => i + 1).join(', ')}...`);

    try {
      const latestPrompts = promptsObjRef.current;
      const effectivePromptsObj =
        latestPrompts && Object.keys(latestPrompts).length > 0
          ? latestPrompts
          : (customPromptText.trim() ? parsePromptInputToObj(customPromptText, selectedSceneCount) : {});

      const worldDirective = getWorldStyleDirective(worldStyle);
      const payload: any = {
        product_name: productName.trim(),
        category,
        product_description: productDescription.trim() || undefined,
        prompts_obj: effectivePromptsObj,
        scene_indices: selectedIndices,
        feedback: worldDirective
          ? `DIRECTOR REVISION (SUPREME #1 PRIORITY — OVERRIDES ALL PREVIOUS CHARACTERS, OUTFITS & CONTEXT): ${feedback}\n\n${worldDirective}`
          : feedback,
        image_url: imageUrl || undefined,
        world_style: worldStyle,
        visual_style: visualStyle,
      };
      if (attachedImg) payload.feedback_image_url = attachedImg;

      try {
        debateAbortControllerRef.current?.abort();
      } catch {}
      const abortController = new AbortController();
      debateAbortControllerRef.current = abortController;

      const res = await fetch('/api/prompts/revise-scene-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const rawErr = await res.text();
        if (res.status === 524 || rawErr.includes('<!DOCTYPE html>')) {
          throw new Error(`HTTP ${res.status}: Kết nối qua Cloudflare quá 100s (Timeout)`);
        }
        throw new Error(`HTTP ${res.status}: ${rawErr.slice(0, 200)}`);
      }
      if (!res.body) throw new Error('Trình duyệt không hỗ trợ đọc luồng stream.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        if (abortController.signal.aborted) {
          await reader.cancel().catch(() => {});
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.replace(/^data:\s*/, '');
            try {
              const evt = JSON.parse(jsonStr);
              if (evt.type === 'start') {
                setRevisingStage('ai1');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                if (evt.message) setRevisingStatusText(evt.message);
              } else if (evt.type === 'ai1_start') {
                setRevisingStage('ai1');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                if (evt.message) setRevisingStatusText(evt.message);
              } else if (evt.type === 'model_switch') {
                setRevisingStage('ai1');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                if (evt.message) setRevisingStatusText(evt.message);
                if (evt.modelTitle || evt.model) {
                  const mTitle = evt.modelTitle || evt.model;
                  setAiModels((prev) => ({
                    ...prev,
                    ai1: {
                      ...prev.ai1,
                      id: evt.model || prev.ai1.id,
                      name: mTitle.startsWith('AI 1') ? mTitle : `AI 1 (${mTitle})`,
                      label: mTitle,
                    },
                  }));
                }
              } else if (evt.type === 'ai1_done') {
                setRevisingStage('ai2');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                setRevisingStatusText(`🎭 ${aiModels.ai1.name} đã xong bản thảo. Chuyển sang 🧐 ${aiModels.ai2.name} kiểm định...`);
              } else if (evt.type === 'ai2_start') {
                setRevisingStage('ai2');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                if (evt.ai2_name) {
                  setAiModels((prev) => ({
                    ...prev,
                    ai2: {
                      ...prev.ai2,
                      name: evt.ai2_name.startsWith('AI 2') ? evt.ai2_name : `AI 2 (${evt.ai2_name})`,
                      label: evt.ai2_name,
                    },
                  }));
                }
                if (evt.message) setRevisingStatusText(evt.message);
              } else if (evt.type === 'complete') {
                setRevisingStage('done');
                setIsRevisingPrompts(false);
                clearInterval(revisionTimer);
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                const rawP = evt.prompts_obj || evt.result?.promptsObj;
                const revNote = evt.revision_note || evt.result?.revisionNote;
                if (rawP) {
                  const parsedIncoming = parsePromptInputToObj(rawP, selectedSceneCount);
                  const safeMerged: Record<string, string> =
                    promptsObjRef.current && Object.keys(promptsObjRef.current).length > 0
                      ? { ...promptsObjRef.current }
                      : { ...effectivePromptsObj };
                  if (parsedIncoming.character_bible) safeMerged.character_bible = parsedIncoming.character_bible;
                  if (parsedIncoming._visualStyle) safeMerged._visualStyle = parsedIncoming._visualStyle;
                  if (parsedIncoming.story_title) safeMerged.story_title = parsedIncoming.story_title;
                  for (const idx of selectedIndices) {
                    const pNum = idx + 1;
                    if (parsedIncoming[`prompt${pNum}`] !== undefined) {
                      safeMerged[`prompt${pNum}`] = parsedIncoming[`prompt${pNum}`];
                    }
                    if (parsedIncoming[`dialogue${pNum}`] !== undefined) {
                      safeMerged[`dialogue${pNum}`] = parsedIncoming[`dialogue${pNum}`];
                    }
                  }
                  promptsObjRef.current = safeMerged;
                  setPromptsObj(safeMerged);
                  setCustomPromptText(JSON.stringify(safeMerged, null, 2));
                  showToast(`🎉 ${revNote || 'AI đã sửa xong kịch bản!'}`);
                  setPipelineStatusText(`Đã sửa xong kịch bản Part ${selectedIndices.map((i) => i + 1).join(', ')}!`);
                  setRevisingStatusText(`🎉 Đã sửa xong kịch bản (${evt.elapsedSec || 0}s): ${revNote || 'Hoàn tất cập nhật kịch bản'}`);
                  persistPrompts(safeMerged).catch(console.error);
                }
                break;
              } else if (evt.type === 'error') {
                if (evt.code === 'GEMINI_SAFETY_POLICY_BLOCK' && Array.isArray(evt.issues)) setSafetyIssues(evt.issues);
                throw new Error(evt.error || 'Lỗi sửa kịch bản');
              }
            } catch (pErr: any) {
              if (pErr.message && !pErr.message.includes('JSON')) throw pErr;
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || debateAbortControllerRef.current?.signal.aborted || String(err?.message || '').includes('Đã hủy')) {
        setRevisingStatusText('⛔ Đã hủy sửa kịch bản theo yêu cầu');
        showToast('⛔ Đã hủy sửa kịch bản.');
      } else {
        showToast(`❌ Lỗi: ${err.message}`);
        setRevisingStatusText(`❌ Lỗi: ${err.message}`);
      }
    } finally {
      clearInterval(revisionTimer);
      setIsRevisingPrompts(false);
    }
  };

  // Batch redraw images
  const handleBatchRenderImages = async (selectedIndices: number[], refSource: number, feedback: string) => {
    isAbortRequested.current = false;
    setIsPipelineRunning(true);
    setPipelineStatusText('🎨 Đang vẽ ảnh hàng loạt...');

    try {
      for (const idx of selectedIndices) {
        if (isAbortRequested.current) {
          showToast('⛔ Đã dừng vẽ ảnh hàng loạt.');
          break;
        }
        const customRef = refSource === -99
          ? (idx === 0 ? -1 : idx - 1)
          : (refSource === -98 ? (idx === 0 ? -1 : 0) : refSource);
        const success = await handleRedrawSingleImage(idx + 1, customRef, feedback);
        if (!success) {
          throw new Error(`Tạo ảnh Part ${idx + 1} thất bại. Đã dừng batch.`);
        }
      }
      if (!isAbortRequested.current) {
        showToast(`🎉 Đã vẽ xong toàn bộ ảnh cho các Part: ${selectedIndices.map((i) => i + 1).join(', ')}!`);
      }
    } catch (err: any) {
      showToast(`❌ Lỗi vẽ ảnh hàng loạt: ${err.message}`);
      setPipelineStatusText(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // Batch render videos
  const handleBatchRenderVideos = async (selectedIndices: number[]) => {
    isAbortRequested.current = false;
    setIsPipelineRunning(true);
    setPipelineStatusText('🎬 Đang render video hàng loạt...');

    let completedAll = true;
    try {
      for (const idx of selectedIndices) {
        if (isAbortRequested.current) {
          completedAll = false;
          showToast('⛔ Đã dừng render video hàng loạt.');
          break;
        }
        const success = await handleRenderSingleVideo(idx + 1);
        if (!success) {
          completedAll = false;
          showToast(`⛔ Đã dừng quy trình vì Part ${idx + 1} chưa tạo xong video! Vui lòng kiểm tra lại.`);
          break;
        }
      }
      if (completedAll && !isAbortRequested.current) {
        showToast(`🎉 Đã render xong video cho các Part: ${selectedIndices.map((i) => i + 1).join(', ')}!`);
      }
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // Merge job videos (Supports Full Story and/or Defined Episodes)
  const handleMergeVideos = async (targetMode: 'full' | 'episodes' | 'all' = 'full'): Promise<boolean> => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm!');
      return false;
    }
    setIsMerging(true);
    const label = targetMode === 'full'
      ? 'Bản Full Story'
      : targetMode === 'episodes'
        ? `${episodes.length} Tập Shorts`
        : `Bản Full + ${episodes.length} Tập Shorts`;

    setPipelineStatusText(`🎬 Đang ghép video bằng FFmpeg (${label})...`);
    showToast(`🎬 Đang quét các Part video và tiến hành ghép (${label})...`);

    try {
      const episodesPayload = (targetMode === 'full') ? [] : episodes;
      const res = await fetch('/api/pipeline/merge-job-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: currentProductId || initialProduct?.id,
          product_name: productName.trim(),
          upload_s3: uploadS3,
          publish_tiktok: publishTiktok,
          episodes: episodesPayload,
        }),
      });
      if (!res.ok) {
        const rawErr = await res.text();
        if (res.status === 524 || rawErr.includes('<!DOCTYPE html>')) {
          throw new Error(`HTTP ${res.status}: Kết nối qua Cloudflare quá 100s (Timeout)`);
        }
        throw new Error(`HTTP ${res.status}: ${rawErr.slice(0, 200)}`);
      }
      const data = await res.json();
      if (data.success) {
        if (data.video_url) {
          setMergedFullUrl(data.video_url);
        }
        if (data.episodes && Array.isArray(data.episodes)) {
          setMergedEpisodesResult(data.episodes);
        }
        showToast(`🎉 Đã ghép video thành công! ${data.episodes?.length ? `(Đã xuất ${data.episodes.length} Tập Shorts)` : ''}`, 6000);
        setPipelineStatusText('✅ Video và các tập Shorts đã sẵn sàng tải xuống!');
        onSuccess();
        return true;
      } else {
        showToast('❌ Lỗi ghép video: ' + (data.error || 'Server error'));
        return false;
      }
    } catch (err: any) {
      showToast('❌ Lỗi ghép: ' + err.message);
      return false;
    } finally {
      setIsMerging(false);
    }
  };

  // Lồng tiếng VieNeu tự động
  const handleDubVideo = async () => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm!');
      return false;
    }
    setIsDubbing(true);
    setPipelineStatusText('🎙️ Đang lồng tiếng AI cho video...');
    showToast('🎙️ Bắt đầu lồng tiếng AI...', 4000);

    try {
      const res = await fetch('/api/pipeline/dub-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: currentProductId || initialProduct?.id,
          product_name: productName.trim(),
          prompts_obj: promptsObj,
          upload_s3: uploadS3,
        }),
      });
      if (!res.ok) {
        const rawErr = await res.text();
        if (res.status === 524 || rawErr.includes('<!DOCTYPE html>')) {
          throw new Error(`HTTP ${res.status}: Kết nối qua Cloudflare quá 100s (Timeout)`);
        }
        throw new Error(`HTTP ${res.status}: ${rawErr.slice(0, 200)}`);
      }
      const data = await res.json();
      if (data.success) {
        showToast(`🎉 Đã lồng tiếng và sinh video mới thành công: ${data.voicedFilename}!`, 7000);
        setPipelineStatusText(`✅ Video lồng tiếng hoàn tất: ${data.voicedFilename}`);
        onSuccess();
        return true;
      } else {
        showToast('❌ Lỗi lồng tiếng: ' + (data.error || 'Server error'));
        return false;
      }
    } catch (err: any) {
      showToast('❌ Lỗi lồng tiếng: ' + err.message);
      return false;
    } finally {
      setIsDubbing(false);
    }
  };

  // Full Run All Flow
  const handleRunAllFlow = async (feedback: string, refSource: number) => {
    isAbortRequested.current = false;
    setIsPipelineRunning(true);
    const totalScenes = getDynamicSceneCount();
    const allIndices = Array.from({ length: totalScenes }, (_, i) => i);
    setPipelineStatusText(`🚀 BẮT ĐẦU RUN ALL FLOW (Kịch bản ➡️ ${totalScenes} Ảnh ➡️ ${totalScenes} Video ➡️ Ghép)...`);
    showToast(`🚀 BẮT ĐẦU RUN ALL FLOW: Sinh ${totalScenes} ảnh, ${totalScenes} video Veo và ghép hoàn chỉnh...`);

    try {
      const curPrompts = promptsObjRef.current;
      const hasValidPrompts = Boolean(curPrompts.prompt1 && (curPrompts.prompt2 || curPrompts.prompt3));
      if (feedback.trim()) {
        showToast('Step 1/4: 🤖 AI đang cập nhật kịch bản theo yêu cầu...');
        await handleBatchRevisePrompts(allIndices, feedback.trim());
      } else if (!hasValidPrompts) {
        showToast(`Step 1/4: 🎭 Tự động tạo kịch bản ${totalScenes} cảnh qua 2-AI...`);
        await triggerAiConsensusDebate();
      } else {
        showToast(`Step 1/4: 📝 Đã có sẵn kịch bản ${totalScenes} cảnh, tiến hành vẽ ảnh...`);
      }

      if (isAbortRequested.current) throw new Error('Đã dừng quy trình theo yêu cầu.');

      for (let idx = 0; idx < totalScenes; idx++) {
        if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');
        const partNum = idx + 1;
        const customRef = refSource === -99
          ? (idx === 0 ? -1 : idx - 1)
          : (refSource === -98 ? (idx === 0 ? -1 : 0) : refSource);
        showToast(`Step 2/4: 🎨 Đang vẽ ảnh Part ${partNum}/${totalScenes}...`);
        const imageSuccess = await handleRedrawSingleImage(partNum, customRef, feedback);
        if (!imageSuccess) {
          throw new Error(`Ảnh Part ${partNum} tạo thất bại. Không render video để tránh dùng ảnh stale/fallback.`);
        }
      }

      if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');

      for (let idx = 0; idx < totalScenes; idx++) {
        if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');
        const partNum = idx + 1;
        showToast(`Step 3/4: 🎬 Đang render video Part ${partNum}/${totalScenes}...`);
        const success = await handleRenderSingleVideo(partNum);
        if (!success) {
          throw new Error(`Part ${partNum} chưa tạo xong video hoặc tải về thất bại. Đã dừng flow để đảm bảo tính liên tục!`);
        }
      }

      if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');

      showToast('Step 4/4: 🎬 Đang ghép video hoàn chỉnh (Full 1 Tập)...');
      const mergeSuccess = await handleMergeVideos('full');
      if (!mergeSuccess) {
        throw new Error('Ghép video thất bại. Full Flow chưa hoàn tất.');
      }

      showToast('🎉 CHÚC MỪNG! ĐÃ HOÀN TẤT FULL FLOW VÀ TẠO VIDEO THÀNH CÔNG!', 6000);
      setPipelineStatusText('✅ Đã hoàn tất Full Flow!');
    } catch (err: any) {
      if (isAbortRequested.current) {
        showToast('⛔ Quy trình đã dừng lại theo yêu cầu.');
      } else {
        showToast(`❌ Lỗi chạy Full Flow: ${err.message}`);
      }
      setPipelineStatusText(isAbortRequested.current ? '⛔ Đã dừng quy trình' : `❌ Lỗi: ${err.message}`);
    } finally {
      setIsPipelineRunning(false);
      await refreshPartsStatus();
    }
  };

  const handleStopPipeline = () => {
    isAbortRequested.current = true;
    try {
      debateAbortControllerRef.current?.abort();
    } catch {}
    try {
      pipelineAbortControllerRef.current?.abort();
    } catch {}
    inFlightRenderingPartsRef.current.clear();

    if (isDebating) {
      setDebateStatusText('⛔ Đã hủy thảo luận 2 AI theo yêu cầu');
    }
    if (isRevisingPrompts) {
      setRevisingStatusText('⛔ Đã hủy sửa kịch bản theo yêu cầu');
    }
    setIsDebating(false);
    setCurrentActiveAi(null);
    setIsRevisingPrompts(false);
    setRevisingStage(null);
    setIsPipelineRunning(false);
    setIsGeneratingAllImages(false);
    setDrawingParts((prev) => prev.map(() => false));
    setRenderingParts((prev) => prev.map(() => false));
    setPipelineStatusText('⛔ Đã dừng quy trình & hủy tác vụ đang chạy');
    showToast('⛔ Đã dừng quy trình & hủy tác vụ đang chạy!');

    fetch('/api/pipeline/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_name: productName.trim() }),
    }).catch(() => {});
  };

  const handleSavePartPromptInModal = async (
    num: number,
    prompt: string,
    dialogue: string,
    extraFields?: Record<string, string>
  ): Promise<boolean> => {
    const base = promptsObjRef.current && Object.keys(promptsObjRef.current).length > 0 ? promptsObjRef.current : promptsObj;
    const updated: Record<string, string> = {
      ...base,
      ...(extraFields || {}),
      [`prompt${num}`]: prompt,
      [`dialogue${num}`]: dialogue,
    };
    promptsObjRef.current = updated;
    setPromptsObj(updated);
    setCustomPromptText(JSON.stringify(updated, null, 2));
    const ok = await persistPrompts(updated);
    return ok;
  };

  const handleClose = () => {
    if (promptsObjRef.current && Object.keys(promptsObjRef.current).length > 0) {
      persistPrompts(promptsObjRef.current).catch(console.error);
    }
    persistProductFeedback().catch(console.error);
    onClose();
  };

  return (
    <div className="modal-overlay open" id="modalOverlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
          <div>
            <h2 style={{ margin: 0 }}>🎬 Generate Video</h2>
            <p style={{ margin: '4px 0 0' }}>AI will create a cinematic Veo video for your product</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close modal"
            title="Đóng (Close)"
            style={{
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
              borderRadius: '9px',
              width: '34px',
              height: '34px',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Chrome Status Bar */}
        <div
          id="chromeStatusBar"
          style={{
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '12px 14px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: chromeReady ? 'var(--success)' : 'var(--warning)',
              }}
            />
            <span>{chromeStatusText}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {chromeReady && (
              <button type="button" onClick={handleToggleChrome} style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: '12px', cursor: 'pointer' }}>
                {chromeVisible ? '🙈 Ẩn Chrome' : '👁️ Hiện Chrome'}
              </button>
            )}
            <button type="button" onClick={handleStartChrome} style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: 'var(--grad)', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
              🚀 Start Chrome
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Product Name *</label>
          <input id="inputProduct" type="text" placeholder="e.g. AKKO 3068B keyboard" value={productName} onChange={(e) => setProductName(e.target.value)} onBlur={handleProductNameBlur} />
        </div>

        <div className="form-group">
          <label>Category</label>
          <select id="inputCategory" value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}>
            <option value="tech">Tech</option>
            <option value="beauty">Beauty</option>
            <option value="fashion">Fashion</option>
            <option value="food">Food</option>
            <option value="fitness">Fitness</option>
            <option value="toys">Toys</option>
            <option value="household">Household</option>
            <option value="baby">Baby</option>
            <option value="pets">Pets</option>
          </select>
        </div>

        {/* Product Reference Images Gallery */}
        {(galleryImages.length > 0 || imageUrl) && (
          <div style={{ marginBottom: '14px', background: 'var(--bg3)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🖼️ Ảnh Gốc Đối Chiếu Nhân Vật / Bối Cảnh</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#f472b6', background: 'rgba(236,72,153,0.15)', padding: '1px 7px', borderRadius: '10px' }}>
                  {(galleryImages.length > 0 ? galleryImages.length : 1)} ảnh gốc
                </span>
              </label>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Tất cả ảnh này sẽ được upload lên Gemini để giữ đúng nhân vật</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {(galleryImages.length > 0 ? galleryImages : [imageUrl]).map((img, i) => (
                <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={img}
                    alt={`Ref ${i + 1}`}
                    onClick={() => {
                      setHoverRefPreview(null);
                      setRefLightboxIndex(i);
                    }}
                    style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', border: '2px solid rgba(236,72,153,0.6)', cursor: 'zoom-in', transition: 'transform 0.15s ease' }}
                    title={`Ảnh gốc ${i + 1} (Rê chuột để zoom nhanh • Click để xem to toàn màn hình)`}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.12)';
                      const rect = e.currentTarget.getBoundingClientRect();
                      const popupW = 300;
                      const popupH = 320;
                      let x = rect.right + 12;
                      if (x + popupW > window.innerWidth - 16) x = Math.max(16, rect.left - popupW - 12);
                      let y = Math.min(Math.max(16, rect.top - 20), window.innerHeight - popupH - 16);
                      setHoverRefPreview({ src: img, x, y, label: `Ảnh gốc đối chiếu #${i + 1}` });
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      setHoverRefPreview(null);
                    }}
                  />
                  <span style={{ position: 'absolute', bottom: '3px', right: '4px', background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '4px', pointerEvents: 'none' }}>
                    #{i + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label style={{ margin: 0, fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span>📖 Cốt truyện gốc / Description</span>
              <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--muted)' }}>(Nội dung chính để 2 AI viết kịch bản)</span>
            </label>
            {productDescription ? (
              <span style={{ fontSize: '10.5px', color: '#10b981', fontWeight: 700, background: 'rgba(16,185,129,0.15)', padding: '2px 8px', borderRadius: '10px' }}>
                ✓ Đã có cốt truyện ({productDescription.length} ký tự)
              </span>
            ) : (
              <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>(Tùy chọn)</span>
            )}
          </div>
          <textarea
            id="inputProductDescription"
            rows={3}
            value={productDescription}
            onChange={(e) => {
              const text = e.target.value;
              setProductDescription(text);
              const sugg = analyzeStorySceneCount(text);
              setSuggestedScenes(sugg);
            }}
            onBlur={(e) => {
              persistProductFeedback({ description: e.target.value });
            }}
            placeholder="Dán nội dung truyện cười, truyện ngụ ngôn hoặc kịch bản gốc tại đây... 2 AI sẽ lấy đây làm cốt truyện chính xuyên suốt tất cả các cảnh!"
            style={{
              width: '100%',
              padding: '9px 12px',
              background: 'var(--bg3)',
              border: productDescription ? '1px solid rgba(56,189,248,0.45)' : '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text)',
              fontSize: '12px',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical',
              minHeight: '52px',
              boxSizing: 'border-box',
              lineHeight: 1.45,
            }}
          />

          {suggestedScenes && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                background: selectedSceneCount === suggestedScenes.count
                  ? 'rgba(16, 185, 129, 0.08)'
                  : 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(124, 58, 237, 0.12) 100%)',
                border: selectedSceneCount === suggestedScenes.count
                  ? '1px solid rgba(16, 185, 129, 0.35)'
                  : '1px solid rgba(56, 189, 248, 0.35)',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
                  <span style={{ fontSize: '15px' }}>💡</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Gợi ý phân cảnh:
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#facc15' }}>
                        {suggestedScenes.label}
                      </span>
                      {selectedSceneCount === suggestedScenes.count ? (
                        <span style={{ fontSize: '10.5px', color: '#10b981', fontWeight: 700, background: 'rgba(16,185,129,0.18)', padding: '1px 7px', borderRadius: '6px' }}>
                          ✓ Đang áp dụng ({suggestedScenes.count} Cảnh)
                        </span>
                      ) : (
                        <span style={{ fontSize: '10.5px', color: '#f59e0b', fontWeight: 600 }}>
                          (Đang chọn {selectedSceneCount} Cảnh)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text)', opacity: 0.9, marginTop: '2px' }}>
                      {suggestedScenes.reason}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {selectedSceneCount !== suggestedScenes.count && (
                    <button
                      type="button"
                      onClick={() => applySceneCount(suggestedScenes.count)}
                      style={{
                        background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                        color: '#fff',
                        border: 'none',
                        padding: '5px 12px',
                        borderRadius: '6px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        boxShadow: '0 2px 6px rgba(2, 132, 199, 0.35)',
                      }}
                      title={`Bấm để chọn ${suggestedScenes.count} Cảnh cho kịch bản`}
                    >
                      <span>⚡ Áp dụng {suggestedScenes.count} Cảnh</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleDeepAiAnalyzeScenes}
                    disabled={isAnalyzingAi}
                    style={{
                      background: 'rgba(124, 58, 237, 0.25)',
                      color: '#c4b5fd',
                      border: '1px solid rgba(124, 58, 237, 0.45)',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: isAnalyzingAi ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    title="Nhờ AI Gemini phân tích chi tiết cốt truyện thành từng cảnh"
                  >
                    <span>{isAnalyzingAi ? '⏳ Đang phân tích...' : '🤖 Phân tích AI'}</span>
                  </button>

                  {suggestedScenes.breakdown && suggestedScenes.breakdown.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSceneBreakdown(prev => !prev)}
                      style={{
                        background: 'transparent',
                        color: 'var(--muted)',
                        border: '1px solid var(--border)',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      {showSceneBreakdown ? 'Thu gọn ▲' : 'Xem cảnh ▼'}
                    </button>
                  )}
                </div>
              </div>

              {showSceneBreakdown && suggestedScenes.breakdown && suggestedScenes.breakdown.length > 0 && (
                <div style={{
                  marginTop: '4px',
                  padding: '8px 10px',
                  background: 'var(--bg2)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  border: '1px dashed rgba(124, 58, 237, 0.4)',
                }}>
                  <div style={{ fontWeight: 700, color: '#c4b5fd', marginBottom: '4px' }}>
                    🎬 Đề xuất phân đoạn cảnh từ AI:
                  </div>
                  <ol style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.5, color: 'var(--text)' }}>
                    {suggestedScenes.breakdown.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '2px' }}>{item}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>

        {promptValidationError && (
          <div role="alert" style={{ marginBottom: '14px', padding: '14px 16px', borderRadius: '12px', border: '1.5px solid #ef4444', background: 'rgba(239, 68, 68, 0.12)', color: '#fee2e2', boxShadow: '0 4px 14px rgba(239, 68, 68, 0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#f87171', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <span>🚫</span>
                  <span>ĐÃ DỪNG KỊCH BẢN: Phân cảnh {promptValidationError.sceneIndex} không đạt chuẩn Veo 3 sau 3 lần sửa</span>
                </div>
                <div style={{ fontSize: '12px', marginTop: '6px', color: '#fca5a5', lineHeight: 1.5 }}>
                  {aiModels.validator.label} đã phát hiện nguy cơ bản quyền / chính sách / mâu thuẫn prompt và đã tự động thử sửa 3 lần nhưng chưa thành công. Vui lòng đổi lại nội dung kịch bản hoặc cốt truyện bên dưới để tránh các nhân vật / từ khóa này.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPromptValidationError(null)}
                style={{ background: 'transparent', border: 'none', color: '#fca5a5', fontSize: '16px', cursor: 'pointer', padding: '2px 6px' }}
                title="Đóng thông báo"
              >
                ✕
              </button>
            </div>

            {promptValidationError.issues && promptValidationError.issues.length > 0 && (
              <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#f87171', marginBottom: '5px' }}>Chi tiết các lỗi phát hiện:</div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11.5px', lineHeight: 1.5 }}>
                  {promptValidationError.issues.map((iss: any, idx: number) => (
                    <li key={idx} style={{ marginBottom: '3px' }}>
                      <span style={{ fontWeight: 700, color: '#fca5a5' }}>[{iss.type}] “{iss.text}”:</span> {iss.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setPromptValidationError(null);
                  const el = document.getElementById('inputStoryDescription');
                  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el?.focus();
                }}
                style={{
                  padding: '7px 14px',
                  borderRadius: '7px',
                  background: '#ef4444',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '12px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ✏️ Đổi lại nội dung kịch bản / Cốt truyện ngay
              </button>
            </div>
          </div>
        )}

        {safetyIssues.length > 0 && (
          <div role="alert" style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.6)', background: 'rgba(127,29,29,0.22)', color: '#fecaca' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '7px' }}>🛡️ Đã dừng gửi nội dung sang Gemini</div>
            <div style={{ fontSize: '11.5px', lineHeight: 1.5, marginBottom: '7px' }}>
              Hãy chỉnh lại cốt truyện, lời thoại hoặc góp ý bên dưới rồi thử lại. Hệ thống chưa gửi yêu cầu render.
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11.5px', lineHeight: 1.55 }}>
              {safetyIssues.map((issue, index) => (
                <li key={`${issue.category}-${index}`}>
                  <strong>{issue.label}:</strong> {issue.guidance}
                  {issue.matchedTerms && issue.matchedTerms.length > 0 && (
                    <span style={{ color: '#fca5a5' }}> — Phần cần xem lại: “{issue.matchedTerms.join('”, “')}”</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-group" style={{ padding: '12px', borderRadius: '10px', border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.08)', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <label style={{ margin: 0, color: '#34d399', fontWeight: 700, fontSize: '13px' }}>
              🎭 Chế độ Render Nhân vật, Hình ảnh & Video
            </label>
            <span style={{ fontSize: '11px', color: visualStyle === 'real' ? '#34d399' : visualStyle === 'stickman' ? '#facc15' : '#c084fc', fontWeight: 700, background: visualStyle === 'real' ? 'rgba(16,185,129,0.18)' : visualStyle === 'stickman' ? 'rgba(234,179,8,0.18)' : 'rgba(139,92,246,0.18)', padding: '2px 8px', borderRadius: '6px', border: visualStyle === 'real' ? '1px solid rgba(16,185,129,0.4)' : visualStyle === 'stickman' ? '1px solid rgba(234,179,8,0.45)' : '1px solid rgba(139,92,246,0.4)' }}>
              {visualStyle === 'real'
                ? '✓ Đang chọn: Người & Động vật thật (Real - Mặc định)'
                : visualStyle === 'stickman'
                  ? '✓ Đang chọn: Người Que Hoạt Hình 2D (Hóa trang theo truyện)'
                  : '✓ Đang chọn: Hoạt hình 3D'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <button
              type="button"
              onClick={() => {
                setVisualStyle('real');
                const updated = { ...promptsObjRef.current, _visualStyle: 'real' };
                promptsObjRef.current = updated;
                setPromptsObj(updated);
                if (Object.keys(updated).length > 1) persistPrompts(updated).catch(() => {});
                showToast('🧑🐾 Đã chuyển sang chế độ: Người & Động vật thật (Real Live-Action)');
              }}
              disabled={isDebating || isPipelineRunning}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: visualStyle === 'real' ? '2px solid #10b981' : '1px solid var(--border)',
                background: visualStyle === 'real' ? 'linear-gradient(135deg, rgba(16,185,129,0.22) 0%, rgba(5,150,105,0.18) 100%)' : 'var(--bg3)',
                color: visualStyle === 'real' ? '#ecfdf5' : 'var(--muted)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: isDebating || isPipelineRunning ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span>🧑🐾 Người & Động vật thật (Real)</span>
              <span style={{ fontSize: '10.5px', fontWeight: 500, color: visualStyle === 'real' ? '#a7f3d0' : 'var(--muted)' }}>
                Render người thật, thú cưng/động vật thật ngoài đời thực (Live-Action 8K)
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setVisualStyle('3d');
                const updated = { ...promptsObjRef.current, _visualStyle: '3d' };
                promptsObjRef.current = updated;
                setPromptsObj(updated);
                if (Object.keys(updated).length > 1) persistPrompts(updated).catch(() => {});
                showToast('🎬 Đã chuyển sang chế độ: Hoạt hình 3D (Cinematic 3D Animation)');
              }}
              disabled={isDebating || isPipelineRunning}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: visualStyle === '3d' ? '2px solid #8b5cf6' : '1px solid var(--border)',
                background: visualStyle === '3d' ? 'linear-gradient(135deg, rgba(139,92,246,0.22) 0%, rgba(99,102,241,0.18) 100%)' : 'var(--bg3)',
                color: visualStyle === '3d' ? '#f5f3ff' : 'var(--muted)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: isDebating || isPipelineRunning ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span>🎬 Hoạt hình 3D (Cinematic 3D)</span>
              <span style={{ fontSize: '10.5px', fontWeight: 500, color: visualStyle === '3d' ? '#ddd6fe' : 'var(--muted)' }}>
                Render nhân vật và bối cảnh theo phong cách điện ảnh hoạt hình 3D CGI
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setVisualStyle('stickman');
                const updated = { ...promptsObjRef.current, _visualStyle: 'stickman' };
                promptsObjRef.current = updated;
                setPromptsObj(updated);
                if (Object.keys(updated).length > 1) persistPrompts(updated).catch(() => {});
                showToast('🎨 Đã chuyển sang chế độ: Người Que Hoạt Hình 2D (Hóa trang & Diễn theo truyện)');
              }}
              disabled={isDebating || isPipelineRunning}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                border: visualStyle === 'stickman' ? '2px solid #eab308' : '1px solid var(--border)',
                background: visualStyle === 'stickman' ? 'linear-gradient(135deg, rgba(234,179,8,0.22) 0%, rgba(202,138,4,0.18) 100%)' : 'var(--bg3)',
                color: visualStyle === 'stickman' ? '#fef9c3' : 'var(--muted)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: isDebating || isPipelineRunning ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span>🎨 Người Que 2D (Roleplay Stickman)</span>
              <span style={{ fontSize: '10.5px', fontWeight: 500, color: visualStyle === 'stickman' ? '#fde047' : 'var(--muted)' }}>
                Người que mũm mĩm hóa trang & hành động 100% theo chủ đề (Đá bóng, Cổ trang, Review...)
              </span>
            </button>
          </div>
        </div>

        <div className="form-group" style={{ padding: '12px', borderRadius: '10px', border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.07)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <label style={{ margin: 0, color: '#fbbf24', fontWeight: 700 }}>🎨 Phong cách thế giới & bối cảnh</label>
            <button
              type="button"
              onClick={() => handleAnalyzeWorldStyle()}
              disabled={isAnalyzingWorldStyle || !productDescription.trim()}
              style={{ background: 'rgba(124,58,237,0.22)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.45)', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: isAnalyzingWorldStyle ? 'not-allowed' : 'pointer' }}
            >
              {isAnalyzingWorldStyle ? '⏳ AI đang phân tích...' : '🤖 Phân tích & gợi ý lại'}
            </button>
          </div>
          <select
            value={worldStyle}
            onChange={(e) => {
              const value = e.target.value;
              setWorldStyle(value);
              persistProductFeedback({ world_style: value });
            }}
            disabled={isDebating || isPipelineRunning}
            style={{ width: '100%', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid rgba(245,158,11,0.4)', padding: '8px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 650, outline: 'none' }}
          >
            {WORLD_STYLE_OPTIONS.map((style) => (
              <option key={style.id} value={style.id}>{style.label} — {style.description}</option>
            ))}
          </select>
          {suggestedWorldStyle && (
            <div style={{ marginTop: '8px', fontSize: '11px', lineHeight: 1.45, color: 'var(--text)' }}>
              <span style={{ color: '#10b981', fontWeight: 700 }}>AI đề xuất: {WORLD_STYLE_OPTIONS.find((item) => item.id === suggestedWorldStyle.style)?.label}</span>
              <span style={{ color: 'var(--muted)' }}> — {suggestedWorldStyle.reason}</span>
              {worldStyle !== suggestedWorldStyle.style && (
                <span style={{ marginLeft: '6px', color: '#f59e0b', fontWeight: 700 }}>(Bạn đã chọn lại phong cách khác)</span>
              )}
            </div>
          )}
          <div style={{ marginTop: '6px', fontSize: '10.5px', color: 'var(--muted)' }}>
            Phong cách cuối cùng do bạn chọn sẽ được khóa đồng nhất trong kịch bản, ảnh 6 step và video của tất cả Part.
          </div>
        </div>

        <div className="form-group">
          <label>Custom Prompt / Kịch bản (JSON hoặc Text) <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(Tùy chọn)</span></label>
          <textarea
            id="inputCustomPrompt"
            rows={4}
            value={customPromptText}
            onChange={(e) => handleCustomPromptChange(e.target.value)}
            onBlur={handleCustomPromptBlur}
            style={{ width: '100%', padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            placeholder="Dán kịch bản JSON (prompt1..6) hoặc prompt tại đây... Nếu để trống AI sẽ tự sinh."
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px', padding: '12px 14px', background: 'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(59,130,246,0.1) 100%)', borderRadius: '12px', border: '1px solid rgba(124,58,237,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#c4b5fd' }}>
              <input type="checkbox" checked={aiConsensusEnabled} onChange={(e) => setAiConsensusEnabled(e.target.checked)} style={{ accentColor: '#7c3aed', width: '16px', height: '16px' }} />
              <span>🤝 2-AI Validation ({aiModels.ai1.label} sáng tác, {aiModels.ai2.label} kiểm định)</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {suggestedScenes && selectedSceneCount !== suggestedScenes.count && (
                <button
                  type="button"
                  onClick={() => applySceneCount(suggestedScenes.count)}
                  style={{
                    background: 'rgba(234, 179, 8, 0.15)',
                    border: '1px solid rgba(234, 179, 8, 0.45)',
                    color: '#facc15',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title={`Cốt truyện phù hợp nhất với ${suggestedScenes.count} Cảnh. Bấm để áp dụng nhanh!`}
                >
                  <span>💡 Gợi ý: {suggestedScenes.count} Cảnh</span>
                </button>
              )}
              <select
                value={selectedSceneCount}
                onChange={(e) => applySceneCount(parseInt(e.target.value, 10), false)}
                disabled={isDebating}
                title="Chọn số lượng cảnh / thời lượng video"
                style={{
                  background: 'var(--bg2)',
                  border: '1px solid rgba(124,58,237,0.4)',
                  color: 'var(--text)',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {SCENE_OPTIONS.map((opt) => {
                  const isSuggested = suggestedScenes?.count === opt.count;
                  return (
                    <option key={opt.count} value={opt.count}>
                      {opt.fullLabel} {isSuggested ? '⭐ (💡 Gợi ý theo cốt truyện)' : ''}
                    </option>
                  );
                })}
              </select>
              <button type="button" onClick={() => triggerAiConsensusDebate()} disabled={isDebating} id="btnTriggerConsensus" style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: isDebating ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s' }}>
                <span>{isDebating ? '⏳ Đang thảo luận 2 AI...' : '✨ Thảo luận 2 AI ngay'}</span>
              </button>
              {isDebating && (
                <button
                  type="button"
                  onClick={handleStopPipeline}
                  id="btnCancelConsensus"
                  style={{
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.55)',
                    color: '#f87171',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title="Hủy ngay phiên thảo luận 2 AI đang chạy"
                >
                  <span>⛔ Hủy Thảo Luận</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleManualPreflightCheck()}
                disabled={isDebating || isPreflightChecking}
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  color: '#34d399',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isDebating || isPreflightChecking ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.15s',
                }}
                title={`Dùng ${aiModels.validator.label} kiểm tra bản quyền, an toàn và tự động sửa tối đa 3 lần cho từng prompt`}
              >
                <span>{isPreflightChecking ? '🛡️ Đang kiểm định...' : `🛡️ Kiểm tra Prompt (${aiModels.validator.label})`}</span>
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '5px' }}><span>💡 Góp ý / Chỉ đạo kịch bản cho 2 AI (Tùy chọn):</span></label>
            <textarea id="inputAiConsensusFeedback" rows={2} value={consensusPreFeedback} onChange={(e) => setConsensusPreFeedback(e.target.value)} onBlur={(e) => persistProductFeedback({ consensus_feedback: e.target.value })} placeholder="VD: Sao lại ra 2 gấu đen ở step 2? Đổi thành 2 chú mèo; cảnh 3 vui vẻ hơn..." style={{ width: '100%', padding: '8px 12px', background: 'var(--bg3)', border: '1px solid rgba(124,58,237,0.35)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px', outline: 'none', resize: 'vertical', minHeight: '44px', fontFamily: 'inherit', lineHeight: 1.4, boxSizing: 'border-box' }} />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>🎯 <strong>Điều kiện dừng:</strong> Phản biện lặp vòng không giới hạn round, chỉ dừng khi 2 AI đạt <strong>100% đồng thuận</strong>.<br />🔒 <strong>Khóa nhân vật & Bố cục:</strong> Nhân vật bám sát 100% ảnh & mô tả (loài, ngoại hình, trang phục) • Bố cục tiền cảnh/hậu cảnh & cốt truyện 6 cảnh chặt chẽ.</div>

          {showDebateBox && (
            <div style={{ marginTop: '6px', padding: '12px', background: 'var(--bg2)', borderRadius: '10px', border: '1px solid var(--border)', maxHeight: '580px', overflowY: 'auto', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tiến trình:</span>
                {Array.from({ length: Math.max(currentDebateRound, 1) }).map((_, rIdx) => {
                  const rNum = rIdx + 1;
                  const isCurrent = rNum === currentDebateRound && isDebating;
                  const isPast = rNum < currentDebateRound;
                  const isConsensus100 = !isDebating && debateStatusText.includes('100%');
                  return (
                    <div key={rNum} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 11px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: isCurrent ? 'linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(236,72,153,0.25) 100%)' : isPast ? 'rgba(124,58,237,0.12)' : isConsensus100 ? 'rgba(16,185,129,0.15)' : 'var(--bg3)', border: isCurrent ? '1.5px solid #ec4899' : isPast ? '1px solid rgba(139,92,246,0.4)' : isConsensus100 ? '1px solid #10b981' : '1px solid var(--border)', color: isCurrent ? '#f472b6' : isPast ? '#a78bfa' : isConsensus100 ? '#10b981' : 'var(--muted)', animation: isCurrent ? 'activeRoundGlow 1.8s infinite' : 'none', transition: 'all 0.25s ease' }}>
                      {isCurrent ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ec4899', animation: 'livePulse 1.2s infinite', display: 'inline-block' }} /> : isPast ? <span style={{ color: '#a78bfa' }}>✓</span> : isConsensus100 ? <span style={{ color: '#10b981' }}>★</span> : null}
                      <span>Round {rNum}</span>
                      {isCurrent && <span style={{ fontSize: '9.5px', background: 'rgba(236,72,153,0.35)', color: '#fff', padding: '1px 6px', borderRadius: '6px', letterSpacing: '0.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span>ĐANG CHẠY</span><span style={{ fontFamily: 'monospace', fontSize: '9.5px' }}>({formatTimer(debateElapsedSec)})</span></span>}
                    </div>
                  );
                })}
              </div>

              {debateStatusText && <div style={{ fontWeight: 700, fontSize: '12px', color: isDebating ? '#c084fc' : debateStatusText.includes('100%') ? '#10b981' : '#8b5cf6', marginBottom: '10px', padding: '9px 12px', borderRadius: '8px', background: isDebating ? 'linear-gradient(90deg, rgba(139,92,246,0.15) 0%, rgba(236,72,153,0.18) 50%, rgba(139,92,246,0.15) 100%)' : debateStatusText.includes('100%') ? 'rgba(16,185,129,0.12)' : 'var(--bg3)', backgroundSize: isDebating ? '200% 100%' : 'auto', animation: isDebating ? 'shimmerSweep 3s linear infinite' : 'none', border: isDebating ? '1px solid rgba(236,72,153,0.45)' : debateStatusText.includes('100%') ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isDebating ? <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: currentActiveAi === 'ai2' ? '#f59e0b' : '#ec4899', animation: 'livePulse 1s infinite', flexShrink: 0 }} /> : debateStatusText.includes('100%') ? <span style={{ fontSize: '14px' }}>🎉</span> : <span style={{ fontSize: '14px' }}>💬</span>}
                  <span>{debateStatusText}</span>
                </div>
                {isDebating && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}><span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, background: 'var(--bg3)', border: '1px solid rgba(56,189,248,0.4)', padding: '2px 8px', borderRadius: '12px', fontFamily: 'monospace' }}>⏱️ {formatTimer(debateElapsedSec)}</span><span style={{ fontSize: '10.5px', color: '#f472b6', fontWeight: 700, background: 'rgba(236,72,153,0.2)', padding: '2px 8px', borderRadius: '6px' }}>Round {currentDebateRound}</span><button type="button" onClick={handleStopPipeline} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.5)', color: '#f87171', padding: '2px 8px', borderRadius: '6px', fontSize: '10.5px', fontWeight: 700, cursor: 'pointer' }}>⛔ Hủy</button></div>}
              </div>}

              <DebateFeedView
                messages={debateMessages}
                currentRound={currentDebateRound}
                isDebating={isDebating}
                onOpenPartEditor={handleOpenPartEditor}
                onSavePartPrompt={handleSavePartPromptInModal}
                onApplyFullScript={handleApplyFullScriptFromDebate}
              />

              {isDebating && <div style={{ padding: '10px 14px', borderRadius: '8px', background: currentActiveAi === 'ai2' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(139, 92, 246, 0.1)', border: `1.5px dashed ${currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7'}`, animation: 'activeRoundGlow 2s infinite alternate', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '6px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><div style={{ width: '28px', height: '28px', borderRadius: '50%', background: currentActiveAi === 'ai2' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(139, 92, 246, 0.2)', border: `1px solid ${currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>{currentActiveAi === 'ai2' ? '🧐' : '🎭'}</div><div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span style={{ fontSize: '11.5px', fontWeight: 700, color: currentActiveAi === 'ai2' ? '#fbbf24' : '#c084fc' }}>{currentActiveAi === 'ai2' ? `${aiModels.ai2.name} đang kiểm định tiêu chí Round ${currentDebateRound}...` : `${aiModels.ai1.name} đang sáng tác kịch bản Round ${currentDebateRound}...`}</span><span style={{ fontSize: '10px', color: 'var(--muted)' }}>{currentActiveAi === 'ai2' ? `Đang đối chiếu ảnh mẫu, tỷ lệ Chibi và kiểm định bối cảnh ${getDynamicSceneCount()} Part` : 'Đang khởi tạo lời thoại, hành động và bố cục Pixar 3D sinh động'}</span></div></div></div>}
            </div>
          )}

          {showDebateBox && <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'flex-start' }}><textarea rows={2} value={liveDebateFeedback} onChange={(e) => setLiveDebateFeedback(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendLiveDebateFeedback(); } }} placeholder="💬 Góp ý trực tiếp cho 2 AI (VD: Step 2 đổi thành 2 chú mèo... Enter để gửi)" style={{ flex: 1, padding: '7px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', outline: 'none', resize: 'vertical', minHeight: '40px', fontFamily: 'inherit', lineHeight: 1.4, boxSizing: 'border-box' }} /><button type="button" onClick={handleSendLiveDebateFeedback} disabled={isDebating || !liveDebateFeedback.trim()} style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', height: 'fit-content' }}>💬 Gửi góp ý</button></div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px', padding: '12px 14px', background: 'linear-gradient(135deg, rgba(236,72,153,0.08) 0%, rgba(245,158,11,0.08) 100%)', borderRadius: '12px', border: '1px solid rgba(236,72,153,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#f472b6' }}><input type="checkbox" checked={autoSceneImages} onChange={(e) => setAutoSceneImages(e.target.checked)} style={{ accentColor: '#ec4899', width: '16px', height: '16px' }} /><span>🎨 Tự động tạo {getDynamicSceneCount()} ảnh phân cảnh bằng Gemini trước khi tạo Video</span></label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => handleMergeVideos('full')} id="btnMergeVideosQuick" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>🎬 Ghép Video Hoàn Chỉnh (Full 1 Tập)</button>
              <button type="button" onClick={handleDubVideo} disabled={isDubbing || isPipelineRunning} id="btnDubVideoQuick" style={{ background: isDubbing ? '#6b7280' : 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: isDubbing ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', boxShadow: isDubbing ? 'none' : '0 2px 8px rgba(16,185,129,0.35)', transition: 'all 0.2s ease' }}>{isDubbing ? '⏳ Đang lồng tiếng...' : '🎙️ Lồng Tiếng AI'}</button>
            </div>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>📸 Gemini phân tích ảnh gốc + prompt để sinh {getDynamicSceneCount()} ảnh hoạt hình 3D Pixar chi tiết trước. Bạn có thể chọn và chỉnh sửa/tạo lại từng Part riêng lẻ (Part 1 ➔ {getDynamicSceneCount()}).</div>

          <StoryboardGrid
            productName={productName}
            promptsObj={promptsObj}
            sceneImages={sceneImages}
            sceneUrls={sceneUrls}
            drawingParts={drawingParts}
            renderingParts={renderingParts}
            pipelineStatusText={pipelineStatusText}
            isPipelineRunning={isPipelineRunning}
            episodes={episodes}
            batchFeedback={partFeedback}
            onChangeBatchFeedback={setPartFeedback}
            onBlurBatchFeedback={(val) => persistProductFeedback({ part_feedback: val })}
            isRevisingPrompts={isRevisingPrompts}
            revisingStage={revisingStage}
            revisingElapsedSec={revisingElapsedSec}
            revisingStatusText={revisingStatusText}
            revisingTargetParts={revisingTargetParts}
            videoRenderMode={videoRenderMode}
            onChangeVideoRenderMode={handleSetVideoRenderMode}
            includePrevFrame={includePrevFrame}
            onChangeIncludePrevFrame={setIncludePrevFrame}
            refImagesMode={refImagesMode}
            onChangeRefImagesMode={setRefImagesMode}
            visualStyle={visualStyle}
            onChangeVisualStyle={(mode) => {
              setVisualStyle(mode);
              const updated = { ...promptsObjRef.current, _visualStyle: mode };
              promptsObjRef.current = updated;
              setPromptsObj(updated);
              if (Object.keys(updated).length > 1) persistPrompts(updated).catch(() => {});
              showToast(mode === 'real' ? '🧑🐾 Đã chuyển sang mode: Người & Động vật thật (Real)' : '🎬 Đã chuyển sang mode: Hoạt hình 3D');
            }}
            onOpenPartEditor={handleOpenPartEditor}
            onRedrawSingleImage={handleRedrawSingleImage}
            onRenderSingleVideo={handleRenderSingleVideo}
            onBatchRevisePrompts={handleBatchRevisePrompts}
            onBatchRenderImages={handleBatchRenderImages}
            onBatchRenderVideos={handleBatchRenderVideos}
            onRunAllFlow={handleRunAllFlow}
            onStopPipeline={handleStopPipeline}
            onZoomImage={(idx) => setLightboxIndex(idx)}
            onSavePartPrompt={handleSavePartPromptInModal}
            onRevisePartPrompt={(partNum, feedback) => handleBatchRevisePrompts([partNum - 1], feedback)}
            expectedSceneCount={getDynamicSceneCount()}
            aiModels={aiModels}
          />

          {/* ✂️ Quản lý Phân Tập Shorts & Export (1 Story ➔ Nhiều Bản Xuất) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px 16px', background: 'rgba(30, 27, 75, 0.45)', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.35)', marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#c084fc' }}>
                    ✂️ Phân Tập Shorts & Xuất Video (1 Story ➔ Nhiều Bản Export)
                  </span>
                  <span style={{ fontSize: '10.5px', background: 'rgba(139, 92, 246, 0.25)', color: '#e9d5ff', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.45)', fontWeight: 600 }}>
                    {episodes.length} Tập đã định nghĩa
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>
                  Định nghĩa điểm cắt theo nhịp kịch bản (Narrative Beats) thay vì cắt cứng. Render video 1 lần duy nhất, xuất linh hoạt bản Full lẫn từng tập Shorts!
                </div>
              </div>

              {/* Presets */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => applyPresetEpisodes(1)}
                  style={{ background: 'rgba(16, 185, 129, 0.18)', border: '1px solid rgba(16, 185, 129, 0.45)', color: '#10b981', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  title="Chỉ xuất 1 tập duy nhất bao gồm toàn bộ scene (Mặc định)"
                >
                  🎬 1 Tập Full (Mặc định)
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetEpisodes(2)}
                  style={{ background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.35)', color: '#f472b6', padding: '4px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  title="Tự động chia kịch bản thành 2 tập"
                >
                  ⚡ Tự động 2 Tập
                </button>
                <button
                  type="button"
                  onClick={() => applyPresetEpisodes(3)}
                  style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.35)', color: '#60a5fa', padding: '4px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                  title="Tự động chia kịch bản thành 3 tập"
                >
                  ⚡ Tự động 3 Tập
                </button>
                <button
                  type="button"
                  onClick={handleAddEpisode}
                  style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ➕ Thêm Tập
                </button>
              </div>
            </div>

            {/* Episodes List Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: episodes.length > 2 ? 'repeat(auto-fit, minmax(280px, 1fr))' : 'repeat(auto-fit, minmax(320px, 1fr))', gap: '10px' }}>
              {episodes.map((ep, idx) => {
                const sceneRange = ep.endScene - ep.startScene + 1;
                const estSec = Math.max(0, sceneRange) * 8;
                const totalScenes = getDynamicSceneCount();
                return (
                  <div
                    key={ep.id || idx}
                    style={{
                      background: 'var(--bg2)',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#f472b6' }}>
                        📺 TẬP {idx + 1}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '10.5px', color: '#38bdf8', fontWeight: 600, background: 'rgba(56, 189, 248, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                          ⏱️ {sceneRange} Cảnh (~{estSec}s)
                        </span>
                        {episodes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveEpisode(idx)}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: '14px', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                            title="Xóa tập này"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: '10.5px', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Tên Tập / Nhịp kịch bản:</label>
                      <input
                        type="text"
                        value={ep.title}
                        onChange={(e) => handleUpdateEpisode(idx, 'title', e.target.value)}
                        placeholder={`VD: Tập ${idx + 1}: Lời Thách Đấu...`}
                        style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 8px', color: 'var(--text)', fontSize: '12px' }}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '10.5px', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Từ Scene:</label>
                        <select
                          value={ep.startScene}
                          onChange={(e) => handleUpdateEpisode(idx, 'startScene', parseInt(e.target.value, 10))}
                          style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 6px', color: 'var(--text)', fontSize: '11.5px' }}
                        >
                          {Array.from({ length: totalScenes }, (_, i) => i + 1).map((s) => (
                            <option key={s} value={s}>Scene {s}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '10.5px', color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Đến Scene:</label>
                        <select
                          value={ep.endScene}
                          onChange={(e) => handleUpdateEpisode(idx, 'endScene', parseInt(e.target.value, 10))}
                          style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 6px', color: 'var(--text)', fontSize: '11.5px' }}
                        >
                          {Array.from({ length: totalScenes }, (_, i) => i + 1).map((s) => (
                            <option key={s} value={s}>Scene {s}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Export Action Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', paddingTop: '6px', borderTop: '1px dashed rgba(255, 255, 255, 0.1)' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                ⚡ Ghép stream FFmpeg siêu tốc (1–2 giây, không tốn thêm token/credit Veo)
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleMergeVideos('full')}
                  disabled={isMerging || isPipelineRunning}
                  style={{ background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)', color: '#fff', border: 'none', padding: '7px 12px', borderRadius: '7px', fontSize: '11.5px', fontWeight: 700, cursor: isMerging ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  🎬 Ghép 1 Bản Full
                </button>
                <button
                  type="button"
                  onClick={() => handleMergeVideos('episodes')}
                  disabled={isMerging || isPipelineRunning}
                  style={{ background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)', color: '#fff', border: 'none', padding: '7px 12px', borderRadius: '7px', fontSize: '11.5px', fontWeight: 700, cursor: isMerging ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  ✂️ Ghép {episodes.length} Tập Shorts
                </button>
                <button
                  type="button"
                  onClick={() => handleMergeVideos('all')}
                  disabled={isMerging || isPipelineRunning}
                  style={{ background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: '7px', fontSize: '11.5px', fontWeight: 700, cursor: isMerging ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)' }}
                >
                  🚀 Ghép Toàn Bộ (Full + Các Tập)
                </button>
              </div>
            </div>

            {/* Ready-to-Download Section */}
            {(mergedFullUrl || mergedEpisodesResult.length > 0) && (
              <div style={{ marginTop: '4px', padding: '12px 14px', background: 'rgba(16, 185, 129, 0.1)', border: '1.5px solid rgba(16, 185, 129, 0.4)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#34d399' }}>
                    🎉 Video đã xuất thành công — Sẵn sàng tải xuống hoặc đăng YouTube:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setYoutubeTarget('full');
                      setShowYouTubeModal(true);
                    }}
                    style={{
                      background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                      color: '#fff',
                      border: 'none',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: '0 2px 8px rgba(239, 68, 68, 0.35)',
                    }}
                    title="Đăng video lên YouTube (Full hoặc Shorts theo từng tập)"
                  >
                    🚀 Đăng Lên YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFacebookTarget('full');
                      setShowFacebookModal(true);
                    }}
                    style={{
                      background: 'linear-gradient(135deg, #1877f2 0%, #0064e0 100%)',
                      color: '#fff',
                      border: 'none',
                      padding: '5px 12px',
                      borderRadius: '7px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: '0 2px 8px rgba(24, 119, 242, 0.35)',
                    }}
                    title="Đăng video lên Facebook (Reels hoặc Video Fanpage)"
                  >
                    🔵 Đăng Lên FB
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {mergedFullUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg2)', padding: '8px 12px', borderRadius: '7px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px' }}>🎬</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>Bản Full Hoàn Chỉnh (Toàn bộ Scene 1..{getDynamicSceneCount()})</div>
                          <div style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Dành cho YouTube dài, Facebook hoặc lưu trữ bản gốc</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <a href={mergedFullUrl} target="_blank" rel="noreferrer" style={{ background: 'rgba(59, 130, 246, 0.18)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#60a5fa', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>
                          ▶️ Xem
                        </a>
                        <a href={`/api/videos/download?url=${encodeURIComponent(mergedFullUrl)}&filename=${encodeURIComponent(`${productName || 'video'}_full`)}`} download={`${productName || 'video'}_full.mp4`} style={{ background: '#2563eb', color: '#fff', padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          ⬇️ Tải Bản Full (.mp4)
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setYoutubeTarget('full');
                            setShowYouTubeModal(true);
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#f87171',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title="Đăng Bản Full lên YouTube"
                        >
                          🔴 YouTube
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFacebookTarget('full');
                            setShowFacebookModal(true);
                          }}
                          style={{
                            background: 'rgba(24, 119, 242, 0.15)',
                            border: '1px solid rgba(24, 119, 242, 0.4)',
                            color: '#60a5fa',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title="Đăng Bản Full lên Facebook"
                        >
                          🔵 Facebook
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTiktokTarget('full');
                            setShowTikTokModal(true);
                          }}
                          style={{
                            background: 'rgba(254, 44, 85, 0.15)',
                            border: '1px solid rgba(254, 44, 85, 0.4)',
                            color: '#ff6b8b',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title="Đăng Bản Full lên TikTok Studio bằng Puppeteer Bot"
                        >
                          🎵 TikTok
                        </button>
                      </div>
                    </div>
                  )}

                  {mergedEpisodesResult.map((ep, idx) => (
                    <div key={ep.id || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg2)', padding: '8px 12px', borderRadius: '7px', border: '1px solid rgba(236, 72, 153, 0.25)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px' }}>✂️</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: '#f472b6' }}>
                            {ep.title} (Scene {ep.startScene}..{ep.endScene})
                          </div>
                          <div style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Tối ưu độ dài YouTube Shorts / TikTok / Reels</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <a href={ep.video_url} target="_blank" rel="noreferrer" style={{ background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.35)', color: '#f472b6', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>
                          ▶️ Xem
                        </a>
                        <a href={`/api/videos/download?url=${encodeURIComponent(ep.video_url)}&filename=${encodeURIComponent(`${productName || 'video'}_ep${idx + 1}`)}`} download={`${productName || 'video'}_ep${idx + 1}.mp4`} style={{ background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)', color: '#fff', padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          ⬇️ Tải Tập {idx + 1} (.mp4)
                        </a>
                        {ep.voiced_url && (
                          <a href={`/api/videos/download?url=${encodeURIComponent(ep.voiced_url)}&filename=${encodeURIComponent(`${productName || 'video'}_ep${idx + 1}_voiced`)}`} download={`${productName || 'video'}_ep${idx + 1}_voiced.mp4`} style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            🎙️ Tải Lồng Tiếng
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setYoutubeTarget(ep.id || String(idx));
                            setShowYouTubeModal(true);
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#f87171',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title={`Đăng ${ep.title} lên YouTube Shorts`}
                        >
                          🔴 YouTube
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFacebookTarget(ep.id || String(idx));
                            setShowFacebookModal(true);
                          }}
                          style={{
                            background: 'rgba(24, 119, 242, 0.15)',
                            border: '1px solid rgba(24, 119, 242, 0.4)',
                            color: '#60a5fa',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title={`Đăng ${ep.title} lên Facebook Reel (Video Ngắn)`}
                        >
                          📱 FB Reel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTiktokTarget(ep.id || String(idx));
                            setShowTikTokModal(true);
                          }}
                          style={{
                            background: 'rgba(254, 44, 85, 0.15)',
                            border: '1px solid rgba(254, 44, 85, 0.4)',
                            color: '#ff6b8b',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title={`Đăng ${ep.title} lên TikTok Studio bằng Puppeteer Bot`}
                        >
                          🎵 TikTok
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', padding: '12px', background: 'var(--bg3)', borderRadius: '10px', border: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', cursor: 'pointer' }}><span>☁️ Upload to S3</span><input type="checkbox" checked={uploadS3} onChange={(e) => setUploadS3(e.target.checked)} style={{ accentColor: '#7c3aed', width: '16px', height: '16px' }} /></label>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', cursor: 'pointer', color: 'var(--muted)' }}><span>🎵 Publish TikTok</span><input type="checkbox" checked={publishTiktok} onChange={(e) => setPublishTiktok(e.target.checked)} style={{ accentColor: '#7c3aed', width: '16px', height: '16px' }} /></label>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="button" onClick={handleStopPipeline} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.45)', color: '#f87171', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>⛔ Dừng Lại (Stop)</button>
            <button className="btn-cancel" onClick={handleClose}>Đóng</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="button" className="btn-submit" onClick={handleSavePrompt} disabled={isSavingPromptMain} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'none', fontWeight: 600, opacity: isSavingPromptMain ? 0.7 : 1, cursor: isSavingPromptMain ? 'not-allowed' : 'pointer' }}>{isSavingPromptMain ? '⏳ Đang lưu...' : '💾 Lưu Kịch Bản'}</button>
            <button type="button" onClick={() => handleRunAllFlow('', -99)} disabled={isPipelineRunning} style={{ background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: isPipelineRunning ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', boxShadow: '0 3px 12px rgba(139,92,246,0.4)' }}>🚀 Run All Flow Tạo Video</button>
          </div>
        </div>
      </div>

      {editingPartNum !== null && (
        <PartEditorModal
          isOpen={editingPartNum !== null}
          onClose={() => setEditingPartNum(null)}
          partNum={editingPartNum}
          expectedSceneCount={selectedSceneCount || getDynamicSceneCount()}
          productName={productName}
          productDescription={productDescription}
          category={category}
          originalImageUrl={imageUrl}
          promptsObj={promptsObj}
          sceneImages={sceneImages}
          sceneUrls={sceneUrls}
          onSwitchPart={handleOpenPartEditor}
          onSavePartPrompt={handleSavePartPromptInModal}
          onRedrawSingleImage={handleRedrawSingleImage}
          onRenderSingleVideo={handleRenderSingleVideo}
          includePrevFrame={includePrevFrame}
          refImagesMode={refImagesMode}
          visualStyle={visualStyle}
          onChangeVisualStyle={(mode) => {
            setVisualStyle(mode);
            const updated = { ...promptsObjRef.current, _visualStyle: mode };
            promptsObjRef.current = updated;
            setPromptsObj(updated);
            if (Object.keys(updated).length > 1) persistPrompts(updated).catch(() => {});
            showToast(
              mode === 'real'
                ? '🧑🐾 Đã chuyển sang mode: Người & Động vật thật (Real)'
                : mode === 'stickman'
                  ? '✏️ Đã chuyển sang mode: Stickman 2D'
                  : '🎬 Đã chuyển sang mode: Hoạt hình 3D'
            );
          }}
          onRevisePrompt={(feedback) => handleBatchRevisePrompts([editingPartNum - 1], feedback)}
          isRevisingPrompts={isRevisingPrompts && revisingTargetParts.includes(editingPartNum - 1)}
          revisingStatusText={revisingTargetParts.includes(editingPartNum - 1) ? revisingStatusText : ''}
          otherPartRevisingNotice={isRevisingPrompts && !revisingTargetParts.includes(editingPartNum - 1) ? `AI đang bận sửa Part ${revisingTargetParts.map(i => i + 1).join(', ')}, vui lòng đợi hoàn tất...` : undefined}
          onStopPipeline={handleStopPipeline}
          onOpenLightbox={(img, title, idx) => setLightboxIndex(idx)}
          onRefreshPartsStatus={handleModalRefreshPartsStatus}
        />
      )}

      {promptValidationError && (
        <PromptValidationErrorDialog
          isOpen={Boolean(promptValidationError)}
          data={promptValidationError}
          onClose={() => setPromptValidationError(null)}
          onChangeContent={() => {
            setPromptValidationError(null);
            setTimeout(() => {
              const el =
                document.getElementById('inputStoryDescription') ||
                document.getElementById('inputProductDescription');
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.focus();
              }
            }, 100);
          }}
          onEditSceneManual={(sceneIdx) => {
            setPromptValidationError(null);
            handleOpenPartEditor(sceneIdx);
          }}
        />
      )}

      {lightboxIndex !== null && <Lightbox imageUrl={sceneImages[lightboxIndex] || null} images={sceneImages.filter(Boolean).length > 0 ? sceneImages : [imageUrl].filter(Boolean)} currentIndex={lightboxIndex} dialogues={Array.from({ length: getDynamicSceneCount() }, (_, i) => promptsObj[`dialogue${i + 1}`] || '')} title={`Phân Cảnh ${lightboxIndex + 1}: Bảng Diễn Hoạt`} onClose={() => setLightboxIndex(null)} />}
      {refLightboxIndex !== null && (() => {
        const refImgs = (galleryImages.length > 0 ? galleryImages : [imageUrl]).filter(Boolean) as string[];
        return <Lightbox imageUrl={refImgs[refLightboxIndex] || null} images={refImgs} currentIndex={refLightboxIndex} title="Ảnh gốc đối chiếu" onClose={() => setRefLightboxIndex(null)} />;
      })()}

      {showYouTubeModal && (
        <YouTubePublishModal
          isOpen={showYouTubeModal}
          onClose={() => setShowYouTubeModal(false)}
          defaultTitle={productName ? `${productName} | Hoạt Hình Chibi` : 'Hoạt Hình Chibi'}
          defaultDescription={customPromptText || 'Video hoạt hình chibi độc đáo được tạo tự động bởi AI.'}
          defaultTags={['hoathinh', 'chibi', 'truyenngungon', 'shorts', productName.toLowerCase().replace(/\s+/g, '')].filter(Boolean)}
          defaultThumbnailUrl={sceneImages[0] || imageUrl || ''}
          sceneImages={sceneImages}
          videoId={currentProductId || initialProduct?.id}
          youtubeVideoId={(initialProduct as any)?.youtube_video_id}
          videoUrl={mergedFullUrl || (mergedEpisodesResult.length > 0 ? mergedEpisodesResult[0].video_url : '')}
          episodes={mergedEpisodesResult.map((ep) => ({
            id: ep.id,
            title: ep.title,
            video_url: ep.voiced_url || ep.video_url,
            local_path: ep.voiced_path || ep.local_path,
            thumbnail_url: ep.thumbnail_url || sceneImages[0] || imageUrl || '',
          }))}
          initialTarget={youtubeTarget}
          onSuccess={() => {
            showToast('🎉 Đăng video lên YouTube thành công!');
          }}
        />
      )}

      {showFacebookModal && (
        <FacebookPublishModal
          isOpen={showFacebookModal}
          onClose={() => setShowFacebookModal(false)}
          defaultTitle={productName ? `${productName} | Hoạt Hình Chibi` : 'Hoạt Hình Chibi'}
          defaultDescription={customPromptText || 'Video hoạt hình chibi độc đáo được tạo tự động bởi AI.'}
          defaultTags={['hoathinh', 'chibi', 'truyenngungon', 'reels', productName.toLowerCase().replace(/\s+/g, '')].filter(Boolean)}
          defaultThumbnailUrl={sceneImages[0] || imageUrl || ''}
          videoId={currentProductId || initialProduct?.id}
          videoUrl={mergedFullUrl || (mergedEpisodesResult.length > 0 ? mergedEpisodesResult[0].video_url : '')}
          episodes={mergedEpisodesResult.map((ep) => ({
            id: ep.id,
            title: ep.title,
            video_url: ep.voiced_url || ep.video_url,
            local_path: ep.voiced_path || ep.local_path,
            thumbnail_url: ep.thumbnail_url || sceneImages[0] || imageUrl || '',
          }))}
          initialTarget={facebookTarget}
          onSuccess={() => {
            showToast('🎉 Đăng video lên Facebook thành công!');
          }}
        />
      )}

      {showTikTokModal && (
        <TikTokPublishModal
          isOpen={showTikTokModal}
          onClose={() => setShowTikTokModal(false)}
          defaultTitle={productName ? `${productName} | Hoạt Hình Hài Hước` : 'Mây TV - Hoạt Hình Hài Hước'}
          defaultDescription={customPromptText || 'Video hoạt hình 3D hài hước được tạo tự động bởi AI.'}
          defaultTags={[
            'MayTV',
            'HaiHuoc',
            '3DAnimation',
            'Comedy',
            'FunnyShorts',
            'viral',
            'fyp',
            productName.toLowerCase().replace(/\s+/g, ''),
          ].filter(Boolean)}
          defaultThumbnailUrl={sceneImages[0] || imageUrl || ''}
          videoId={currentProductId || initialProduct?.id}
          productId={currentProductId || initialProduct?.id}
          productName={productName}
          videoUrl={mergedFullUrl || (mergedEpisodesResult.length > 0 ? mergedEpisodesResult[0].video_url : '')}
          episodes={mergedEpisodesResult.map((ep) => ({
            id: ep.id,
            title: ep.title,
            video_url: ep.voiced_url || ep.video_url,
            local_path: ep.voiced_path || ep.local_path,
            thumbnail_url: ep.thumbnail_url || sceneImages[0] || imageUrl || '',
          }))}
          onSuccess={() => {
            showToast('🎉 Đã tải lên TikTok Studio thành công!');
          }}
        />
      )}
      {hoverRefPreview && refLightboxIndex === null && (
        <div
          style={{
            position: 'fixed',
            left: `${hoverRefPreview.x}px`,
            top: `${hoverRefPreview.y}px`,
            width: '300px',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(12px)',
            border: '2px solid rgba(236,72,153,0.65)',
            borderRadius: '14px',
            padding: '10px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.85)',
            zIndex: 100000,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ width: '100%', height: '260px', borderRadius: '10px', overflow: 'hidden', background: '#090d16', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={hoverRefPreview.src} alt="Hover Preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc' }}>{hoverRefPreview.label}</div>
          <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>🔍 Click vào ảnh để xem toàn màn hình</div>
        </div>
      )}
    </div>

  );
});
