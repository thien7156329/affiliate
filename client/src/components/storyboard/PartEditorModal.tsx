import React, { useEffect, useRef, useState } from 'react';
import { ProductCategory } from '../../types';
import { useToast } from '../../context/ToastContext';

interface PartEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  partNum: number;
  productName: string;
  category: ProductCategory;
  originalImageUrl: string;
  promptsObj: Record<string, string>;
  sceneImages: string[];
  sceneUrls: string[];
  onSwitchPart: (partNum: number) => void;
  onSavePartPrompt: (partNum: number, prompt: string, dialogue: string) => Promise<boolean>;
  onRedrawSingleImage: (partNum: number, refSource: number, notes?: string, promptOverride?: string, dialogueOverride?: string) => Promise<boolean | void>;
  onRenderSingleVideo: (partNum: number, promptOverride?: string, dialogueOverride?: string) => Promise<boolean | void>;
  onStopPipeline: () => void;
  onOpenLightbox: (imageUrl: string, title: string, partIndex: number) => void;
  onRefreshPartsStatus: () => Promise<void>;
  onRevisePrompt?: (feedback: string) => Promise<void>;
  isRevisingPrompts?: boolean;
  revisingStatusText?: string;
}

const formatSeconds = (seconds: number) => `${Math.max(0, seconds).toFixed(seconds >= 10 ? 1 : 2)}s`;

const cardStyle: React.CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '12px',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: '7px',
  color: 'var(--text)',
  fontSize: '12px',
  outline: 'none',
};

