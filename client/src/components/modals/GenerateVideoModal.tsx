import React, { useState, useEffect, useRef, memo } from 'react';
import { Product, ProductCategory } from '../../types';
import { StoryboardGrid } from '../storyboard/StoryboardGrid';
import { PartEditorModal } from '../storyboard/PartEditorModal';
import { Lightbox } from '../common/Lightbox';
import { useToast } from '../../context/ToastContext';

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
  const [sceneImages, setSceneImages] = useState<string[]>(['', '', '', '', '', '']);
  const [sceneUrls, setSceneUrls] = useState<string[]>(['', '', '', '', '', '']);
  const [drawingParts, setDrawingParts] = useState<boolean[]>([false, false, false, false, false, false]);
  const [renderingParts, setRenderingParts] = useState<boolean[]>([false, false, false, false, false, false]);
  const [pipelineStatusText, setPipelineStatusText] = useState('Sẵn sàng');
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const isAbortRequested = useRef(false);

  // Upload S3 & TikTok toggles
  const [uploadS3, setUploadS3] = useState(true);
  const [publishTiktok, setPublishTiktok] = useState(false);

  // Modals inside Generate
  const [editingPartNum, setEditingPartNum] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Refresh job parts from server (with timestamp cache buster to guarantee fresh images)
  const refreshPartsStatus = async (targetProduct = productName) => {
    const prod = targetProduct.trim();
    if (!prod) return;
    try {
      const res = await fetch(`/api/pipeline/job-parts-status?product_name=${encodeURIComponent(prod)}&_t=${Date.now()}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.parts)) {
        const now = Date.now();
        const imgs = data.parts.map((p: any) => {
          const raw = p.image?.url;
          if (!raw) return '';
          return `${raw.split('?')[0]}?t=${now}`;
        });
        const vids = data.parts.map((p: any) => {
          const raw = p.video?.url;
          if (!raw) return '';
          return `${raw.split('?')[0]}?t=${now}`;
        });
        setSceneImages(imgs);
        setSceneUrls(vids);
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
      const img = initialProduct.image_url || (initialProduct.images && initialProduct.images[0]) || '';
      setImageUrl(img);

      if (initialProduct.promptsObj) {
        setPromptsObj(initialProduct.promptsObj);
        setCustomPromptText(JSON.stringify(initialProduct.promptsObj, null, 2));
      } else {
        setPromptsObj({});
        setCustomPromptText('');
      }

      setConsensusPreFeedback(initialProduct.consensus_feedback || '');
      setPartFeedback(initialProduct.part_feedback || '');
      if (initialProduct.debate_messages && initialProduct.debate_messages.length > 0) {
        setDebateMessages(initialProduct.debate_messages);
        setShowDebateBox(true);
      } else {
        setDebateMessages([]);
        setShowDebateBox(false);
      }

      refreshPartsStatus(initialProduct.name || '');
    } else {
      setCurrentProductId(null);
      setProductName('');
      setCategory('tech');
      setImageUrl('');
      setPromptsObj({});
      setCustomPromptText('');
      setSceneImages(['', '', '', '', '', '']);
      setSceneUrls(['', '', '', '', '', '']);
      setConsensusPreFeedback('');
      setPartFeedback('');
      setDebateMessages([]);
      setShowDebateBox(false);
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
          if (found.debate_messages && found.debate_messages.length > 0) {
            setDebateMessages(found.debate_messages);
            setShowDebateBox(true);
          } else {
            setDebateMessages([]);
            setShowDebateBox(false);
          }
        } else {
          // New product! Clear feedbacks & debate history
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

    if (!continuePrev) {
      setDebateMessages([]);
      setCurrentDebateRound(1);
      setCurrentActiveAi('ai1');
      setDebateStatusText('🎭 AI 1 (AGY 3.8) & 🧐 AI 2 (GLM-5) đang khởi tạo phiên kiểm định Round 1...');
    } else {
      setCurrentActiveAi('ai1');
      setDebateStatusText('📢 Tiếp thu góp ý của Đạo diễn và tiếp tục tranh biện...');
    }

    try {
      const res = await fetch('/api/prompts/consensus-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          category,
          product_image_url: imageUrl || undefined,
          scene_count: 6,
          user_feedback: customFb || consensusPreFeedback.trim() || undefined,
          start_round: continuePrev ? 2 : 1,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      if (!res.body) throw new Error('Trình duyệt không hỗ trợ đọc luồng stream.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      const accumulatedMessages: any[] = continuePrev ? [...debateMessagesRef.current] : [];

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
                  accumulatedMessages.push(evt.message);
                  setDebateMessages((prev) => [...prev, evt.message]);
                }
                setCurrentActiveAi('ai2');
              } else if (evt.type === 'ai2_start') {
                setCurrentDebateRound(evt.round || 1);
                setCurrentActiveAi('ai2');
                setDebateStatusText(`🧐 AI 2 (GLM-5) đang kiểm định tiêu chí nhân vật & bố cục (Round ${evt.round})...`);
              } else if (evt.type === 'ai2_done') {
                if (evt.message) {
                  accumulatedMessages.push(evt.message);
                  setDebateMessages((prev) => [...prev, evt.message]);
                }
                if (evt.reached) {
                  setDebateStatusText(`🎉 ĐỒNG THUẬN 100% HOÀN HẢO ĐẠT ĐƯỢC TẠI ROUND ${evt.round}!`);
                  setCurrentActiveAi(null);
                } else {
                  setDebateStatusText(`⚠️ Round ${evt.round} đạt ${evt.percentage}%. Chuyển sang Round ${evt.round + 1}...`);
                  setCurrentDebateRound((evt.round || 1) + 1);
                  setCurrentActiveAi('ai1');
                }
              } else if (evt.type === 'complete') {
                if (evt.result?.promptsObj) {
                  setPromptsObj(evt.result.promptsObj);
                  setCustomPromptText(JSON.stringify(evt.result.promptsObj, null, 2));
                  setDebateStatusText(`🎉 ĐỒNG THUẬN 100% (${evt.result.rounds || 1} rounds): Nhân vật & bố cục chuẩn 100%`);
                  showToast(`🎉 2 AI đã đạt 100% đồng thuận sau ${evt.result.rounds || 1} round!`);
                  persistPrompts(evt.result.promptsObj).catch(console.error);
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

    setPipelineStatusText('🎨 Gemini đang bắt đầu tạo 6 ảnh phân cảnh theo từng Part...');
    showToast('🎨 Bắt đầu tạo 6 ảnh phân cảnh: Card từng Part sẽ cập nhật ảnh ngay khi vẽ xong!');

    try {
      for (let idx = 0; idx < 6; idx++) {
        if (isAbortRequested.current) {
          showToast('⛔ Đã dừng tạo ảnh theo yêu cầu.');
          break;
        }
        const partNum = idx + 1;
        setPipelineStatusText(`🎨 Gemini đang tạo ảnh Part ${partNum}/6...`);
        showToast(`🎨 Đang tạo ảnh Part ${partNum}/6...`);
        // Part 1 uses product original image (-1), Part 2-6 use Part 1 (0) as character anchor
        const customRef = idx === 0 ? -1 : 0;
        await handleRedrawSingleImage(partNum, customRef);
      }

      if (!isAbortRequested.current) {
        showToast('🎉 Đã tạo xong toàn bộ 6 ảnh phân cảnh 3D Pixar!', 4000);
        setPipelineStatusText('✅ Đã tạo xong 6 ảnh phân cảnh!');
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
  const handleRedrawSingleImage = async (partNum: number, refSource: number, notes?: string, promptOverride?: string, dialogueOverride?: string) => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm trước khi vẽ ảnh!');
      return;
    }
    const effectiveImageUrl = imageUrl || sceneImages[0] || (sceneImages.find(Boolean) ?? '');
    if (!effectiveImageUrl && refSource < 0) {
      showToast('⚠️ Cần có ảnh gốc sản phẩm hoặc ảnh Part 1 để AI đối chiếu nhân vật!');
      return;
    }
    const sIdx = partNum - 1;
    setDrawingParts((prev) => {
      const copy = [...prev];
      copy[sIdx] = true;
      return copy;
    });
    setPipelineStatusText(`🎨 Gemini đang vẽ ảnh Part ${partNum}...`);

    try {
      const prompt = promptOverride ?? (promptsObj[`prompt${partNum}`] || (partNum === 1 ? promptsObj.prompt : '') || `3D Pixar scene ${partNum}`);
      const dialogue = dialogueOverride ?? (promptsObj[`dialogue${partNum}`] || '');

      const payload: any = {
        product_name: productName.trim(),
        image_url: effectiveImageUrl || 'fallback',
        scene_index: sIdx,
        prompt,
        dialogue,
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

      const data = await res.json();
      if (data.success && data.scene_image_url) {
        showToast(`🎉 Đã vẽ xong ảnh Part ${partNum}!`);
        // Immediately apply fresh image with cache-busting timestamp to guarantee browser instant reload
        const cleanUrl = data.scene_image_url.split('?')[0];
        const freshUrl = `${cleanUrl}?t=${Date.now()}`;
        setSceneImages((prev) => {
          const copy = [...prev];
          copy[sIdx] = freshUrl;
          return copy;
        });
        await refreshPartsStatus();
      } else {
        showToast(`❌ Lỗi vẽ Part ${partNum}: ${data.error || 'Server error'}`);
      }
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
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
    if (!productName.trim()) return;
    const sIdx = partNum - 1;
    setRenderingParts((prev) => {
      const copy = [...prev];
      copy[sIdx] = true;
      return copy;
    });
    setPipelineStatusText(`🎬 Veo đang tạo video Part ${partNum}...`);

    try {
      const prompt = promptOverride ?? (promptsObj[`prompt${partNum}`] || (partNum === 1 ? promptsObj.prompt : '') || '');
      const dialogue = dialogueOverride ?? (promptsObj[`dialogue${partNum}`] || '');
      const partImg = sceneImages[sIdx] || imageUrl;

      const res = await fetch('/api/pipeline/generate-single-scene-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          scene_index: sIdx,
          prompt,
          dialogue,
          image_url: partImg,
        }),
      });

      const data = await res.json();
      if (data.success && data.video_url) {
        showToast(`🎉 Render video Part ${partNum} thành công!`);
        await refreshPartsStatus();
        return true;
      } else {
        showToast(`❌ Lỗi render Part ${partNum}: ${data.error || 'Server error'}`);
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
      if (attachedImg) {
        payload.feedback_image_url = attachedImg;
      }

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
                setRevisingStatusText('🎭 AI 1 (AGY 3.8) đã xong bản thảo. Chuyển sang 🧐 AI 2 (GLM-5) kiểm định...');
              } else if (evt.type === 'ai2_start') {
                setRevisingStage('ai2');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                if (evt.message) setRevisingStatusText(evt.message);
              } else if (evt.type === 'complete') {
                setRevisingStage('done');
                if (typeof evt.elapsedSec === 'number') setRevisingElapsedSec(evt.elapsedSec);
                if (evt.prompts_obj) {
                  setPromptsObj(evt.prompts_obj);
                  setCustomPromptText(JSON.stringify(evt.prompts_obj, null, 2));
                  showToast(`🎉 ${evt.revision_note || '2 AI đã thống nhất và sửa xong kịch bản!'}`);
                  setPipelineStatusText(`Đã sửa xong kịch bản Part ${selectedIndices.map((i) => i + 1).join(', ')}!`);
                  setRevisingStatusText(`🎉 Đã đồng thuận kịch bản (${evt.elapsedSec}s): ${evt.revision_note || 'Hoàn tất cập nhật kịch bản'}`);
                  persistPrompts(evt.prompts_obj).catch(console.error);
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
        await handleRedrawSingleImage(idx + 1, customRef, feedback);
      }
      if (!isAbortRequested.current) {
        showToast(`🎉 Đã vẽ xong toàn bộ ảnh cho các Part: ${selectedIndices.map((i) => i + 1).join(', ')}!`);
      }
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // Batch render videos
  const handleBatchRenderVideos = async (selectedIndices: number[]) => {
    isAbortRequested.current = false;
    setIsPipelineRunning(true);
    setPipelineStatusText('🎬 Đang render video hàng loạt...');

    try {
      for (const idx of selectedIndices) {
        if (isAbortRequested.current) {
          showToast('⛔ Đã dừng render video hàng loạt.');
          break;
        }
        const success = await handleRenderSingleVideo(idx + 1);
        if (!success) {
          showToast(`⛔ Đã dừng quy trình vì Part ${idx + 1} chưa tạo xong video! Vui lòng kiểm tra lại.`);
          break;
        }
      }
      if (!isAbortRequested.current) {
        showToast(`🎉 Đã render xong video cho các Part: ${selectedIndices.map((i) => i + 1).join(', ')}!`);
      }
    } finally {
      setIsPipelineRunning(false);
    }
  };

  // Merge job videos
  const handleMergeVideos = async () => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm!');
      return;
    }
    setPipelineStatusText('🎬 Đang ghép 6 phân cảnh bằng FFmpeg...');
    showToast('🎬 Đang quét các Part video và ghép thành video hoàn chỉnh...');

    try {
      const res = await fetch('/api/pipeline/merge-job-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: initialProduct?.id,
          product_name: productName.trim(),
          upload_s3: uploadS3,
          publish_tiktok: publishTiktok,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('🎉 Đã ghép video hoàn chỉnh thành công!', 6000);
        setPipelineStatusText('✅ Video hoàn chỉnh sẵn sàng!');
        onSuccess();
      } else {
        showToast('❌ Lỗi ghép video: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi ghép: ' + err.message);
    }
  };

  // Full Run All Flow
  const handleRunAllFlow = async (feedback: string, refSource: number) => {
    isAbortRequested.current = false;
    setIsPipelineRunning(true);
    setPipelineStatusText('🚀 BẮT ĐẦU RUN ALL FLOW (Kịch bản ➡️ 6 Ảnh ➡️ 6 Video ➡️ Ghép)...');
    showToast('🚀 BẮT ĐẦU RUN ALL FLOW: Sinh 6 ảnh, 6 video Veo và ghép hoàn chỉnh...');

    try {
      // Step 1: Kịch bản
      const hasValidPrompts = Boolean(promptsObj.prompt1 && (promptsObj.prompt2 || promptsObj.prompt3));
      if (feedback.trim()) {
        showToast('Step 1/4: 🤖 AI đang cập nhật kịch bản theo yêu cầu...');
        await handleBatchRevisePrompts([0, 1, 2, 3, 4, 5], feedback.trim());
      } else if (!hasValidPrompts) {
        showToast('Step 1/4: 🎭 Tự động tạo kịch bản 6 cảnh qua 2-AI...');
        await triggerAiConsensusDebate();
      } else {
        showToast('Step 1/4: 📝 Đã có sẵn kịch bản 6 cảnh, tiến hành vẽ ảnh...');
      }

      if (isAbortRequested.current) throw new Error('Đã dừng quy trình theo yêu cầu.');

      // Step 2: Vẽ 6 ảnh
      for (let idx = 0; idx < 6; idx++) {
        if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');
        const partNum = idx + 1;
        const customRef = refSource === -99 ? (idx === 0 ? -1 : 0) : refSource;
        showToast(`Step 2/4: 🎨 Đang vẽ ảnh Part ${partNum}/6...`);
        await handleRedrawSingleImage(partNum, customRef, feedback);
      }

      if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');

      // Step 3: Render 6 video tuần tự (bắt buộc Video Part trước tải về thành công mới tạo Part sau)
      for (let idx = 0; idx < 6; idx++) {
        if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');
        const partNum = idx + 1;
        showToast(`Step 3/4: 🎬 Đang render video Part ${partNum}/6...`);
        const success = await handleRenderSingleVideo(partNum);
        if (!success) {
          throw new Error(`Part ${partNum} chưa tạo xong video hoặc tải về thất bại. Đã dừng flow để đảm bảo tính liên tục!`);
        }
      }

      if (isAbortRequested.current) throw new Error('Đã dừng quy trình.');

      // Step 4: Ghép video
      showToast('Step 4/4: 🎬 Đang ghép toàn bộ video hoàn chỉnh...');
      await handleMergeVideos();

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
              <button
                type="button"
                onClick={handleToggleChrome}
                style={{
                  padding: '6px 12px',
                  borderRadius: '7px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg2)',
                  color: 'var(--text)',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {chromeVisible ? '🙈 Ẩn Chrome' : '👁️ Hiện Chrome'}
              </button>
            )}
            <button
              type="button"
              onClick={handleStartChrome}
              style={{
                padding: '6px 14px',
                borderRadius: '7px',
                border: 'none',
                background: 'var(--grad)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🚀 Start Chrome
            </button>
          </div>
        </div>

        {/* Product Name */}
        <div className="form-group">
          <label>Product Name *</label>
          <input
            id="inputProduct"
            type="text"
            placeholder="e.g. AKKO 3068B keyboard"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            onBlur={handleProductNameBlur}
          />
        </div>

        {/* Category */}
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

        {/* Custom Prompt / Kịch bản */}
        <div className="form-group">
          <label>
            Custom Prompt / Kịch bản (JSON hoặc Text) <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(Tùy chọn)</span>
          </label>
          <textarea
            id="inputCustomPrompt"
            rows={4}
            value={customPromptText}
            onChange={(e) => handleCustomPromptChange(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              color: 'var(--text)',
              fontSize: '13px',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
            placeholder="Dán kịch bản JSON (prompt1..6) hoặc prompt tại đây... Nếu để trống AI sẽ tự sinh."
          />
        </div>

        {/* 2-AI Consensus Debate Feature */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            marginBottom: '12px',
            padding: '12px 14px',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(59,130,246,0.1) 100%)',
            borderRadius: '12px',
            border: '1px solid rgba(124,58,237,0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#c4b5fd' }}>
              <input
                type="checkbox"
                checked={aiConsensusEnabled}
                onChange={(e) => setAiConsensusEnabled(e.target.checked)}
                style={{ accentColor: '#7c3aed', width: '16px', height: '16px' }}
              />
              <span>🤝 2-AI Validation (AGY 3.8 tạo prompt, GLM-5 kiểm định đến khi đạt 100%)</span>
            </label>
            <button
              type="button"
              onClick={() => triggerAiConsensusDebate()}
              disabled={isDebating}
              id="btnTriggerConsensus"
              style={{
                background: '#7c3aed',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isDebating ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s',
              }}
            >
              <span>{isDebating ? '⏳ Đang thảo luận 2 AI...' : '✨ Thảo luận 2 AI ngay'}</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span>💡 Góp ý / Chỉ đạo kịch bản cho 2 AI (Tùy chọn):</span>
            </label>
            <textarea
              id="inputAiConsensusFeedback"
              rows={2}
              value={consensusPreFeedback}
              onChange={(e) => setConsensusPreFeedback(e.target.value)}
              onBlur={(e) => persistProductFeedback({ consensus_feedback: e.target.value })}
              placeholder="VD: Sao lại ra 2 gấu đen ở step 2? Đổi thành 2 chú mèo; cảnh 3 vui vẻ hơn..."
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--bg3)',
                border: '1px solid rgba(124,58,237,0.35)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '12px',
                outline: 'none',
                resize: 'vertical',
                minHeight: '44px',
                fontFamily: 'inherit',
                lineHeight: 1.4,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
            🎯 <strong>Điều kiện dừng:</strong> Phản biện lặp vòng không giới hạn round, chỉ dừng khi 2 AI đạt <strong>100% đồng thuận</strong>.<br />
            🔒 <strong>Khóa nhân vật & Bố cục:</strong> Nhân vật bám sát 100% ảnh & mô tả (loài, ngoại hình, trang phục) • Bố cục tiền cảnh/hậu cảnh & cốt truyện 6 cảnh chặt chẽ.
          </div>

          {/* Live Debate Log Box */}
          {showDebateBox && (
            <div
              style={{
                marginTop: '6px',
                padding: '12px',
                background: 'var(--bg2)',
                borderRadius: '10px',
                border: '1px solid var(--border)',
                maxHeight: '280px',
                overflowY: 'auto',
                fontSize: '12px',
              }}
            >
              {/* Round Stepper Chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Tiến trình:
                </span>
                {Array.from({ length: Math.max(currentDebateRound, 1) }).map((_, rIdx) => {
                  const rNum = rIdx + 1;
                  const isCurrent = rNum === currentDebateRound && isDebating;
                  const isPast = rNum < currentDebateRound;
                  const isConsensus100 = !isDebating && debateStatusText.includes('100%');

                  return (
                    <div
                      key={rNum}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 11px',
                        borderRadius: '20px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: isCurrent
                          ? 'linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(236,72,153,0.25) 100%)'
                          : isPast
                          ? 'rgba(124,58,237,0.12)'
                          : isConsensus100
                          ? 'rgba(16,185,129,0.15)'
                          : 'var(--bg3)',
                        border: isCurrent
                          ? '1.5px solid #ec4899'
                          : isPast
                          ? '1px solid rgba(139,92,246,0.4)'
                          : isConsensus100
                          ? '1px solid #10b981'
                          : '1px solid var(--border)',
                        color: isCurrent ? '#f472b6' : isPast ? '#a78bfa' : isConsensus100 ? '#10b981' : 'var(--muted)',
                        animation: isCurrent ? 'activeRoundGlow 1.8s infinite' : 'none',
                        transition: 'all 0.25s ease',
                      }}
                    >
                      {isCurrent ? (
                        <span
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: '#ec4899',
                            animation: 'livePulse 1.2s infinite',
                            display: 'inline-block',
                          }}
                        />
                      ) : isPast ? (
                        <span style={{ color: '#a78bfa' }}>✓</span>
                      ) : isConsensus100 ? (
                        <span style={{ color: '#10b981' }}>★</span>
                      ) : null}
                      <span>Round {rNum}</span>
                      {isCurrent && (
                        <span style={{ fontSize: '9.5px', background: 'rgba(236,72,153,0.35)', color: '#fff', padding: '1px 6px', borderRadius: '6px', letterSpacing: '0.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <span>ĐANG CHẠY</span>
                          <span style={{ fontFamily: 'monospace', fontSize: '9.5px' }}>({formatTimer(debateElapsedSec)})</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Shimmering Live Status Banner */}
              {debateStatusText && (
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '12px',
                    color: isDebating ? '#c084fc' : debateStatusText.includes('100%') ? '#10b981' : '#8b5cf6',
                    marginBottom: '10px',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    background: isDebating
                      ? 'linear-gradient(90deg, rgba(139,92,246,0.15) 0%, rgba(236,72,153,0.18) 50%, rgba(139,92,246,0.15) 100%)'
                      : debateStatusText.includes('100%')
                      ? 'rgba(16,185,129,0.12)'
                      : 'var(--bg3)',
                    backgroundSize: isDebating ? '200% 100%' : 'auto',
                    animation: isDebating ? 'shimmerSweep 3s linear infinite' : 'none',
                    border: isDebating
                      ? '1px solid rgba(236,72,153,0.45)'
                      : debateStatusText.includes('100%')
                      ? '1px solid rgba(16,185,129,0.4)'
                      : '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isDebating ? (
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: currentActiveAi === 'ai2' ? '#f59e0b' : '#ec4899',
                          animation: 'livePulse 1s infinite',
                          flexShrink: 0,
                        }}
                      />
                    ) : debateStatusText.includes('100%') ? (
                      <span style={{ fontSize: '14px' }}>🎉</span>
                    ) : (
                      <span style={{ fontSize: '14px' }}>💬</span>
                    )}
                    <span>{debateStatusText}</span>
                  </div>
                  {isDebating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: '11px',
                          color: '#38bdf8',
                          fontWeight: 700,
                          background: 'var(--bg3)',
                          border: '1px solid rgba(56,189,248,0.4)',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontFamily: 'monospace',
                        }}
                      >
                        ⏱️ {formatTimer(debateElapsedSec)}
                      </span>
                      <span style={{ fontSize: '10.5px', color: '#f472b6', fontWeight: 700, background: 'rgba(236,72,153,0.2)', padding: '2px 8px', borderRadius: '6px' }}>
                        Round {currentDebateRound}
                      </span>
                      <div style={{ display: 'flex', gap: '3px' }}>
                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ec4899', animation: 'bounceDot 1s infinite 0ms' }} />
                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ec4899', animation: 'bounceDot 1s infinite 200ms' }} />
                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ec4899', animation: 'bounceDot 1s infinite 400ms' }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {debateMessages.map((msg, i) => {
                const isUser = msg.agent.includes('Đạo Diễn') || msg.role.includes('Chỉ Đạo');
                const isAi1 = msg.agent.includes('AI 1');
                const isConsensus100 = msg.title.includes('100%');
                const borderCol = isConsensus100 ? '#10b981' : isAi1 ? '#8b5cf6' : '#f59e0b';
                const bgCol = isConsensus100 ? 'rgba(16,185,129,0.14)' : isAi1 ? 'rgba(139,92,246,0.12)' : 'rgba(245,158,11,0.12)';

                return (
                  <div
                    key={i}
                    style={{
                      marginBottom: '8px',
                      padding: '8px 10px',
                      borderLeft: `3px solid ${isUser ? '#06b6d4' : borderCol}`,
                      background: isUser ? 'rgba(6,182,212,0.14)' : bgCol,
                      borderRadius: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: isUser ? '#06b6d4' : borderCol, marginBottom: '4px' }}>
                      <span>{isUser ? '👤 ' : ''}{msg.agent} ({msg.role})</span>
                      <span style={{ color: 'var(--muted)' }}>{msg.timestamp}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', color: isConsensus100 ? '#10b981' : isUser ? '#38bdf8' : 'var(--text)' }}>
                      {msg.title}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '11px', lineHeight: 1.4, color: 'var(--text)' }}>
                      {msg.content}
                    </div>
                  </div>
                );
              })}

              {/* Active AI Thinking Card for Current Round */}
              {isDebating && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: currentActiveAi === 'ai2' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(139, 92, 246, 0.1)',
                    border: `1.5px dashed ${currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7'}`,
                    animation: 'activeRoundGlow 2s infinite alternate',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginTop: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: currentActiveAi === 'ai2' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(139, 92, 246, 0.2)',
                        border: `1px solid ${currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px',
                        flexShrink: 0,
                      }}
                    >
                      {currentActiveAi === 'ai2' ? '🧐' : '🎭'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: currentActiveAi === 'ai2' ? '#fbbf24' : '#c084fc' }}>
                        {currentActiveAi === 'ai2'
                          ? `AI 2 (GLM-5) đang kiểm định tiêu chí Round ${currentDebateRound}...`
                          : `AI 1 (AGY 3.8) đang sáng tác kịch bản Round ${currentDebateRound}...`}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                        {currentActiveAi === 'ai2'
                          ? 'Đang đối chiếu ảnh mẫu, tỷ lệ Chibi và kiểm định bối cảnh 6 Part'
                          : 'Đang khởi tạo lời thoại, hành động và bố cục Pixar 3D sinh động'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', paddingRight: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7', animation: 'bounceDot 1s infinite 0ms' }} />
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7', animation: 'bounceDot 1s infinite 200ms' }} />
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: currentActiveAi === 'ai2' ? '#f59e0b' : '#a855f7', animation: 'bounceDot 1s infinite 400ms' }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live feedback toolbar */}
          {showDebateBox && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'flex-start' }}>
              <textarea
                rows={2}
                value={liveDebateFeedback}
                onChange={(e) => setLiveDebateFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendLiveDebateFeedback();
                  }
                }}
                placeholder="💬 Góp ý trực tiếp cho 2 AI (VD: Step 2 đổi thành 2 chú mèo... Enter để gửi)"
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  background: 'var(--bg2)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                  fontSize: '12px',
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: '40px',
                  fontFamily: 'inherit',
                  lineHeight: 1.4,
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={handleSendLiveDebateFeedback}
                disabled={isDebating || !liveDebateFeedback.trim()}
                style={{
                  background: '#7c3aed',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  height: 'fit-content',
                }}
              >
                💬 Gửi góp ý
              </button>
            </div>
          )}
        </div>

        {/* 6-Scene Storyboard & Granular Part Customizer */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            marginBottom: '12px',
            padding: '12px 14px',
            background: 'linear-gradient(135deg, rgba(236,72,153,0.08) 0%, rgba(245,158,11,0.08) 100%)',
            borderRadius: '12px',
            border: '1px solid rgba(236,72,153,0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: '#f472b6' }}>
              <input
                type="checkbox"
                checked={autoSceneImages}
                onChange={(e) => setAutoSceneImages(e.target.checked)}
                style={{ accentColor: '#ec4899', width: '16px', height: '16px' }}
              />
              <span>🎨 Tự động tạo 6 ảnh phân cảnh bằng Gemini trước khi tạo Video</span>
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleGenerateSceneImages}
                disabled={isPipelineRunning}
                id="btnGenerateSceneImages"
                style={{
                  background: isGeneratingAllImages
                    ? 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)'
                    : 'linear-gradient(135deg, #ec4899 0%, #f59e0b 100%)',
                  color: '#fff',
                  border: isGeneratingAllImages ? '1px solid #f472b6' : 'none',
                  padding: '6px 13px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isPipelineRunning ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: isGeneratingAllImages ? '0 0 12px rgba(236,72,153,0.45)' : 'none',
                  transition: 'all 0.25s ease',
                }}
              >
                {isGeneratingAllImages ? (
                  <>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '11px',
                        height: '11px',
                        border: '2px solid rgba(255,255,255,0.35)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    <span>⏳ Đang tạo 6 ảnh... ({formatTimer(generateImagesElapsedSec)})</span>
                    <div style={{ display: 'flex', gap: '2px', marginLeft: '2px' }}>
                      <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#fff', animation: 'bounceDot 1s infinite 0ms' }} />
                      <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#fff', animation: 'bounceDot 1s infinite 200ms' }} />
                      <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#fff', animation: 'bounceDot 1s infinite 400ms' }} />
                    </div>
                  </>
                ) : (
                  <>🖼️ Tạo trước 6 ảnh</>
                )}
              </button>
              <button
                type="button"
                onClick={handleMergeVideos}
                id="btnMergeVideosQuick"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                🎬 Ghép Video Hoàn Chỉnh
              </button>
            </div>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>
            📸 Gemini phân tích ảnh gốc + prompt để sinh 6 ảnh hoạt hình 3D Pixar chi tiết trước. Bạn có thể chọn và chỉnh sửa/tạo lại từng Part riêng lẻ (Part 1 ➔ 6).
          </div>

          {/* Storyboard Grid with Assistant Box */}
          <StoryboardGrid
            productName={productName}
            promptsObj={promptsObj}
            sceneImages={sceneImages}
            sceneUrls={sceneUrls}
            drawingParts={drawingParts}
            renderingParts={renderingParts}
            pipelineStatusText={pipelineStatusText}
            isPipelineRunning={isPipelineRunning}
            batchFeedback={partFeedback}
            onChangeBatchFeedback={setPartFeedback}
            onBlurBatchFeedback={(val) => persistProductFeedback({ part_feedback: val })}
            isRevisingPrompts={isRevisingPrompts}
            revisingStage={revisingStage}
            revisingElapsedSec={revisingElapsedSec}
            revisingStatusText={revisingStatusText}
            revisingTargetParts={revisingTargetParts}
            onOpenPartEditor={(partNum) => setEditingPartNum(partNum)}
            onRedrawSingleImage={handleRedrawSingleImage}
            onRenderSingleVideo={handleRenderSingleVideo}
            onBatchRevisePrompts={handleBatchRevisePrompts}
            onBatchRenderImages={handleBatchRenderImages}
            onBatchRenderVideos={handleBatchRenderVideos}
            onRunAllFlow={handleRunAllFlow}
            onStopPipeline={handleStopPipeline}
            onZoomImage={(idx) => setLightboxIndex(idx)}
          />
        </div>

        {/* S3 & TikTok toggles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', padding: '12px', background: 'var(--bg3)', borderRadius: '10px', border: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', cursor: 'pointer' }}>
            <span>☁️ Upload to S3</span>
            <input
              type="checkbox"
              checked={uploadS3}
              onChange={(e) => setUploadS3(e.target.checked)}
              style={{ accentColor: '#7c3aed', width: '16px', height: '16px' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', cursor: 'pointer', color: 'var(--muted)' }}>
            <span>🎵 Publish TikTok</span>
            <input
              type="checkbox"
              checked={publishTiktok}
              onChange={(e) => setPublishTiktok(e.target.checked)}
              style={{ accentColor: '#7c3aed', width: '16px', height: '16px' }}
            />
          </label>
        </div>

        {/* Footer Actions */}
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleStopPipeline}
              style={{
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.45)',
                color: '#f87171',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              ⛔ Dừng Lại (Stop)
            </button>
            <button className="btn-cancel" onClick={handleClose}>
              Đóng
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn-submit"
              onClick={handleSavePrompt}
              disabled={isSavingPromptMain}
              style={{
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                boxShadow: 'none',
                fontWeight: 600,
                opacity: isSavingPromptMain ? 0.7 : 1,
                cursor: isSavingPromptMain ? 'not-allowed' : 'pointer',
              }}
            >
              {isSavingPromptMain ? '⏳ Đang lưu...' : '💾 Lưu Kịch Bản'}
            </button>
            <button
              type="button"
              onClick={() => handleRunAllFlow('', -99)}
              disabled={isPipelineRunning}
              style={{
                background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%)',
                color: '#fff',
                border: 'none',
                padding: '9px 18px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: isPipelineRunning ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 3px 12px rgba(139,92,246,0.4)',
              }}
            >
              🚀 Run All Flow Tạo Video
            </button>
          </div>
        </div>
      </div>

      {/* Part Editor Modal */}
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
          onStopPipeline={handleStopPipeline}
          onOpenLightbox={(img, title, idx) => setLightboxIndex(idx)}
          onRefreshPartsStatus={() => refreshPartsStatus(productName)}
        />
      )}

      {/* Rich Storyboard Lightbox (Internal state isolated) */}
      {lightboxIndex !== null && (
        <Lightbox
          imageUrl={sceneImages[lightboxIndex] || null}
          images={sceneImages.filter(Boolean).length > 0 ? sceneImages : [imageUrl].filter(Boolean)}
          currentIndex={lightboxIndex}
          dialogues={[1, 2, 3, 4, 5, 6].map((i) => promptsObj[`dialogue${i}`] || '')}
          title={`Phân Cảnh ${lightboxIndex + 1}: Bảng 6 Bước Diễn Hoạt`}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
});
