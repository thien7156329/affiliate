import React, { useState, useEffect } from 'react';
import { StoryboardCard } from './StoryboardCard';
import { useToast } from '../../context/ToastContext';
import { EpisodeDefinition } from '../../types';

interface StoryboardGridProps {
  productName: string;
  promptsObj: Record<string, string>;
  sceneImages: string[];
  sceneUrls: string[];
  drawingParts: boolean[];
  renderingParts: boolean[];
  pipelineStatusText: string;
  isPipelineRunning: boolean;
  episodes?: EpisodeDefinition[];
  batchFeedback?: string;
  onChangeBatchFeedback?: (val: string) => void;
  onBlurBatchFeedback?: (val: string) => void;
  isRevisingPrompts?: boolean;
  revisingStage?: 'ai1' | 'ai2' | 'done' | null;
  revisingElapsedSec?: number;
  revisingStatusText?: string;
  revisingTargetParts?: number[];
  onOpenPartEditor: (partNum: number) => void;
  onRedrawSingleImage: (partNum: number, refSource: number, notes?: string, promptOverride?: string, dialogueOverride?: string) => Promise<boolean | void>;
  onRenderSingleVideo: (partNum: number, promptOverride?: string, dialogueOverride?: string) => Promise<boolean | void>;
  onBatchRevisePrompts: (selectedIndices: number[], feedback: string, attachedImg?: string) => Promise<void>;
  onBatchRenderImages: (selectedIndices: number[], refSource: number, feedback: string) => Promise<void>;
  onBatchRenderVideos: (selectedIndices: number[]) => Promise<void>;
  videoRenderMode?: string;
  onChangeVideoRenderMode?: (mode: any) => void;
  onRunAllFlow: (feedback: string, refSource: number) => Promise<void>;
  onStopPipeline: () => void;
  onZoomImage: (partIndex: number) => void;
  onSavePartPrompt?: (partNum: number, prompt: string, dialogue: string) => Promise<boolean | void>;
  onRevisePartPrompt?: (partNum: number, feedback: string) => Promise<void>;
  expectedSceneCount?: number;
}