export const PartEditorModal: React.FC<PartEditorModalProps> = ({
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
  onRevisePrompt,
  isRevisingPrompts = false,
  revisingStatusText = '',
}) => {
  const { showToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [localPrompt, setLocalPrompt] = useState('');
  const [localDialogue, setLocalDialogue] = useState('');
  const [aiFeedbackModal, setAiFeedbackModal] = useState('');
  const [refSource, setRefSource] = useState<number>(partNum === 1 ? -1 : 0);
  const [redrawNotes, setRedrawNotes] = useState('');
  const [trimStart, setTrimStart] = useState('0');
  const [trimEnd, setTrimEnd] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [isTrimPreviewing, setIsTrimPreviewing] = useState(false);
  const [videoReloadKey, setVideoReloadKey] = useState(0);
  const [isTrimming, setIsTrimming] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const currentImage = sceneImages[partNum - 1];
  const currentVideo = sceneUrls[partNum - 1];

  useEffect(() => {
    if (!isOpen) return;
    setLocalPrompt(promptsObj[`prompt${partNum}`] || (partNum === 1 ? promptsObj.prompt : '') || '');
    setLocalDialogue(promptsObj[`dialogue${partNum}`] || '');
    setRefSource(partNum === 1 ? -1 : 0);
    setRedrawNotes('');
    setTrimStart('0');
    setTrimEnd('');
    setVideoDuration(0);
    setIsTrimPreviewing(false);
    setVideoReloadKey((key) => key + 1);
  }, [isOpen, partNum, promptsObj, currentVideo]);

  if (!isOpen) return null;

  const parsedStart = Number.parseFloat(trimStart);
  const parsedEnd = Number.parseFloat(trimEnd);
  const displayStart = Number.isFinite(parsedStart) ? Math.max(0, parsedStart) : 0;
  const displayEnd = Number.isFinite(parsedEnd) && parsedEnd > 0 ? parsedEnd : videoDuration;
  const selectedDuration = Math.max(0, displayEnd - displayStart);
  const startPercent = videoDuration > 0 ? Math.min(100, Math.max(0, (displayStart / videoDuration) * 100)) : 0;
  const endPercent = videoDuration > 0 ? Math.min(100, Math.max(startPercent, (displayEnd / videoDuration) * 100)) : 100;

  const readTrimRange = () => {
    const start = Number.parseFloat(trimStart);
    const end = Number.parseFloat(trimEnd);

    if (!Number.isFinite(start) || start < 0) {
      showToast('⚠️ Mốc bắt đầu phải là số từ 0 trở lên.');
      return null;
    }
    if (!Number.isFinite(end) || end <= 0) {
      showToast('⚠️ Mốc kết thúc chưa hợp lệ. Hãy đợi video tải xong hoặc nhập số giây.');
      return null;
    }
    if (end <= start + 0.05) {
      showToast('⚠️ Mốc kết thúc phải lớn hơn mốc bắt đầu.');
      return null;
    }
    if (videoDuration > 0 && end > videoDuration + 0.1) {
      showToast(`⚠️ Mốc kết thúc vượt quá thời lượng video (${formatSeconds(videoDuration)}).`);
      return null;
    }

    return { start, end };
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const ok = await onSavePartPrompt(partNum, localPrompt, localDialogue);
      if (ok) showToast(`💾 Đã lưu kịch bản Part ${partNum}!`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRedraw = async () => {
    setIsDrawing(true);
    try {
      await onRedrawSingleImage(partNum, refSource, redrawNotes, localPrompt, localDialogue);
      await onRefreshPartsStatus();
    } finally {
      setIsDrawing(false);
    }
  };

  const handleRenderVideo = async () => {
    setIsRendering(true);
    try {
      await onRenderSingleVideo(partNum, localPrompt, localDialogue);
      await onRefreshPartsStatus();
    } finally {
      setIsRendering(false);
    }
  };

  const handlePreviewTrim = async () => {
    const range = readTrimRange();
    if (!range || !videoRef.current) return;

    try {
      videoRef.current.currentTime = range.start;
      await videoRef.current.play();
      setIsTrimPreviewing(true);
      showToast(`👀 Review Part ${partNum}: ${formatSeconds(range.start)} → ${formatSeconds(range.end)}. Chưa sửa file.`);
    } catch {
      showToast('⚠️ Không thể tự phát preview. Bấm Play để review đoạn đã chọn.');
    }
  };

  const handleSetStartCurrent = () => {
    const currentTime = videoRef.current?.currentTime ?? 0;
    const end = Number.parseFloat(trimEnd);
    if (Number.isFinite(end) && currentTime >= end - 0.05) {
      showToast('⚠️ Mốc bắt đầu phải nằm trước mốc kết thúc.');
      return;
    }
    setTrimStart(Math.max(0, currentTime).toFixed(2));
    setIsTrimPreviewing(false);
  };

  const handleSetEndCurrent = () => {
    const currentTime = videoRef.current?.currentTime ?? 0;
    const start = Number.parseFloat(trimStart) || 0;
    if (currentTime <= start + 0.05) {
      showToast('⚠️ Mốc kết thúc phải nằm sau mốc bắt đầu.');
      return;
    }
    setTrimEnd(currentTime.toFixed(2));
    setIsTrimPreviewing(false);
  };

  const handleResetRange = () => {
    setTrimStart('0');
    setTrimEnd(videoDuration > 0 ? videoDuration.toFixed(2) : '');
    setIsTrimPreviewing(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const applyPreset = (start: number) => {
    setTrimStart(start.toFixed(2));
    setTrimEnd(videoDuration > start ? videoDuration.toFixed(2) : '');
    setIsTrimPreviewing(false);
  };

  const handleTrimVideo = async () => {
    if (!currentVideo) return;
    const range = readTrimRange();
    if (!range) return;

    if (!window.confirm(
      `Cắt Part ${partNum}, chỉ giữ đoạn ${formatSeconds(range.start)} → ${formatSeconds(range.end)}?\n\n` +
      `Đoạn sau cắt dài khoảng ${formatSeconds(range.end - range.start)}. Server sẽ giữ backup để có thể khôi phục.`,
    )) return;

    setIsTrimming(true);
    try {
      showToast(`✂️ Đang cắt Part ${partNum}: ${formatSeconds(range.start)} → ${formatSeconds(range.end)}...`);
      const res = await fetch('/api/pipeline/trim-part-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim() || 'scene',
          scene_index: partNum - 1,
          start_sec: range.start,
          end_sec: range.end,
          from_original: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Cắt video thất bại');

      showToast(`🎉 Đã cắt Part ${partNum}. Có thể bấm “Khôi phục gốc” nếu chưa ưng.`);
      setVideoDuration(0);
      setTrimStart('0');
      setTrimEnd('');
      setIsTrimPreviewing(false);
      setVideoReloadKey((key) => key + 1);
      await onRefreshPartsStatus();
    } catch (err: any) {
      showToast(`❌ Lỗi cắt video: ${err.message}`);
    } finally {
      setIsTrimming(false);
    }
  };

  const handleRestoreOriginal = async () => {
    if (!window.confirm(`Khôi phục video gốc của Part ${partNum} trước khi cắt?`)) return;

    setIsRestoring(true);
    try {
      const res = await fetch('/api/pipeline/restore-part-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim() || 'scene',
          scene_index: partNum - 1,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không có backup để khôi phục');

      showToast(`↩️ Đã khôi phục video gốc của Part ${partNum}.`);
      setVideoDuration(0);
      setTrimStart('0');
      setTrimEnd('');
      setIsTrimPreviewing(false);
      setVideoReloadKey((key) => key + 1);
      await onRefreshPartsStatus();
    } catch (err: any) {
      showToast(`❌ Khôi phục thất bại: ${err.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="modal-overlay open" style={{ zIndex: 10010 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '1040px',
          width: '94vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '18px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', lineHeight: 1.25 }}>Chỉnh sửa video · Part {partNum}/6</h2>
            <p style={{ margin: '5px 0 0', fontSize: '12px', color: 'var(--muted)' }}>{productName} · {category}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: '9px', width: '34px', height: '34px', cursor: 'pointer', fontSize: '18px', flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(70px, 1fr))', gap: '7px', marginBottom: '14px' }}>
          {[1, 2, 3, 4, 5, 6].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => onSwitchPart(num)}
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                border: num === partNum ? '1px solid #8b5cf6' : '1px solid var(--border)',
                background: num === partNum ? 'rgba(139,92,246,0.16)' : 'var(--bg3)',
                color: num === partNum ? '#c4b5fd' : 'var(--text)',
                fontSize: '11px',
                fontWeight: num === partNum ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              Part {num}
            </button>
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '12px',
            marginBottom: '12px',
            alignItems: 'start',
          }}
        >
          <div style={cardStyle}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#f472b6', marginBottom: '8px' }}>Ảnh tham chiếu · Part {partNum}</div>
            <div
              style={{ aspectRatio: '16/9', background: '#111', borderRadius: '9px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentImage ? 'zoom-in' : 'default' }}
              onClick={() => currentImage && onOpenLightbox(currentImage, `Ảnh Part ${partNum}`, partNum - 1)}
            >
              {currentImage ? (
                <img src={currentImage} alt={`Part ${partNum}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Chưa có ảnh</span>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#60a5fa', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Video · Part {partNum}</span>
              {currentVideo && <span style={{ color: '#10b981', fontWeight: 600 }}>{videoDuration > 0 ? formatSeconds(videoDuration) : 'Sẵn sàng'}</span>}
            </div>
            <div style={{ aspectRatio: '16/9', background: '#050505', borderRadius: '9px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {currentVideo ? (
                <video
                  key={`${videoReloadKey}:${currentVideo}`}
                  ref={videoRef}
                  src={currentVideo}
                  controls
                  onLoadedMetadata={(e) => {
                    const duration = e.currentTarget.duration || 0;
                    setVideoDuration(duration);
                    setTrimEnd((prev) => {
                      const existing = Number.parseFloat(prev);
                      if (Number.isFinite(existing) && existing > 0) return Math.min(existing, duration).toFixed(2);
                      return duration > 0 ? duration.toFixed(2) : '';
                    });
                  }}
                  onTimeUpdate={(e) => {
                    if (!isTrimPreviewing) return;
                    const end = Number.parseFloat(trimEnd);
                    if (Number.isFinite(end) && e.currentTarget.currentTime >= end - 0.03) {
                      e.currentTarget.pause();
                      setIsTrimPreviewing(false);
                    }
                  }}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Chưa có video</span>
              )}
            </div>
          </div>
        </div>

        {currentVideo && (
          <div style={{ ...cardStyle, marginBottom: '12px', background: 'rgba(59,130,246,0.05)', borderColor: 'rgba(96,165,250,0.26)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Cắt đoạn video</div>
                <div style={{ fontSize: '10.5px', color: 'var(--muted)', marginTop: '2px' }}>Chọn đoạn muốn giữ lại, review trước rồi mới áp dụng.</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '10px', color: 'var(--muted)' }}>Độ dài sau cắt</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#a7f3d0' }}>{selectedDuration > 0 ? formatSeconds(selectedDuration) : '—'}</div>
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ height: '7px', borderRadius: '999px', background: 'var(--bg2)', overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${startPercent}%`,
                    width: `${Math.max(0, endPercent - startPercent)}%`,
                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                    borderRadius: '999px',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '9.5px', color: 'var(--muted)' }}>
                <span>0s</span>
                <span>{videoDuration > 0 ? formatSeconds(videoDuration) : '—'}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '10px', color: 'var(--muted)' }}>Bắt đầu</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px', marginTop: '4px' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.05"
                    value={trimStart}
                    onChange={(e) => {
                      setTrimStart(e.target.value);
                      setIsTrimPreviewing(false);
                    }}
                    style={fieldStyle}
                  />
                  <button type="button" onClick={handleSetStartCurrent} disabled={isTrimming || isRestoring} style={{ padding: '0 11px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: '10.5px', cursor: 'pointer' }}>Lấy playhead</button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '10px', color: 'var(--muted)' }}>Kết thúc</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px', marginTop: '4px' }}>
                  <input
                    type="number"
                    min="0.1"
                    step="0.05"
                    value={trimEnd}
                    onChange={(e) => {
                      setTrimEnd(e.target.value);
                      setIsTrimPreviewing(false);
                    }}
                    style={fieldStyle}
                  />
                  <button type="button" onClick={handleSetEndCurrent} disabled={isTrimming || isRestoring} style={{ padding: '0 11px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: '10.5px', cursor: 'pointer' }}>Lấy playhead</button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', marginRight: '2px' }}>Cắt nhanh:</span>
              {[0.3, 0.6, 1].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => applyPreset(sec)}
                  disabled={videoDuration <= sec || isTrimming || isRestoring}
                  style={{ padding: '5px 9px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: '10px', cursor: 'pointer' }}
                >
                  Bỏ {sec}s đầu
                </button>
              ))}
              <button type="button" onClick={handleResetRange} disabled={isTrimming || isRestoring} style={{ padding: '5px 9px', borderRadius: '6px', border: '1px solid transparent', background: 'transparent', color: 'var(--muted)', fontSize: '10px', cursor: 'pointer' }}>Reset mốc</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginTop: '12px', paddingTop: '11px', borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={handleRestoreOriginal}
                disabled={isTrimming || isRestoring}
                style={{ background: 'transparent', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)', padding: '8px 11px', borderRadius: '7px', fontSize: '11px', fontWeight: 600, cursor: isRestoring ? 'not-allowed' : 'pointer' }}
              >
                {isRestoring ? 'Đang khôi phục...' : 'Khôi phục bản gốc'}
              </button>

              <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginLeft: 'auto' }}>
                <button
                  type="button"
                  onClick={handlePreviewTrim}
                  disabled={isTrimming || isRestoring}
                  style={{ background: 'var(--bg2)', color: '#93c5fd', border: '1px solid rgba(96,165,250,0.35)', padding: '8px 13px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Review đoạn đã chọn
                </button>
                <button
                  type="button"
                  onClick={handleTrimVideo}
                  disabled={isTrimming || isRestoring}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: isTrimming ? 'not-allowed' : 'pointer' }}
                >
                  {isTrimming ? 'Đang cắt...' : 'Áp dụng cắt'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* 2-AI Collaborative Prompt Revision */}
          <div style={{ ...cardStyle, background: 'rgba(124,58,237,0.08)', borderColor: isRevisingPrompts ? '#ec4899' : 'rgba(139,92,246,0.35)', animation: isRevisingPrompts ? 'pulseBorder 2s infinite ease-in-out' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>🤖 2 AI Thảo Luận Phản Biện & Sửa Kịch Bản Part {partNum}</span>
              </div>
              {isRevisingPrompts && (
                <span style={{ fontSize: '10.5px', color: '#f472b6', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ec4899', animation: 'livePulse 0.8s infinite' }} />
                  <span>2 AI đang thảo luận...</span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={aiFeedbackModal}
                disabled={isRevisingPrompts}
                onChange={(e) => setAiFeedbackModal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!aiFeedbackModal.trim()) {
                      showToast(`⚠️ Vui lòng nhập góp ý sửa cho Part ${partNum}!`);
                      return;
                    }
                    onRevisePrompt?.(aiFeedbackModal.trim()).catch((err: any) => {
                      showToast(`❌ Lỗi 2 AI sửa: ${err?.message || err}`);
                    });
                    setAiFeedbackModal('');
                  }
                }}
                placeholder={`Nhập yêu cầu để 2 AI viết lại Part ${partNum} (VD: Đổi góc quay, biểu cảm hài hước... rồi nhấn Enter)`}
                style={{ ...fieldStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  if (!aiFeedbackModal.trim()) {
                    showToast(`⚠️ Vui lòng nhập góp ý sửa cho Part ${partNum}!`);
                    return;
                  }
                  onRevisePrompt?.(aiFeedbackModal.trim()).catch((err: any) => {
                    showToast(`❌ Lỗi 2 AI sửa: ${err?.message || err}`);
                  });
                  setAiFeedbackModal('');
                }}
                disabled={isRevisingPrompts || !aiFeedbackModal.trim()}
                style={{
                  background: isRevisingPrompts ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '8px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: isRevisingPrompts || !aiFeedbackModal.trim() ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexShrink: 0,
                  boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
                }}
              >
                {isRevisingPrompts ? '⏳ Đang sửa...' : '🤖 2 AI Sửa'}
              </button>
            </div>
            {revisingStatusText && isRevisingPrompts && (
              <div style={{ marginTop: '6px', fontSize: '10.5px', color: '#38bdf8' }}>
                {revisingStatusText}
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#c4b5fd' }}>Prompt Part {partNum}</label>
            <textarea rows={5} value={localPrompt} onChange={(e) => setLocalPrompt(e.target.value)} style={{ ...fieldStyle, marginTop: '5px', lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24' }}>Dialogue Part {partNum}</label>
            <textarea rows={2} value={localDialogue} onChange={(e) => setLocalDialogue(e.target.value)} style={{ ...fieldStyle, marginTop: '5px', lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <div style={{ ...cardStyle, background: 'rgba(236,72,153,0.05)', borderColor: 'rgba(236,72,153,0.22)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#f472b6', marginBottom: '8px' }}>Thiết lập vẽ lại ảnh</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Ảnh tham chiếu</span>
              <select value={refSource} onChange={(e) => setRefSource(parseInt(e.target.value, 10))} style={{ ...fieldStyle, width: 'auto', padding: '6px 8px' }}>
                <option value={-1}>Ảnh gốc sản phẩm</option>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n - 1}>Part {n}</option>)}
              </select>
              {originalImageUrl && <span style={{ fontSize: '10px', color: '#10b981' }}>Có ảnh gốc</span>}
            </div>
            <textarea rows={2} value={redrawNotes} onChange={(e) => setRedrawNotes(e.target.value)} placeholder="Ghi chú vẽ lại: đổi góc camera, giữ nguyên nhân vật, tăng biểu cảm..." style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <button type="button" onClick={onStopPipeline} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Dừng pipeline</button>
          <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleSave} disabled={isSaving} style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: isSaving ? 'not-allowed' : 'pointer' }}>{isSaving ? 'Đang lưu...' : 'Lưu prompt'}</button>
            <button type="button" onClick={handleRedraw} disabled={isDrawing} style={{ background: '#db2777', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: isDrawing ? 'not-allowed' : 'pointer' }}>{isDrawing ? 'Đang vẽ...' : 'Vẽ lại ảnh'}</button>
            <button type="button" onClick={handleRenderVideo} disabled={isRendering} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: isRendering ? 'not-allowed' : 'pointer' }}>{isRendering ? 'Đang render...' : 'Render video'}</button>
            <button type="button" onClick={onClose} style={{ background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', cursor: 'pointer' }}>Đóng</button>
          </div>
        </div>
      </div>
    </div>
  );
};
