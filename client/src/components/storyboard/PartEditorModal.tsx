import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import { getDisplayImageUrl } from '../../utils/image';

interface PartEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  partNum: number;
  productName: string;
  category: string;
  originalImageUrl?: string;
  promptsObj: Record<string, string>;
  sceneImages: string[];
  sceneUrls: string[];
  onSwitchPart: (partNum: number) => void;
  onSavePartPrompt: (partNum: number, prompt: string, dialogue: string) => Promise<boolean | void> | void;
  onRedrawSingleImage: (partNum: number, refSource: number, notes?: string, promptOverride?: string, dialogueOverride?: string) => Promise<void>;
  onRenderSingleVideo: (partNum: number, promptOverride?: string, dialogueOverride?: string) => Promise<boolean | void>;
  onStopPipeline: () => void;
  onOpenLightbox: (imageUrl: string, title: string, index: number) => void;
  onRefreshPartsStatus: () => Promise<void>;
}

export const PartEditorModal: React.FC<PartEditorModalProps> = memo(({
  isOpen,
  onClose,
  partNum,
  productName,
  category,
  originalImageUrl,
  promptsObj,
  sceneImages,
  sceneUrls,
  onSwitchPart,
  onSavePartPrompt,
  onRedrawSingleImage,
  onRenderSingleVideo,
  onStopPipeline,
  onOpenLightbox,
  onRefreshPartsStatus,
}) => {
  const { showToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Local state for prompt & dialogue
  const currentPrompt = promptsObj[`prompt${partNum}`] || (partNum === 1 ? (promptsObj.prompt || '') : '') || '';
  const currentDialogue = promptsObj[`dialogue${partNum}`] || '';

  const [promptText, setPromptText] = useState(currentPrompt);
  const [dialogueText, setDialogueText] = useState(currentDialogue);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Video version to prevent re-render flashing on typing
  const [videoVersion, setVideoVersion] = useState<number>(() => Date.now());

  // Redraw Note & Reference
  const [refSource, setRefSource] = useState<number>(partNum === 1 ? -1 : 0);
  const [redrawNote, setRedrawNote] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  // Trimmer state
  const [trimStart, setTrimStart] = useState('0.0');
  const [trimEnd, setTrimEnd] = useState('0.0');
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [isTrimming, setIsTrimming] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // 2-AI Debate state
  const [debateFeedback, setDebateFeedback] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isDebating, setIsDebating] = useState(false);
  const [debateResult, setDebateResult] = useState<{
    prompt: string;
    dialogue: string;
    note: string;
    ai1Text?: string;
    ai2Text?: string;
  } | null>(null);

  useEffect(() => {
    setPromptText(currentPrompt);
    setDialogueText(currentDialogue);
    setRefSource(partNum === 1 ? -1 : 0);
    setRedrawNote('');
    setDebateFeedback('');
    setAttachedImage(null);
    setDebateResult(null);
    setTrimStart('0.0');
    setTrimEnd('0.0');
    setVideoVersion(Date.now());
  }, [partNum, isOpen]);

  useEffect(() => {
    setVideoVersion(Date.now());
  }, [sceneUrls[partNum - 1]]);

  // Support paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const base64 = event.target?.result as string;
              setAttachedImage(base64);
              showToast('📎 Đã dán ảnh minh họa lỗi từ Clipboard!');
            };
            reader.readAsDataURL(blob);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, showToast]);

  if (!isOpen) return null;

  const idx = partNum - 1;
  const imgUrl = sceneImages[idx] || null;
  const vidUrl = sceneUrls[idx] || null;
  const displayImg = getDisplayImageUrl(imgUrl);
  const displayVid = useMemo(() => {
    if (!vidUrl) return null;
    const separator = vidUrl.includes('?') ? '&' : '?';
    return `${vidUrl}${separator}t=${videoVersion}`;
  }, [vidUrl, videoVersion]);

  const handleVideoLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration || 0;
      setVideoDuration(dur);
      setTrimEnd((prev) => (prev === '0.0' || !prev ? dur.toFixed(1) : prev));
    }
  };

  const handleSetTrimStartCurrent = () => {
    if (videoRef.current) {
      setTrimStart(videoRef.current.currentTime.toFixed(1));
    }
  };

  const handleSetTrimEndCurrent = () => {
    if (videoRef.current) {
      setTrimEnd(videoRef.current.currentTime.toFixed(1));
    }
  };

  const handleQuickTrimPreset = (preset: string) => {
    const dur = videoDuration || 5.0;
    if (preset === 'cut_head_0.5') {
      setTrimStart('0.5');
      setTrimEnd(dur.toFixed(1));
    } else if (preset === 'cut_tail_0.5') {
      setTrimStart('0.0');
      setTrimEnd(Math.max(0.5, dur - 0.5).toFixed(1));
    } else if (preset === 'cut_tail_1.0') {
      setTrimStart('0.0');
      setTrimEnd(Math.max(0.5, dur - 1.0).toFixed(1));
    } else if (preset === 'cut_tail_1.5') {
      setTrimStart('0.0');
      setTrimEnd(Math.max(0.5, dur - 1.5).toFixed(1));
    } else if (preset === 'reset_full') {
      setTrimStart('0.0');
      setTrimEnd(dur.toFixed(1));
    }
  };

  const previewListenerRef = useRef<(() => void) | null>(null);

  const handlePreviewTrim = () => {
    if (videoRef.current) {
      const s = Math.max(0, parseFloat(trimStart) || 0);
      const e = parseFloat(trimEnd) || videoDuration;
      if (s >= e) {
        showToast('⚠️ Mốc kết thúc (s) phải lớn hơn mốc bắt đầu (s)!');
        return;
      }
      if (previewListenerRef.current) {
        videoRef.current.removeEventListener('timeupdate', previewListenerRef.current);
        previewListenerRef.current = null;
      }
      videoRef.current.currentTime = s;
      videoRef.current.play().catch(() => {});
      const checkEnd = () => {
        if (videoRef.current && videoRef.current.currentTime >= e) {
          videoRef.current.pause();
          videoRef.current.removeEventListener('timeupdate', checkEnd);
          previewListenerRef.current = null;
        }
      };
      previewListenerRef.current = checkEnd;
      videoRef.current.addEventListener('timeupdate', checkEnd);
    }
  };

  const handleSubmitTrim = async () => {
    const s = Math.max(0, parseFloat(trimStart) || 0);
    const e = parseFloat(trimEnd) || videoDuration;
    if (e <= s) {
      showToast('⚠️ Mốc kết thúc (s) phải lớn hơn mốc bắt đầu (s)!');
      return;
    }

    setIsTrimming(true);
    try {
      showToast(`✂️ Đang cắt video Part ${partNum} (từ ${s}s đến ${e}s)...`);
      const jobFolder = vidUrl?.match(/\/downloads\/([^/]+)\//)?.[1];
      const res = await fetch('/api/pipeline/trim-part-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName,
          job_folder: jobFolder,
          scene_index: idx,
          start_sec: s,
          end_sec: e,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Cắt video thất bại');
      
      const newDur = typeof data.duration_sec === 'number' && data.duration_sec > 0
        ? data.duration_sec
        : Math.max(0.1, e - s);

      showToast(`🎉 ${data.message || `Cắt và lưu video Part ${partNum} thành công!`}`);
      setVideoDuration(newDur);
      setTrimStart('0.0');
      setTrimEnd(newDur.toFixed(1));
      setVideoVersion(Date.now());
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.load();
      }
      await onRefreshPartsStatus();
    } catch (err: any) {
      showToast(`❌ Lỗi cắt video: ${err.message}`);
    } finally {
      setIsTrimming(false);
    }
  };

  const handleRestoreVideo = async () => {
    if (!window.confirm(`Khôi phục lại video gốc ban đầu cho Part ${partNum}?`)) return;
    setIsRestoring(true);
    try {
      showToast(`🔄 Đang khôi phục video gốc cho Part ${partNum}...`);
      const jobFolder = vidUrl?.match(/\/downloads\/([^/]+)\//)?.[1];
      const res = await fetch('/api/pipeline/restore-part-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName,
          job_folder: jobFolder,
          scene_index: idx,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Khôi phục video thất bại');
      
      const origDur = typeof data.duration_sec === 'number' && data.duration_sec > 0
        ? data.duration_sec
        : 10.0;

      showToast(`🎉 ${data.message || `Đã khôi phục video gốc cho Part ${partNum}!`}`);
      setVideoDuration(origDur);
      setTrimStart('0.0');
      setTrimEnd(origDur.toFixed(1));
      setVideoVersion(Date.now());
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.load();
      }
      await onRefreshPartsStatus();
    } catch (err: any) {
      showToast(`❌ Lỗi khôi phục: ${err.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleStartDebate = async () => {
    setIsDebating(true);
    setDebateResult(null);
    try {
      showToast(`🤖 2-AI (AGY Gemini 3.8 & GLM-5) đang phân tích và thảo luận Part ${partNum}...`);
      const specificFeedback = debateFeedback.trim() || `Tập trung phân tích và nâng tầm độ cuốn hút, biểu cảm 3D Pixar sinh động cho Part ${partNum}.`;

      const payload: any = {
        product_name: productName,
        category,
        prompts_obj: promptsObj,
        scene_indices: [idx],
        feedback: specificFeedback,
        image_url: originalImageUrl,
      };
      if (attachedImage) {
        payload.feedback_image_url = attachedImage;
      }

      const res = await fetch('/api/prompts/revise-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.success || !data.prompts_obj) {
        throw new Error(data.error || 'Lỗi 2 AI thảo luận');
      }

      const agreedPrompt = data.prompts_obj[`prompt${partNum}`] || '';
      const agreedDialogue = data.prompts_obj[`dialogue${partNum}`] || '';
      const revNote = data.revision_note || 'Đã đồng thuận 100% về kịch bản Part này.';

      setDebateResult({
        prompt: agreedPrompt,
        dialogue: agreedDialogue,
        note: revNote,
        ai1Text: data.ai1_proposal || '',
        ai2Text: data.ai2_audit || '',
      });
      showToast(`🎉 2-AI đã đồng thuận 100% kịch bản Part ${partNum}! Bấm "Áp Dụng" để cập nhật.`);
    } catch (err: any) {
      showToast(`❌ Lỗi thảo luận: ${err.message}`);
    } finally {
      setIsDebating(false);
    }
  };

  const handleApplyDebate = async () => {
    if (!debateResult) return;
    setPromptText(debateResult.prompt);
    setDialogueText(debateResult.dialogue);
    await onSavePartPrompt(partNum, debateResult.prompt, debateResult.dialogue);
    showToast(`✅ Đã áp dụng đề xuất 2-AI vào kịch bản Part ${partNum}!`);
  };

  const handleSaveCurrent = async () => {
    setIsSavingPrompt(true);
    try {
      const res = await onSavePartPrompt(partNum, promptText, dialogueText);
      if (res !== false) {
        showToast(`💾 Đã lưu kịch bản Part ${partNum}!`);
      }
    } catch (err: any) {
      showToast(`❌ Lỗi lưu kịch bản: ${err.message}`);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleSwitchOffset = (offset: number) => {
    const next = Math.max(1, Math.min(6, partNum + offset));
    if (next !== partNum) {
      onSavePartPrompt(partNum, promptText, dialogueText);
      onSwitchPart(next);
    }
  };

  const handleTriggerRedraw = async () => {
    setIsDrawing(true);
    try {
      await onSavePartPrompt(partNum, promptText, dialogueText);
      await onRedrawSingleImage(partNum, refSource, redrawNote, promptText, dialogueText);
    } finally {
      setIsDrawing(false);
    }
  };

  const handleTriggerRenderVideo = async () => {
    setIsRendering(true);
    try {
      await onSavePartPrompt(partNum, promptText, dialogueText);
      await onRenderSingleVideo(partNum, promptText, dialogueText);
      setVideoVersion(Date.now());
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal part-editor-modal" onClick={(e) => e.stopPropagation()}>
        {/* Top Header & Part Navigation */}
        <div
          className="part-editor-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '12px',
            borderBottom: '1px solid var(--border)',
            width: '100%',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span>🎬 Chi Tiết Kịch Bản & 2-AI Thảo Luận:</span>
              <span style={{ color: '#c084fc', background: 'rgba(192,132,252,0.15)', padding: '2px 10px', borderRadius: '8px', border: '1px solid rgba(192,132,252,0.3)' }}>
                Part {partNum}
              </span>
            </span>
            <div style={{ display: 'flex', gap: '6px', fontSize: '11px' }}>
              <span
                style={{
                  background: imgUrl ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                  color: imgUrl ? '#10b981' : 'var(--muted)',
                  padding: '3px 9px',
                  borderRadius: '6px',
                  fontWeight: 600,
                }}
              >
                🖼️ Ảnh: {imgUrl ? 'OK' : 'Chưa có'}
              </span>
              <span
                style={{
                  background: vidUrl ? 'rgba(139,92,246,0.15)' : 'rgba(100,116,139,0.15)',
                  color: vidUrl ? '#a78bfa' : 'var(--muted)',
                  padding: '3px 9px',
                  borderRadius: '6px',
                  fontWeight: 600,
                }}
              >
                🎬 Video: {vidUrl ? 'OK' : 'Chưa có'}
              </span>
            </div>
          </div>

          {/* Quick Part Switcher Bar */}
          <div className="part-nav-pills-bar">
            <button
              type="button"
              onClick={() => handleSwitchOffset(-1)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 11px', borderRadius: '7px', fontSize: '12px', cursor: 'pointer' }}
              title="Part trước"
            >
              ◀
            </button>
            {[1, 2, 3, 4, 5, 6].map((p) => {
              const isActive = p === partNum;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    if (p !== partNum) {
                      onSavePartPrompt(partNum, promptText, dialogueText);
                      onSwitchPart(p);
                    }
                  }}
                  style={{
                    background: isActive ? 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)' : 'var(--bg3)',
                    color: isActive ? '#fff' : 'var(--text)',
                    border: isActive ? 'none' : '1px solid var(--border)',
                    padding: '5px 11px',
                    borderRadius: '7px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Part {p}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => handleSwitchOffset(1)}
              style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 11px', borderRadius: '7px', fontSize: '12px', cursor: 'pointer' }}
              title="Part tiếp theo"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '26px', cursor: 'pointer', lineHeight: 1, marginLeft: '8px' }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* 2-Column Body Grid */}
        <div className="part-editor-body-grid">
          {/* Left Column: Script, Visual, Video, Trimmer */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', paddingRight: '6px' }}>
            {/* Visual Preview Card */}
            <div className="part-preview-card" style={{ display: 'flex', gap: '12px', background: 'var(--bg3)', padding: '10px', borderRadius: '10px', border: '1px solid var(--border)' }}>
              <div
                className="part-preview-thumb"
                onClick={() => displayImg && onOpenLightbox(displayImg, `Phân Cảnh ${partNum}: Bảng 6 Bước Diễn Hoạt`, idx)}
                style={{ width: '170px', height: '96px', aspectRatio: '16/9', borderRadius: '8px', overflow: 'hidden', background: '#000', flexShrink: 0, cursor: 'pointer', position: 'relative' }}
              >
                {displayImg ? (
                  <>
                    <img src={displayImg} alt={`Part ${partNum}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.75)', color: '#a78bfa', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                      🔍 Zoom
                    </div>
                  </>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '11px' }}>
                    🎨 Chưa có ảnh
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                  Bảng 6 bước phân cảnh (Gemini)
                </div>

                {displayImg && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <a
                      href={displayImg}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: '11px',
                        color: '#38bdf8',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '3px 8px',
                        background: 'rgba(56,189,248,0.12)',
                        borderRadius: '6px',
                        border: '1px solid rgba(56,189,248,0.3)',
                        fontWeight: 600,
                      }}
                    >
                      <span>🔗 Mở Ảnh Tab Mới</span>
                    </a>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                  <button
                    type="button"
                    onClick={handleTriggerRedraw}
                    disabled={isDrawing}
                    style={{
                      background: 'linear-gradient(135deg,#ec4899,#f59e0b)',
                      color: '#fff',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '7px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    🎨 {isDrawing ? 'Đang vẽ...' : 'Vẽ Lại Ảnh Part Này'}
                  </button>

                  <button
                    type="button"
                    onClick={handleTriggerRenderVideo}
                    disabled={isRendering || !displayImg}
                    style={{
                      background: 'linear-gradient(135deg,#8b5cf6,#3b82f6)',
                      color: '#fff',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '7px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    🎬 {isRendering ? 'Đang tạo...' : 'Render Video Veo'}
                  </button>

                  <button
                    type="button"
                    onClick={onStopPipeline}
                    style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '6px 10px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    ⛔ Dừng
                  </button>
                </div>
              </div>
            </div>

            {/* Video Preview & Trimmer Box */}
            <div
              style={{
                background: 'rgba(59,130,246,0.06)',
                border: '1px solid rgba(59,130,246,0.25)',
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🎬 Xem Trước Video & Cắt Đoạn Thừa (Trimmer):</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: '#93c5fd', background: 'rgba(59,130,246,0.18)', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                    Thời lượng: {videoDuration ? `${videoDuration.toFixed(1)}s` : '--s'}
                  </span>
                  {vidUrl && (
                    <button
                      type="button"
                      onClick={handleRestoreVideo}
                      disabled={isRestoring}
                      style={{
                        background: 'rgba(245,158,11,0.15)',
                        border: '1px solid rgba(245,158,11,0.4)',
                        color: '#fbbf24',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      title="Khôi phục lại video gốc ban đầu trước khi cắt"
                    >
                      {isRestoring ? 'Đang khôi phục...' : '🔄 Khôi phục video gốc'}
                    </button>
                  )}
                </div>
              </div>

              {/* Video Player or Placeholder */}
              {displayVid ? (
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    maxHeight: '240px',
                    aspectRatio: '16/9',
                    background: '#000',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border)',
                  }}
                >
                  <video
                    ref={videoRef}
                    src={displayVid}
                    controls
                    onLoadedMetadata={handleVideoLoadedMetadata}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    padding: '14px',
                    textAlign: 'center',
                    background: 'var(--bg3)',
                    borderRadius: '8px',
                    border: '1px dashed var(--border)',
                    color: 'var(--muted)',
                    fontSize: '11.5px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>🎬 Chưa có file Video cho Part này</span>
                  <span style={{ fontSize: '10.5px' }}>Bấm <b>"Render Video Veo"</b> ở trên để tạo video clip cho Part này</span>
                </div>
              )}

              {/* Trimmer Controls Bar (Only when video exists) */}
              {displayVid && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg3)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '11.5px' }}>
                    {/* Start Time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#a78bfa', fontWeight: 700 }}>⏱️ Bắt đầu (s):</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={trimStart}
                        onChange={(e) => setTrimStart(e.target.value)}
                        style={{ width: '65px', padding: '3px 6px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '11.5px', outline: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={handleSetTrimStartCurrent}
                        style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)', color: '#c084fc', padding: '3px 7px', borderRadius: '5px', fontSize: '10.5px', fontWeight: 600, cursor: 'pointer' }}
                        title="Lấy mốc thời gian đang phát hiện tại"
                      >
                        📍 Mốc này
                      </button>
                    </div>

                    {/* End Time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#f472b6', fontWeight: 700 }}>⏱️ Kết thúc (s):</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={trimEnd}
                        onChange={(e) => setTrimEnd(e.target.value)}
                        style={{ width: '65px', padding: '3px 6px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '11.5px', outline: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={handleSetTrimEndCurrent}
                        style={{ background: 'rgba(236,72,153,0.15)', border: '1px solid rgba(236,72,153,0.35)', color: '#f472b6', padding: '3px 7px', borderRadius: '5px', fontSize: '10.5px', fontWeight: 600, cursor: 'pointer' }}
                        title="Lấy mốc thời gian đang phát hiện tại"
                      >
                        📍 Mốc này
                      </button>
                    </div>
                  </div>

                  {/* Quick Trim Chips */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '10.5px', color: 'var(--muted)', fontWeight: 600 }}>Cắt nhanh:</span>
                    <button type="button" className="part-guidance-chip" onClick={() => handleQuickTrimPreset('cut_head_0.5')} style={{ color: '#a78bfa', fontSize: '10.5px', padding: '2px 7px' }}>✂️ Bỏ 0.5s đầu</button>
                    <button type="button" className="part-guidance-chip" onClick={() => handleQuickTrimPreset('cut_tail_0.5')} style={{ color: '#f472b6', fontSize: '10.5px', padding: '2px 7px' }}>✂️ Bỏ 0.5s đuôi</button>
                    <button type="button" className="part-guidance-chip" onClick={() => handleQuickTrimPreset('cut_tail_1.0')} style={{ color: '#f472b6', fontSize: '10.5px', padding: '2px 7px' }}>✂️ Bỏ 1.0s đuôi</button>
                    <button type="button" className="part-guidance-chip" onClick={() => handleQuickTrimPreset('cut_tail_1.5')} style={{ color: '#f472b6', fontSize: '10.5px', padding: '2px 7px' }}>✂️ Bỏ 1.5s đuôi</button>
                    <button type="button" className="part-guidance-chip" onClick={() => handleQuickTrimPreset('reset_full')} style={{ color: 'var(--muted)', fontSize: '10.5px', padding: '2px 7px' }}>🔄 Toàn bộ video</button>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', marginTop: '2px' }}>
                    <button
                      type="button"
                      onClick={handlePreviewTrim}
                      style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#60a5fa', padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      ▶️ Xem Thử Đoạn Cắt
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitTrim}
                      disabled={isTrimming}
                      style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', boxShadow: '0 2px 8px rgba(59,130,246,0.3)' }}
                    >
                      {isTrimming ? '⏳ Đang cắt...' : '✂️ Cắt & Lưu Video Part Này'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Redraw Reference & Director Note Card */}
            <div
              style={{
                background: 'rgba(236,72,153,0.06)',
                border: '1px solid rgba(236,72,153,0.28)',
                borderRadius: '10px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#f472b6' }}>
                  <span>🎯 Tham Khảo Mẫu & Chỉ Đạo Vẽ Lại:</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, maxWidth: '320px', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Ảnh mẫu:</span>
                  <select
                    value={refSource}
                    onChange={(e) => setRefSource(parseInt(e.target.value, 10))}
                    style={{ width: '100%', maxWidth: '240px', background: 'var(--bg3)', border: '1px solid rgba(236,72,153,0.4)', color: 'var(--text)', padding: '4px 8px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="-1">🖼️ Ảnh Gốc Sản Phẩm</option>
                    {[1, 2, 3, 4, 5, 6].map((p) => (
                      <option key={p} value={p - 1}>
                        🎬 Part {p} (Cảnh {p}) {p === partNum ? '[Part hiện tại]' : sceneImages[p - 1] ? '(✅ Đã có ảnh)' : '(Chưa có ảnh)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <textarea
                  rows={2}
                  value={redrawNote}
                  onChange={(e) => setRedrawNote(e.target.value)}
                  placeholder="📝 Ghi chú cho Bot (VD: Lấy chuẩn nhân vật, lông và áo từ Part 2 để vẽ lại Part 1; cho nhân vật đứng cười tươi...)"
                  style={{ width: '100%', padding: '7px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text)', fontSize: '12px', lineHeight: 1.4, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button type="button" className="part-guidance-chip" onClick={() => setRedrawNote((n) => (n ? `${n}; ` : '') + 'Lấy chuẩn 100% gương mặt, màu lông, màu mắt và trang phục nhân vật từ ảnh mẫu')} style={{ color: '#f472b6', fontSize: '10.5px', padding: '2px 7px' }}>🎯 Khóa nhân vật mẫu</button>
                  <button type="button" className="part-guidance-chip" onClick={() => setRedrawNote((n) => (n ? `${n}; ` : '') + 'Giữ nguyên ngoại hình nhưng đổi góc cận cảnh biểu cảm ngạc nhiên vui sướng')} style={{ color: '#c084fc', fontSize: '10.5px', padding: '2px 7px' }}>😄 Cận cảnh biểu cảm</button>
                  <button type="button" className="part-guidance-chip" onClick={() => setRedrawNote((n) => (n ? `${n}; ` : '') + 'Tăng cường ánh sáng ấm Pixar, làm nổi bật sản phẩm trên tay nhân vật')} style={{ color: '#38bdf8', fontSize: '10.5px', padding: '2px 7px' }}>✨ Nổi bật sản phẩm</button>
                  <button type="button" className="part-guidance-chip" onClick={() => setRedrawNote((n) => (n ? `${n}; ` : '') + 'Giữ nguyên bối cảnh nhưng cho nhân vật thực hiện động tác nhảy múa hào hứng')} style={{ color: '#fbbf24', fontSize: '10.5px', padding: '2px 7px' }}>💃 Nhảy múa hào hứng</button>
                </div>
              </div>
            </div>

            {/* Prompt Textarea */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#f472b6', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>📝 Visual Prompt (English - Dành cho Gemini / Veo):</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(promptText);
                    showToast('📋 Đã sao chép prompt!');
                  }}
                  style={{ background: 'transparent', border: 'none', color: '#a78bfa', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                >
                  📋 Copy Prompt
                </button>
              </div>
              <textarea
                rows={7}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Detailed 3D Pixar animation scene prompt..."
                style={{ width: '100%', padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '13px', lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Dialogue Textarea */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>💬 Lời Thoại (Tiếng Việt - Lồng tiếng & Phụ đề):</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(dialogueText);
                    showToast('📋 Đã sao chép lời thoại!');
                  }}
                  style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                >
                  📋 Copy Thoại
                </button>
              </div>
              <textarea
                rows={3}
                value={dialogueText}
                onChange={(e) => setDialogueText(e.target.value)}
                placeholder="Lời thoại tiếng Việt tự nhiên, cảm xúc cho Part này..."
                style={{ width: '100%', padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '13.5px', lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Save & Nav buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => handleSwitchOffset(-1)}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  ◀ Part Trước
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchOffset(1)}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Part Sau ▶
                </button>
              </div>
              <button
                type="button"
                onClick={handleSaveCurrent}
                disabled={isSavingPrompt}
                style={{
                  background: isSavingPrompt ? '#059669' : '#10b981',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 18px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isSavingPrompt ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  opacity: isSavingPrompt ? 0.8 : 1,
                  transition: 'all 0.2s ease',
                }}
              >
                {isSavingPrompt ? '⏳ Đang lưu...' : '💾 Lưu Kịch Bản Part Này'}
              </button>
            </div>
          </div>

          {/* Right Column: 2-AI Thảo Luận & Tranh Biện Trực Tiếp */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              background: 'var(--bg3)',
              border: '1px solid rgba(139,92,246,0.35)',
              borderRadius: '14px',
              padding: '14px',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🤝 2-AI Thảo Luận & Tối Ưu Riêng Part Này</span>
              </div>
              <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16,185,129,0.15)', padding: '3px 9px', borderRadius: '8px', fontWeight: 600 }}>
                AGY Gemini 3.8 & GLM-5
              </span>
            </div>

            {/* Quick Guidance Tag Chips */}
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <button type="button" className="part-guidance-chip" onClick={() => setDebateFeedback((f) => (f ? `${f}; ` : '') + 'Chuyển cảnh liền mạch với Part trước, giữ nguyên góc máy và đà chuyển động')} style={{ color: '#60a5fa' }}>🎬 Nối mượt Part trước</button>
              <button type="button" className="part-guidance-chip" onClick={() => setDebateFeedback((f) => (f ? `${f}; ` : '') + 'Match-Cut nối liền động tác và vị trí đạo cụ mượt mà không bị giật khung')} style={{ color: '#38bdf8' }}>🔗 Match-Cut mượt mà</button>
              <button type="button" className="part-guidance-chip" onClick={() => setDebateFeedback((f) => (f ? `${f}; ` : '') + 'Khóa chuẩn tỷ lệ Chibi đầu to tròn thân mập lùn chân tay ngắn cũn, cấm dáng người lớn')} style={{ color: '#f472b6' }}>👶 Khóa dáng Chibi</button>
              <button type="button" className="part-guidance-chip" onClick={() => setDebateFeedback((f) => (f ? `${f}; ` : '') + 'Cho nhân vật biểu cảm vui nhộn, nhảy múa tinh nghịch')} style={{ color: '#c084fc' }}>🎭 Nhảy múa vui nhộn</button>
              <button type="button" className="part-guidance-chip" onClick={() => setDebateFeedback((f) => (f ? `${f}; ` : '') + 'Khóa đúng ngoại hình và trang phục nhân vật, không đổi loài')} style={{ color: '#a78bfa' }}>🐱 Khóa đúng nhân vật</button>
              <button type="button" className="part-guidance-chip" onClick={() => setDebateFeedback((f) => (f ? `${f}; ` : '') + 'Quay góc cận cảnh (Close-up) sắc nét khuôn mặt và sản phẩm')} style={{ color: '#34d399' }}>🔍 Cận cảnh biểu cảm</button>
            </div>

            {/* Input Góp ý cho 2 AI */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <textarea
                rows={2}
                value={debateFeedback}
                onChange={(e) => setDebateFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleStartDebate();
                  }
                }}
                placeholder="💬 Chỉ đạo cho 2 AI hoặc DÁN ẢNH (Ctrl+V) vào đây... (VD: Sửa cảnh này cho nhân vật nhảy múa, phân biệt rõ gấu nâu và gấu trắng...)"
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', lineHeight: 1.4 }}
              />

              {/* Attached Image Preview */}
              {attachedImage && (
                <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px dashed rgba(124,58,237,0.45)', borderRadius: '8px', padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <img src={attachedImage} alt="Debate preview" style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#c084fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        📸 Đã đính kèm ảnh minh họa lỗi
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--muted)' }}>2 AI sẽ phân tích trực tiếp ảnh này</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => setAttachedImage(null)} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>
                    &times; Xóa
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <label
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#a78bfa', cursor: 'pointer', background: 'rgba(124,58,237,0.12)', padding: '5px 9px', borderRadius: '6px', border: '1px solid rgba(124,58,237,0.3)', fontWeight: 600 }}
                  title="Bấm để chọn file ảnh hoặc nhấn Ctrl+V / Cmd+V để dán trực tiếp"
                >
                  <span>📎 Dán (Ctrl+V) / Chọn Ảnh Lỗi</span>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        setAttachedImage(evt.target?.result as string);
                        showToast('📎 Đã đính kèm ảnh!');
                      };
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>

                <div style={{ display: 'flex', gap: '6px', flex: 1, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleStartDebate}
                    disabled={isDebating}
                    style={{ flex: 1, background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)', color: '#fff', border: 'none', padding: '7px 12px', borderRadius: '7px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                  >
                    {isDebating ? '⏳ 2 AI đang thảo luận...' : '🚀 Bắt Đầu 2-AI Thảo Luận Part Này'}
                  </button>
                  {debateResult && (
                    <button
                      type="button"
                      onClick={handleApplyDebate}
                      style={{ background: '#10b981', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: '7px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      ✨ Áp Dụng Vào Part
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Live Debate Container */}
            <div
              style={{
                flex: 1,
                minHeight: '220px',
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '10px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                fontSize: '11.5px',
                lineHeight: 1.5,
              }}
            >
              {isDebating && (
                <div
                  style={{
                    background: 'linear-gradient(90deg, rgba(139,92,246,0.15) 0%, rgba(236,72,153,0.18) 50%, rgba(139,92,246,0.15) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmerSweep 3s linear infinite, activeRoundGlow 2s infinite',
                    border: '1px solid rgba(236,72,153,0.45)',
                    borderRadius: '10px',
                    padding: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    color: '#c084fc',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        width: '9px',
                        height: '9px',
                        borderRadius: '50%',
                        background: '#ec4899',
                        animation: 'livePulse 1s infinite',
                        flexShrink: 0,
                        display: 'inline-block',
                      }}
                    />
                    <div>
                      <b style={{ color: '#f472b6' }}>AGY Gemini 3.8 & Zhipu GLM-5</b> đang phân tích Part {partNum} và cùng kiểm định kịch bản...
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, background: 'rgba(236,72,153,0.3)', color: '#f472b6', padding: '2px 7px', borderRadius: '6px', letterSpacing: '0.5px' }}>
                      ĐANG CHẠY
                    </span>
                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#f472b6', display: 'inline-block', animation: 'bounceDot 1.4s infinite ease-in-out', animationDelay: '0s' }} />
                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#f472b6', display: 'inline-block', animation: 'bounceDot 1.4s infinite ease-in-out', animationDelay: '0.2s' }} />
                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#f472b6', display: 'inline-block', animation: 'bounceDot 1.4s infinite ease-in-out', animationDelay: '0.4s' }} />
                  </div>
                </div>
              )}

              {debateResult ? (
                <>
                  {/* AGY Gemini 3.8 Proposal Bubble */}
                  <div style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.3)', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ fontWeight: 700, color: '#f472b6', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>🎭 <b>AI 1 (AGY Gemini 3.8)</b> — Biên Kịch 3D</span>
                      <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{new Date().toLocaleTimeString('vi-VN')}</span>
                    </div>
                    {debateResult.ai1Text && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px', whiteSpace: 'pre-line', maxHeight: '120px', overflowY: 'auto', background: 'rgba(0,0,0,0.25)', padding: '6px 8px', borderRadius: '6px' }}>
                        {debateResult.ai1Text.slice(0, 400)}
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: 'var(--text)', marginBottom: '6px', lineHeight: 1.4 }}>
                      <b style={{ color: '#f472b6' }}>Đề xuất Visual:</b> {debateResult.prompt}
                    </div>
                    <div style={{ fontSize: '12px', color: '#38bdf8', lineHeight: 1.4 }}>
                      <b>Đề xuất Thoại:</b> "{debateResult.dialogue}"
                    </div>
                  </div>

                  {/* GLM-5 Audit Consensus Bubble */}
                  <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ fontWeight: 700, color: '#10b981', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>🧐 <b>AI 2 (Zhipu GLM-5)</b> — Giám Đốc Kiểm Định</span>
                      <span style={{ background: 'rgba(16,185,129,0.2)', color: '#10b981', padding: '2px 7px', borderRadius: '6px', fontSize: '10px', fontWeight: 700 }}>
                        ĐỒNG THUẬN 100%
                      </span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text)', lineHeight: 1.5 }}>
                      {debateResult.ai2Text || debateResult.note}
                    </div>
                  </div>

                  {/* Quick Apply Banner */}
                  <div style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(16,185,129,0.15))', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '10px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontSize: '11.5px', color: '#10b981', fontWeight: 600 }}>
                      ✨ Kịch bản đã sẵn sàng! Bấm để cập nhật ngay vào ô nhập:
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyDebate}
                      style={{ background: '#10b981', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      ✨ Áp Dụng Ngay
                    </button>
                  </div>
                </>
              ) : (
                !isDebating && (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', margin: 'auto', padding: '16px' }}>
                    💡 Nhập góp ý ở trên và bấm "Bắt Đầu 2-AI Thảo Luận" để <b>AGY Gemini 3.8 tạo bản thảo & Zhipu GLM-5 kiểm định</b> và tối ưu kịch bản cho Part này.
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
