import React, { useState, useEffect, useRef, memo } from 'react';
import { Product, ProductCategory, EpisodeDefinition, GeneratedEpisode } from '../../types';
import { StoryboardGrid } from '../storyboard/StoryboardGrid';
import { PartEditorModal } from '../storyboard/PartEditorModal';
import { YouTubePublishModal } from './YouTubePublishModal';
import { FacebookPublishModal } from './FacebookPublishModal';
import { DebateFeedView } from '../storyboard/DebateFeedView';
import { Lightbox } from '../common/Lightbox';
import { useToast } from '../../context/ToastContext';
import { SCENE_OPTIONS, SceneSuggestion, analyzeStorySceneCount } from '../../utils/sceneAnalyzer';

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
}) => {
  const { showToast } = useToast();

  // Form Fields
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState<ProductCategory>('tech');
  const [imageUrl, setImageUrl] = useState('');
  const [customPromptText, setCustomPromptText] = useState('');
  const [promptsObj, setPromptsObj] = useState<Record<string, string>>({});
  const promptsObjRef = useRef(promptsObj);
  useEffect(() => {
    promptsObjRef.current = promptsObj;
  }, [promptsObj]);
  const [currentProductId, setCurrentProductId] = useState<string | null>(null);
  const [isSavingPromptMain, setIsSavingPromptMain] = useState(false);

  // Chrome Status
  const [chromeReady, setChromeReady] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [chromeStatusText, setChromeStatusText] = useState('Checking Chrome...');

  // 2-AI Consensus Debate
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

  // Apply scene count with synchronous array resizing and toast notification
  const applySceneCount = (val: number, showToastMsg: boolean = true) => {
    setSelectedSceneCount(val);
    setSceneImages((prev) => {
      if (prev.length < val) {
        return [...prev, ...new Array(val - prev.length).fill('')];
      }
      return prev;
    });
    setSceneUrls((prev) => {
      if (prev.length < val) {
        return [...prev, ...new Array(val - prev.length).fill('')];
      }
      return prev;
    });
    setEpisodes((prev) => {
      if (prev.length <= 1) {
        return [{ id: 'ep_1', title: 'Tập 1 (Full Story)', startScene: 1, endScene: val }];
      }
      return prev;
    });
    if (showToastMsg) {
      showToast(`🎯 Đã áp dụng phân cảnh: ${val} Cảnh (~${val * 10}s)`);
    }
  };

  // Deep AI analysis of story scenes using Gemini / Codex backend
  const handleDeepAiAnalyzeScenes = async () => {
    const text = productDescription.trim();
    if (!text) {
      showToast('⚠️ Vui lòng nhập nội dung Cốt truyện gốc trước!');
      return;
    }
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

  const getDynamicSceneCount = () => {
    const pKeys = Object.keys(promptsObj || {}).map(k => {
      const m = k.match(/^prompt(\d+)$/i);
      return m ? parseInt(m[1], 10) : 0;
    }).filter(n => n > 0);
    if (pKeys.length > 0) {
      return Math.max(...pKeys);
    }
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

  // Video Render Mode: 'browser' (Chrome Automation)
  const [videoRenderMode, setVideoRenderMode] = useState<'browser'>('browser');

  const handleSetVideoRenderMode = (_mode: 'browser') => {
    setVideoRenderMode('browser');
  };

  // Modals inside Generate
  const [editingPartNum, setEditingPartNum] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Refresh job parts from server (with timestamp cache buster to guarantee fresh images)
  const refreshPartsStatus = async (targetProduct = productName) => {
    const prod = targetProduct.trim();
    try {
      const countParam = getDynamicSceneCount();
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
            const clean = raw.split('?')[0];
            const prevClean = (prevVids[idx] || '').split('?')[0];
            if (clean === prevClean && prevVids[idx]) {
              return prevVids[idx]; // Keep unchanged
            }
            return `${clean}?t=${now}`;
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
      const sugg = analyzeStorySceneCount(initialDesc);
      setSuggestedScenes(sugg);
      setShowSceneBreakdown(false);

      const img = initialProduct.image_url || (initialProduct.images && initialProduct.images[0]) || '';
      setImageUrl(img);

      if (initialProduct.promptsObj) {
        setPromptsObj(initialProduct.promptsObj);
        setCustomPromptText(JSON.stringify(initialProduct.promptsObj, null, 2));
        const pKeys = Object.keys(initialProduct.promptsObj).map(k => {
          const m = k.match(/^prompt(\d+)$/i);
          return m ? parseInt(m[1], 10) : 0;
        }).filter(n => n > 0);
        if (pKeys.length > 0) {
          setSelectedSceneCount(Math.max(...pKeys));
        } else if (sugg) {
          setSelectedSceneCount(sugg.count);
        }
      } else {
        setPromptsObj({});
        setCustomPromptText('');
        if (sugg) {
          setSelectedSceneCount(sugg.count);
        }
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
      const sceneCount = getDynamicSceneCount();
      const emptyImages = new Array(sceneCount).fill('');
      const emptyUrls = new Array(sceneCount).fill('');
      // CRITICAL: Clear the ref SYNCHRONOUSLY before refreshPartsStatus
      // so the ref-based dedup logic doesn't retain old product's images
      sceneImagesRef.current = emptyImages;
      setSceneImages(emptyImages);
      setSceneUrls(emptyUrls);
      setDrawingParts(new Array(sceneCount).fill(false));
      setRenderingParts(new Array(sceneCount).fill(false));
      // Reset additional pipeline states
      setIsGeneratingAllImages(false);
      setGenerateImagesElapsedSec(0);
      setIsDubbing(false);

      if (initialProduct.episodes && initialProduct.episodes.length > 0) {
        setEpisodes(initialProduct.episodes);
      } else if (initialProduct.promptsObj && (initialProduct.promptsObj as any).episodes && Array.isArray((initialProduct.promptsObj as any).episodes)) {
        setEpisodes((initialProduct.promptsObj as any).episodes);
      } else {
        const total = getDynamicSceneCount();
        setEpisodes([
          { id: 'ep_1', title: 'Tập 1 (Full Story)', startScene: 1, endScene: total },
        ]);
      }
      setMergedEpisodesResult([]);
      setMergedFullUrl(null);

      // Delay refreshPartsStatus slightly to let React flush the empty state first
      // so users see a clean slate before new data arrives
      setTimeout(() => refreshPartsStatus(initialProduct.name || ''), 50);
    } else {
      setCurrentProductId(null);
      setProductName('');
      setCategory('tech');
      setProductDescription('');
      setSuggestedScenes(null);
      setShowSceneBreakdown(false);
      setImageUrl('');
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

  // Handle custom prompt edit
  const handleCustomPromptChange = (val: string) => {
    setCustomPromptText(val);
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null) {
        setPromptsObj(parsed);
      }
    } catch {
      // not JSON yet
    }
  };

  // Helper to persist feedbacks and debate messages to DB
  const persistProductFeedback = async (overrides?: {
    consensus_feedback?: string;
    part_feedback?: string;
    debate_messages?: any[];
    description?: string;
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
          if (found.image_url) setImageUrl(found.image_url);
          if (found.promptsObj) {
            setPromptsObj(found.promptsObj);
            setCustomPromptText(JSON.stringify(found.promptsObj, null, 2));
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
            promptsObj: promptsToSave,
            category,
            image_url: imageUrl || undefined,
            consensus_feedback: consensusPreFeedback,
            part_feedback: partFeedback,
            episodes,
            debate_messages: debateMessagesRef.current,
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
            image_url: imageUrl || '',
            promptsObj: promptsToSave,
            consensus_feedback: consensusPreFeedback,
            part_feedback: partFeedback,
            episodes,
            debate_messages: debateMessagesRef.current,
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
    let pObj = promptsObj;
    if (customPromptText.trim()) {
      try {
        pObj = JSON.parse(customPromptText.trim());
      } catch {
        pObj = { prompt: customPromptText.trim() };
      }
    }

    setIsSavingPromptMain(true);
    try {
      setPromptsObj(pObj);
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
      setDebateMessages([]);
      setCurrentDebateRound(1);
      setCurrentActiveAi('ai1');
      setDebateStatusText('🎭 AI 1 (Codex Sol Light) & 🧐 AI 2 (Gemini 3.8 Low) đang khởi tạo phiên kiểm định Round 1...');
    } else {
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
      const res = await fetch('/api/prompts/consensus-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          category,
          product_image_url: imageUrl || undefined,
          product_description: productDescription.trim() || undefined,
          scene_count: selectedSceneCount,
          user_feedback: customFb || consensusPreFeedback.trim() || undefined,
          previous_proposal: continuePrev ? existingProposalDraft : undefined,
          start_round: targetStartRound,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      if (!res.body) throw new Error('Trình duyệt không hỗ trợ đọc luồng stream.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
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
                setDebateStatusText(`🎭 AI 1 (AGY 3.8) đang sáng tác và tối ưu kịch bản 3D (Round ${evt.round})...`);
              } else if (evt.type === 'ai1_done') {
                if (evt.message) {
                  const effectiveRound = evt.round || evt.message.round || targetStartRound;
                  const msgWithRound = { ...evt.message, round: effectiveRound };
                  accumulatedMessages.push(msgWithRound);
                  setDebateMessages((prev) => [...prev, msgWithRound]);
                }
                setCurrentActiveAi('ai2');
              } else if (evt.type === 'ai2_start') {
                setCurrentDebateRound(evt.round || targetStartRound);
                setCurrentActiveAi('ai2');
                setDebateStatusText(`🧐 AI 2 (Gemini 3.8 Low) đang kiểm định tiêu chí nhân vật & bố cục (Round ${evt.round || targetStartRound})...`);
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
                throw new Error(evt.error || 'Lỗi phiên phản biện');
              }
            } catch (pErr: any) {
              if (pErr.message && !pErr.message.includes('JSON')) throw pErr;
            }
          }
        }
      }
    } catch (err: any) {
      setDebateStatusText(`❌ Lỗi thảo luận: ${err.message}`);
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      clearInterval(debateTimer);
      setIsDebating(false);
      setCurrentActiveAi(null);
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
    if (!imageUrl) {
      showToast('⚠️ Sản phẩm cần có ảnh nhân vật/sản phẩm gốc!');
      return;
    }

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
        const customRef = idx === 0 ? -1 : 0;
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
    const effectiveImageUrl = imageUrl || sceneImages[0] || (sceneImages.find(Boolean) ?? '');
    if (!effectiveImageUrl && refSource < 0) {
      showToast('⚠️ Cần có ảnh gốc sản phẩm hoặc ảnh Part 1 để AI đối chiếu nhân vật!');
      return false;
    }
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

        const payload: any = {
          product_name: productName.trim(),
          image_url: effectiveImageUrl || 'fallback',
          scene_index: sIdx,
          prompt,
          dialogue,
          render_mode: 'browser',
        };

      if (refSource !== undefined && refSource !== null) {
        payload.reference_part_index = refSource;
      }
      if (notes && notes.trim()) {
        payload.redraw_instructions = notes.trim();
      }

      const res = await fetch('/api/pipeline/generate-single-scene-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
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
      showToast(`❌ Lỗi: ${err.message}`);
      return false;
    } finally {
      setDrawingParts((prev) => {
        const copy = [...prev];
        copy[sIdx] = false;
        return copy;
      });
      setPipelineStatusText(`Hoàn tất vẽ ảnh Part ${partNum}`);
    }
  };

  // Render single video
  const handleRenderSingleVideo = async (partNum: number, promptOverride?: string, dialogueOverride?: string) => {
    if (!productName.trim()) return false;
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

      const res = await fetch('/api/pipeline/generate-single-scene-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          scene_index: sIdx,
          prompt,
          dialogue,
          image_url: partImg,
          render_mode: videoRenderMode,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
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
      showToast(`❌ Lỗi: ${err.message}`);
      return false;
    } finally {
      setRenderingParts((prev) => {
        const copy = [...prev];
        copy[sIdx] = false;
        return copy;
      });
      setPipelineStatusText(`Hoàn tất render video Part ${partNum}`);
    }
  };

  // Batch revise prompts with 2-AI Stream
  const handleBatchRevisePrompts = async (selectedIndices: number[], feedback: string, attachedImg?: string) => {
    setIsRevisingPrompts(true);
    setRevisingTargetParts(selectedIndices);
    setRevisingStage('ai1');
    setRevisingElapsedSec(0);
    const revisionTimer = setInterval(() => {
      setRevisingElapsedSec((prev) => prev + 1);
    }, 1000);

    setRevisingStatusText(`🤖 Khởi tạo phiên phản biện 2 AI cho Part ${selectedIndices.map((i) => i + 1).join(', ')}...`);
    setPipelineStatusText(`🤖 2 AI đang thảo luận Part ${selectedIndices.map((i) => i + 1).join(', ')}...`);
    showToast(`🤖 2 AI đang bắt đầu thảo luận & sửa kịch bản Part ${selectedIndices.map((i) => i + 1).join(', ')}...`);

    try {
      const payload: any = {
        product_name: productName.trim(),
        category,
        prompts_obj: promptsObj,
        scene_indices: selectedIndices,
        feedback,
        image_url: imageUrl || undefined,
      };
      if (attachedImg) payload.feedback_image_url = attachedImg;

      const res = await fetch('/api/prompts/revise-scene-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      if (!res.body) throw new Error('Trình duyệt không hỗ trợ đọc luồng stream.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
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
              } else if (evt.type === 'ai1_done') {
                setRevisingStage('ai2');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                setRevisingStatusText('🎭 AI 1 (Codex Sol Light) đã xong bản thảo. Chuyển sang 🧐 AI 2 (Gemini 3.8 Low) kiểm định...');
              } else if (evt.type === 'ai2_start') {
                setRevisingStage('ai2');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                if (evt.message) setRevisingStatusText(evt.message);
              } else if (evt.type === 'complete') {
                setRevisingStage('done');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                const pObj = evt.prompts_obj || evt.result?.promptsObj;
                const revNote = evt.revision_note || evt.result?.revisionNote;
                if (pObj) {
                  promptsObjRef.current = pObj;
                  setPromptsObj(pObj);
                  setCustomPromptText(JSON.stringify(pObj, null, 2));
                  showToast(`🎉 ${revNote || '2 AI đã thống nhất và sửa xong kịch bản!'}`);
                  setPipelineStatusText(`Đã sửa xong kịch bản Part ${selectedIndices.map((i) => i + 1).join(', ')}!`);
                  setRevisingStatusText(`🎉 Đã đồng thuận kịch bản (${evt.elapsedSec || 0}s): ${revNote || 'Hoàn tất cập nhật kịch bản'}`);
                  persistPrompts(pObj).catch(console.error);
                }
              } else if (evt.type === 'error') {
                throw new Error(evt.error || 'Lỗi thảo luận 2 AI');
              }
            } catch (pErr: any) {
              if (pErr.message && !pErr.message.includes('JSON')) throw pErr;
            }
          }
        }
      }
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
      setRevisingStatusText(`❌ Lỗi: ${err.message}`);
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
        const customRef = refSource === -99 ? (idx === 0 ? -1 : 0) : refSource;
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
  const handleMergeVideos = async (targetMode: 'all' | 'full' | 'episodes' = 'all'): Promise<boolean> => {
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
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
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
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
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
        const customRef = refSource === -99 ? (idx === 0 ? -1 : 0) : refSource;
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

      showToast('Step 4/4: 🎬 Đang ghép toàn bộ video hoàn chỉnh...');
      const mergeSuccess = await handleMergeVideos();
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
    setIsPipelineRunning(false);
    showToast('⛔ Đang gửi lệnh dừng quy trình...');
    setPipelineStatusText('⛔ Đã gửi lệnh dừng quy trình');
  };

  const handleSavePartPromptInModal = async (num: number, prompt: string, dialogue: string): Promise<boolean> => {
    const updated = {
      ...promptsObj,
      [`prompt${num}`]: prompt,
      [`dialogue${num}`]: dialogue,
    };
    setPromptsObj(updated);
    setCustomPromptText(JSON.stringify(updated, null, 2));
    const ok = await persistPrompts(updated);
    return ok;
  };

  const handleClose = () => {
    persistProductFeedback().catch(console.error);
    onClose();
  };

  return (
    <div className="modal-overlay open" id="modalOverlay" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>🎬 Generate Video</h2>
        <p>AI will create a cinematic Veo video for your product</p>

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
            onBlur={(e) => persistProductFeedback({ description: e.target.value })}
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

        <div className="form-group">
          <label>Custom Prompt / Kịch bản (JSON hoặc Text) <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(Tùy chọn)</span></label>
          <textarea id="inputCustomPrompt" rows={4} value={customPromptText} onChange={(e) => handleCustomPromptChange(e.target.value)} style={{ width: '100%', padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} placeholder="Dán kịch bản JSON (prompt1..6) hoặc prompt tại đây... Nếu để trống AI sẽ tự sinh." />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px', padding: '12px 14px', background: 'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(59,130,246,0.1) 100%)', borderRadius: '12px', border: '1px solid rgba(124,58,237,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#c4b5fd' }}>
              <input type="checkbox" checked={aiConsensusEnabled} onChange={(e) => setAiConsensusEnabled(e.target.checked)} style={{ accentColor: '#7c3aed', width: '16px', height: '16px' }} />
              <span>🤝 2-AI Validation (Codex Sol sáng tác, Gemini 3.8 Low kiểm định)</span>
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
                {isDebating && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}><span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, background: 'var(--bg3)', border: '1px solid rgba(56,189,248,0.4)', padding: '2px 8px', borderRadius: '12px', fontFamily: 'monospace' }}>⏱️ {formatTimer(debateElapsedSec)}</span><span style={{ fontSize: '10.5px', color: '#f472b6', fontWeight: 700, background: 'rgba(236,72,153,0.2)', padding: '2px 8px', borderRadius: '6px' }}>Round {currentDebateRound}</span></div>}
              </div>}

              <DebateFeedView
                messages={debateMessages}
                currentRound={currentDebateRound}
                isDebating={isDebating}
                onOpenPartEditor={(partNum) => setEditingPartNum(partNum)}
                onSavePartPrompt={handleSavePartPromptInModal}
              />

              {isDebating && <div style={{ padding: '10px 14px', borderRadius: '8px', background: currentActiveAi === 'ai2' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(139, 92, 246, 0.1)', border: `1.5px dashed ${currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7'}`, animation: 'activeRoundGlow 2s infinite alternate', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '6px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><div style={{ width: '28px', height: '28px', borderRadius: '50%', background: currentActiveAi === 'ai2' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(139, 92, 246, 0.2)', border: `1px solid ${currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>{currentActiveAi === 'ai2' ? '🧐' : '🎭'}</div><div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span style={{ fontSize: '11.5px', fontWeight: 700, color: currentActiveAi === 'ai2' ? '#fbbf24' : '#c084fc' }}>{currentActiveAi === 'ai2' ? `AI 2 (Gemini 3.8 Low) đang kiểm định tiêu chí Round ${currentDebateRound}...` : `AI 1 (Codex Sol Light) đang sáng tác kịch bản Round ${currentDebateRound}...`}</span><span style={{ fontSize: '10px', color: 'var(--muted)' }}>{currentActiveAi === 'ai2' ? `Đang đối chiếu ảnh mẫu, tỷ lệ Chibi và kiểm định bối cảnh ${getDynamicSceneCount()} Part` : 'Đang khởi tạo lời thoại, hành động và bố cục Pixar 3D sinh động'}</span></div></div></div>}
            </div>
          )}

          {showDebateBox && <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'flex-start' }}><textarea rows={2} value={liveDebateFeedback} onChange={(e) => setLiveDebateFeedback(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendLiveDebateFeedback(); } }} placeholder="💬 Góp ý trực tiếp cho 2 AI (VD: Step 2 đổi thành 2 chú mèo... Enter để gửi)" style={{ flex: 1, padding: '7px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', outline: 'none', resize: 'vertical', minHeight: '40px', fontFamily: 'inherit', lineHeight: 1.4, boxSizing: 'border-box' }} /><button type="button" onClick={handleSendLiveDebateFeedback} disabled={isDebating || !liveDebateFeedback.trim()} style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', height: 'fit-content' }}>💬 Gửi góp ý</button></div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px', padding: '12px 14px', background: 'linear-gradient(135deg, rgba(236,72,153,0.08) 0%, rgba(245,158,11,0.08) 100%)', borderRadius: '12px', border: '1px solid rgba(236,72,153,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#f472b6' }}><input type="checkbox" checked={autoSceneImages} onChange={(e) => setAutoSceneImages(e.target.checked)} style={{ accentColor: '#ec4899', width: '16px', height: '16px' }} /><span>🎨 Tự động tạo {getDynamicSceneCount()} ảnh phân cảnh bằng Gemini trước khi tạo Video</span></label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => handleMergeVideos('all')} id="btnMergeVideosQuick" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>🎬 Ghép Video Hoàn Chỉnh</button>
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
            onOpenPartEditor={(partNum) => setEditingPartNum(partNum)}
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
          productName={productName}
          category={category}
          originalImageUrl={imageUrl}
          promptsObj={promptsObj}
          sceneImages={sceneImages}
          sceneUrls={sceneUrls}
          onSwitchPart={(num) => setEditingPartNum(num)}
          onSavePartPrompt={handleSavePartPromptInModal}
          onRedrawSingleImage={handleRedrawSingleImage}
          onRenderSingleVideo={handleRenderSingleVideo}
          onRevisePrompt={(feedback) => handleBatchRevisePrompts([editingPartNum - 1], feedback)}
          isRevisingPrompts={isRevisingPrompts}
          revisingStatusText={revisingStatusText}
          onStopPipeline={handleStopPipeline}
          onOpenLightbox={(img, title, idx) => setLightboxIndex(idx)}
          onRefreshPartsStatus={() => refreshPartsStatus(productName)}
        />
      )}

      {lightboxIndex !== null && <Lightbox imageUrl={sceneImages[lightboxIndex] || null} images={sceneImages.filter(Boolean).length > 0 ? sceneImages : [imageUrl].filter(Boolean)} currentIndex={lightboxIndex} dialogues={Array.from({ length: getDynamicSceneCount() }, (_, i) => promptsObj[`dialogue${i + 1}`] || '')} title={`Phân Cảnh ${lightboxIndex + 1}: Bảng Diễn Hoạt`} onClose={() => setLightboxIndex(null)} />}

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
    </div>

  );
});