export const StoryboardGrid: React.FC<StoryboardGridProps> = ({
  productName,
  promptsObj,
  sceneImages,
  sceneUrls,
  drawingParts,
  renderingParts,
  pipelineStatusText,
  isPipelineRunning,
  episodes = [],
  batchFeedback: batchFeedbackProp,
  onChangeBatchFeedback,
  onBlurBatchFeedback,
  isRevisingPrompts = false,
  revisingStage = null,
  revisingElapsedSec = 0,
  revisingStatusText = '',
  revisingTargetParts = [],
  videoRenderMode = 'browser',
  onChangeVideoRenderMode,
  onOpenPartEditor,
  onRedrawSingleImage,
  onRenderSingleVideo,
  onBatchRevisePrompts,
  onBatchRenderImages,
  onBatchRenderVideos,
  onRunAllFlow,
  onStopPipeline,
  onZoomImage,
  onSavePartPrompt,
  onRevisePartPrompt,
  expectedSceneCount,
}) => {
  const { showToast } = useToast();

  const promptKeys = Object.keys(promptsObj || {}).map(k => {
    const m = k.match(/^prompt(\d+)$/i);
    return m ? parseInt(m[1], 10) : 0;
  }).filter(n => n > 0);
  const maxPart = promptKeys.length > 0
    ? Math.max(...promptKeys)
    : (expectedSceneCount || 8);
  const partNumbers = Array.from({ length: maxPart }, (_, i) => i + 1);

  const [selectedParts, setSelectedParts] = useState<boolean[]>(() => new Array(maxPart).fill(false));
  const [batchRefSource, setBatchRefSource] = useState<number>(-99);
  const [localBatchFeedback, setLocalBatchFeedback] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedParts(prev => {
      if (prev.length !== maxPart) {
        const next = new Array(maxPart).fill(false);
        for (let i = 0; i < Math.min(prev.length, maxPart); i++) {
          next[i] = prev[i];
        }
        return next;
      }
      return prev;
    });
  }, [maxPart]);

  const batchFeedback = batchFeedbackProp !== undefined ? batchFeedbackProp : localBatchFeedback;
  const handleBatchFeedbackChange = (val: string) => {
    if (onChangeBatchFeedback) {
      onChangeBatchFeedback(val);
    } else {
      setLocalBatchFeedback(val);
    }
  };

  useEffect(() => {
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
  }, [showToast]);

  const handleTogglePart = (partNum: number) => {
    const idx = partNum - 1;
    setSelectedParts((prev) => {
      const copy = [...prev];
      copy[idx] = !copy[idx];
      return copy;
    });
  };

  const handleSelectAll = (select: boolean) => {
    setSelectedParts(new Array(maxPart).fill(select));
  };

  const getSelectedIndices = () => {
    return selectedParts
      .map((selected, idx) => (selected ? idx : -1))
      .filter((idx) => idx !== -1);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setAttachedImage(base64);
      showToast('📎 Đã đính kèm ảnh minh họa lỗi!');
    };
    reader.readAsDataURL(file);
  };

  const triggerReviseClick = () => {
    const indices = getSelectedIndices();
    if (indices.length === 0) {
      showToast('⚠️ Vui lòng tick chọn ít nhất 1 Part cần sửa (VD: Part 3, Part 6)!');
      return;
    }
    if (!batchFeedback.trim() && !attachedImage) {
      showToast('⚠️ Vui lòng nhập nội dung chỉ đạo/góp ý hoặc đính kèm ảnh để AI biết cần sửa những gì!');
      return;
    }
    onBatchRevisePrompts(indices, batchFeedback.trim(), attachedImage || undefined);
  };

  const triggerRenderImagesClick = () => {
    const indices = getSelectedIndices();
    if (indices.length === 0) {
      showToast('⚠️ Vui lòng tick chọn ít nhất 1 Part để vẽ lại ảnh!');
      return;
    }
    onBatchRenderImages(indices, batchRefSource, batchFeedback.trim());
  };

  const triggerRenderVideosClick = () => {
    const indices = getSelectedIndices();
    if (indices.length === 0) {
      showToast('⚠️ Vui lòng tick chọn ít nhất 1 Part để render video!');
      return;
    }
    onBatchRenderVideos(indices);
  };

  const formatTimer = (sec: number = 0) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}s`;
  };

  return (
    <div id="storyboardGridContainer" style={{ marginTop: '6px' }}>
      <div style={{ background: 'var(--bg2)', border: isRevisingPrompts ? '1px solid rgba(236,72,153,0.5)' : '1px solid rgba(139,92,246,0.35)', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: isRevisingPrompts ? '0 0 16px rgba(236,72,153,0.2)' : 'none', transition: 'all 0.3s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '5px' }}><span>🤖 Trợ Lý Sửa Part Theo Yêu Cầu (Chọn Part & Ra Lệnh)</span></div>
          <span id="storyboardStatusBadge" style={{ fontSize: '11px', color: isRevisingPrompts ? '#ec4899' : isPipelineRunning ? '#38bdf8' : '#10b981', background: isRevisingPrompts ? 'rgba(236,72,153,0.18)' : isPipelineRunning ? 'rgba(56,189,248,0.15)' : 'rgba(16,185,129,0.15)', border: isRevisingPrompts ? '1px solid rgba(236,72,153,0.4)' : '1px solid transparent', padding: '2px 8px', borderRadius: '10px', fontWeight: isRevisingPrompts ? 700 : 500, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            {isRevisingPrompts ? <><span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ec4899', animation: 'livePulse 1s infinite', display: 'inline-block' }} /><span>🔄 2 AI Đang Thảo Luận • ⏱️ {formatTimer(revisingElapsedSec)}</span></> : (pipelineStatusText || 'Sẵn sàng')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px' }}>
          <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Chọn Part ({partNumbers.length} Cảnh):</span>
          {partNumbers.map((num) => <label key={num} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', cursor: 'pointer', background: 'var(--bg3)', padding: '3px 8px', borderRadius: '6px', border: '1px solid var(--border)' }}><input type="checkbox" className="part-select-chk" checked={selectedParts[num - 1] ?? false} onChange={() => handleTogglePart(num)} style={{ accentColor: '#8b5cf6' }} /><span>Part {num}</span></label>)}
          <button type="button" onClick={() => handleSelectAll(true)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}>Chọn tất cả</button>
          <button type="button" onClick={() => handleSelectAll(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}>Bỏ chọn</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', background: 'var(--bg3)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ color: '#f472b6', fontWeight: 700 }}>🎯 Ảnh Mẫu Chuẩn Cho Bot:</span><select id="selectBatchRefSource" value={batchRefSource} onChange={(e) => setBatchRefSource(parseInt(e.target.value, 10))} style={{ background: 'var(--bg2)', border: '1px solid rgba(244,114,182,0.35)', color: 'var(--text)', padding: '3px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, outline: 'none', cursor: 'pointer' }}><option value={-99}>⚡ Tự động (Part 1 / Ảnh Gốc)</option><option value={-1}>🖼️ Ảnh Gốc Sản Phẩm</option>{partNumbers.map(n => <option key={n} value={n - 1}>🎬 Part {n} (Cảnh {n})</option>)}</select></div>
            <span style={{ color: 'var(--muted)', fontSize: '10.5px' }}>(Bot sẽ nhân bản 100% nhân vật từ Part mẫu đã chọn)</span>
          </div>
          <textarea id="inputPartReviseFeedback" rows={2} value={batchFeedback} onChange={(e) => handleBatchFeedbackChange(e.target.value)} onBlur={(e) => onBlurBatchFeedback?.(e.target.value)} placeholder="💬 Nhập yêu cầu chỉnh sửa / Note vẽ lại hoặc DÁN ẢNH (Ctrl+V)... (VD: Lấy mẫu nhân vật từ Part 2 để vẽ lại Part 1; cho nhảy múa vui nhộn và quay cận cảnh sản phẩm...)" style={{ width: '100%', padding: '7px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', outline: 'none', resize: 'vertical', minHeight: '42px', fontFamily: 'inherit', lineHeight: 1.4, boxSizing: 'border-box' }} />
          {attachedImage && <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px dashed rgba(124,58,237,0.45)', borderRadius: '8px', padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}><img src={attachedImage} alt="Attached preview" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0 }} /><div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#c084fc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📸 Đã đính kèm ảnh minh họa lỗi cho AI</span><span style={{ fontSize: '10px', color: 'var(--muted)' }}>AI sẽ phân tích trực tiếp ảnh này</span></div></div><button type="button" onClick={() => setAttachedImage(null)} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>&times; Xóa</button></div>}
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}><label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10.5px', color: '#a78bfa', cursor: 'pointer', background: 'rgba(124,58,237,0.12)', padding: '4px 8px', borderRadius: '5px', border: '1px solid rgba(124,58,237,0.3)', fontWeight: 600 }} title="Bấm để chọn file ảnh hoặc nhấn Ctrl+V / Cmd+V vào ô trên"><span>📎 Dán (Ctrl+V) / Chọn Ảnh Minh Họa Lỗi</span><input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} /></label></div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', background: 'var(--bg3)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#ec4899', background: 'rgba(236,72,153,0.12)', border: '1px solid rgba(236,72,153,0.3)', padding: '3px 8px', borderRadius: '6px' }}>
              🎨 Vẽ ảnh: <b>Trình duyệt (Gemini Web • Imagen 3 sắc nét)</b>
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#3b82f6', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', padding: '3px 8px', borderRadius: '6px' }}>
              🎬 Tạo Video: <b>Trình duyệt Chrome (Gemini Web • Veo 3 Miễn Phí)</b>
            </span>
          </div>
          <span style={{ fontSize: '10.5px', color: '#60a5fa', fontWeight: 600 }}>
            ✓ Tự động hóa qua Chrome & Gemini Web (100% Miễn Phí)
          </span>
        </div>

        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={triggerReviseClick} disabled={isPipelineRunning || isRevisingPrompts} id="btnBatchRevisePrompt" style={{ background: isRevisingPrompts ? 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)' : '#6d28d9', color: '#fff', border: isRevisingPrompts ? '1px solid #f472b6' : 'none', padding: isRevisingPrompts ? '6px 13px' : '6px 11px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: isPipelineRunning || isRevisingPrompts ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', boxShadow: isRevisingPrompts ? '0 0 12px rgba(236,72,153,0.45)' : 'none', transition: 'all 0.25s ease' }}>{isRevisingPrompts ? <><span style={{ display: 'inline-block', width: '11px', height: '11px', border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /><span>⏳ 2 AI Đang Thảo Luận... ({formatTimer(revisingElapsedSec)})</span></> : <>🤖 AI Sửa Kịch Bản</>}</button>
          <button type="button" onClick={triggerRenderImagesClick} disabled={isPipelineRunning} id="btnBatchRenderImages" style={{ background: '#db2777', color: '#fff', border: 'none', padding: '6px 11px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: isPipelineRunning ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>🎨 Vẽ lại Ảnh</button>
          <button type="button" onClick={triggerRenderVideosClick} disabled={isPipelineRunning} id="btnBatchRenderVideos" style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 11px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: isPipelineRunning ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            🌐 Render lại Video (Trình duyệt)
          </button>
          <button type="button" onClick={() => onRunAllFlow(batchFeedback, batchRefSource)} disabled={isPipelineRunning} id="btnBatchFullPipeline" style={{ background: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '7px', fontSize: '11.5px', fontWeight: 700, cursor: isPipelineRunning ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', boxShadow: '0 2px 8px rgba(139,92,246,0.35)' }}>🚀 Run All Flow Tạo Video (Full {partNumbers.length} Part)</button>
          {isPipelineRunning && <button type="button" onClick={onStopPipeline} id="btnBatchStopPipeline" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.45)', color: '#f87171', padding: '6px 12px', borderRadius: '7px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Dừng ngay lập tức quy trình đang chạy">⛔ Dừng Quy Trình</button>}
        </div>

        {(isRevisingPrompts || (revisingStatusText && revisingStage === 'done')) && <div id="liveAiRevisionBanner" style={{ marginTop: '4px', padding: '10px 14px', borderRadius: '8px', background: isRevisingPrompts ? 'linear-gradient(135deg, rgba(124,58,237,0.14) 0%, rgba(236,72,153,0.16) 100%)' : 'rgba(16,185,129,0.12)', border: isRevisingPrompts ? '1px solid rgba(236,72,153,0.45)' : '1px solid rgba(16,185,129,0.35)', display: 'flex', flexDirection: 'column', gap: '8px', animation: isRevisingPrompts ? 'pulseBorder 2.5s infinite ease-in-out' : 'none', boxShadow: isRevisingPrompts ? '0 0 16px rgba(236,72,153,0.18)' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '9px', height: '9px', borderRadius: '50%', background: isRevisingPrompts ? (revisingStage === 'ai2' ? '#f59e0b' : '#ec4899') : '#10b981', animation: isRevisingPrompts ? 'livePulse 1s infinite' : 'none', display: 'inline-block', flexShrink: 0 }} /><span style={{ fontSize: '12px', fontWeight: 700, color: isRevisingPrompts ? '#f472b6' : '#10b981' }}>{isRevisingPrompts ? `🔥 2 AI Đang Trực Tiếp Thảo Luận Kịch Bản (Part ${revisingTargetParts.map(p => p + 1).join(', ')})` : '🎉 2 AI Đã Thống Nhất Kịch Bản Hoàn Tất!'}</span></div><div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--bg3)', border: isRevisingPrompts ? '1px solid rgba(236,72,153,0.4)' : '1px solid var(--border)', borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: 700, color: isRevisingPrompts ? '#38bdf8' : '#10b981' }}><span>⏱️ Thời gian tương tác:</span><span style={{ fontFamily: 'monospace', fontSize: '12.5px', color: isRevisingPrompts ? '#f472b6' : '#10b981' }}>{formatTimer(revisingElapsedSec)}</span></div></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}><div style={{ flex: 1, minWidth: '160px', background: 'var(--bg2)', border: revisingStage === 'ai1' ? '1.5px solid #a855f7' : '1px solid var(--border)', borderRadius: '7px', padding: '7px 11px', boxShadow: revisingStage === 'ai1' ? '0 0 12px rgba(168,85,247,0.35)' : 'none', transition: 'all 0.3s ease' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#c084fc' }}>🎭 AI 1 (Codex Sol Light)</span>{revisingStage === 'ai1' && <span style={{ fontSize: '9px', background: '#a855f7', color: '#fff', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>ĐANG SÁNG TÁC</span>}{revisingStage === 'ai2' && <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>✓ Đã cập nhật</span>}{revisingStage === 'done' && <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>✓ Hoàn tất</span>}</div><div style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Tái cấu trúc prompt theo yêu cầu Đạo diễn</div></div><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '0 6px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '18px' }}>{[0,1,2,3,4].map((bar) => <span key={bar} style={{ width: '3.5px', background: isRevisingPrompts ? 'linear-gradient(to top, #8b5cf6, #ec4899)' : '#10b981', borderRadius: '2px', height: isRevisingPrompts ? '16px' : '6px', animation: isRevisingPrompts ? `soundWave 0.8s ease-in-out infinite alternate ${bar * 0.15}s` : 'none' }} />)}</div><span style={{ fontSize: '9.5px', fontWeight: 700, color: isRevisingPrompts ? '#f472b6' : 'var(--muted)' }}>{isRevisingPrompts ? '⚡ Phản biện qua lại' : '✓ Đã đồng thuận'}</span></div><div style={{ flex: 1, minWidth: '160px', background: 'var(--bg2)', border: revisingStage === 'ai2' ? '1.5px solid #f59e0b' : '1px solid var(--border)', borderRadius: '7px', padding: '7px 11px', boxShadow: revisingStage === 'ai2' ? '0 0 12px rgba(245,158,11,0.35)' : 'none', transition: 'all 0.3s ease' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}><span style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24' }}>🧐 AI 2 (Gemini 3.8 Low)</span>{revisingStage === 'ai2' && <span style={{ fontSize: '9px', background: '#f59e0b', color: '#000', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>ĐANG KIỂM ĐỊNH</span>}{revisingStage === 'done' && <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>✓ Đạt 100%</span>}</div><div style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Thẩm định tính logic & góc quay nhất quán</div></div></div>
          <div style={{ fontSize: '11.5px', color: isRevisingPrompts ? 'var(--text)' : '#10b981', background: 'var(--bg3)', padding: '6px 11px', borderRadius: '6px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '7px' }}><span>💬</span><span style={{ flex: 1, fontWeight: 500 }}>{revisingStatusText || '2 AI đang kết nối và phân tích kịch bản...'}</span></div>
        </div>}
      </div>

      <div id="storyboardGrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        {partNumbers.map((partNum) => {
          const idx = partNum - 1;
          const prompt = promptsObj[`prompt${partNum}`] || (partNum === 1 ? promptsObj.prompt : '') || '';
          const dialogue = promptsObj[`dialogue${partNum}`] || '';
          const imgUrl = sceneImages[idx] || null;
          const vidUrl = sceneUrls[idx] || null;
          const epCut = (episodes || []).find((e) => Number(e.endScene) === partNum && partNum < partNumbers.length);
          return (
            <React.Fragment key={partNum}>
              <StoryboardCard
                partNum={partNum}
                prompt={prompt}
                dialogue={dialogue}
                imageUrl={imgUrl}
                videoUrl={vidUrl}
                isSelected={selectedParts[idx]}
                isDrawing={drawingParts[idx]}
                isRendering={renderingParts[idx]}
                isRevising={isRevisingPrompts && (revisingTargetParts || []).includes(idx)}
                onToggleSelect={handleTogglePart}
                onOpenEditor={() => onOpenPartEditor(partNum)}
                onRedrawImage={() => {
                  const customRef = batchRefSource === -99 ? (idx === 0 ? -1 : 0) : batchRefSource;
                  onRedrawSingleImage(partNum, customRef, batchFeedback);
                }}
                onRenderVideo={() => onRenderSingleVideo(partNum)}
                onZoomImage={() => onZoomImage(idx)}
              />
              {epCut && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    margin: '8px 0',
                    padding: '8px 14px',
                    background: 'linear-gradient(90deg, rgba(236,72,153,0.12) 0%, rgba(139,92,246,0.12) 100%)',
                    border: '1.5px dashed rgba(236,72,153,0.45)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ flex: 1, height: '1px', background: 'rgba(236,72,153,0.35)' }} />
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#f472b6', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ✂️ HẾT {epCut.title ? epCut.title.toUpperCase() : `TẬP`} (Scene 1..{epCut.endScene}) • ĐIỂM NGẮT SHORTS
                  </span>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(236,72,153,0.35)' }} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
