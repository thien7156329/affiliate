import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ProductCategory } from '../../types';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { getDisplayImageUrl } from '../../utils/image';

export interface PartVideoVersion {
  filename: string;
  url: string;
  duration_sec: number;
  mtimeMs: number;
  size_bytes: number;
  size_mb: string;
  created_at: string;
  is_active: boolean;
  is_trimmed: boolean;
}

interface PartEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  partNum: number;
  expectedSceneCount?: number;
  productName: string;
  productDescription?: string;
  category: ProductCategory;
  originalImageUrl: string;
  promptsObj: Record<string, string>;
  sceneImages: string[];
  sceneUrls: string[];
  onSwitchPart: (partNum: number) => void;
  onSavePartPrompt: (partNum: number, prompt: string, dialogue: string, extraFields?: Record<string, string>) => Promise<boolean>;
  onRedrawSingleImage: (partNum: number, refSource: number, notes?: string, promptOverride?: string, dialogueOverride?: string) => Promise<boolean | void>;
  onRenderSingleVideo: (
    partNum: number,
    promptOverride?: string,
    dialogueOverride?: string,
    optionsOverride?: {
      includePrevFrame?: boolean | string;
      prevFrameParts?: number[];
      refImagesMode?: string;
    }
  ) => Promise<boolean | void>;
  includePrevFrame?: boolean | string;
  refImagesMode?: string;
  visualStyle?: 'real' | '3d' | 'stickman';
  onChangeVisualStyle?: (mode: 'real' | '3d' | 'stickman') => void;
  onStopPipeline: () => void;
  onOpenLightbox: (imageUrl: string, title: string, partIndex: number) => void;
  onRefreshPartsStatus: () => Promise<void>;
  onRevisePrompt?: (feedback: string) => Promise<void>;
  isRevisingPrompts?: boolean;
  revisingStatusText?: string;
  otherPartRevisingNotice?: string;
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
  expectedSceneCount,
  productName,
  productDescription,
  category,
  originalImageUrl,
  promptsObj,
  sceneImages,
  sceneUrls,
  onSwitchPart,
  onSavePartPrompt,
  onRedrawSingleImage,
  onRenderSingleVideo,
  includePrevFrame: initialIncludePrevFrame = true,
  refImagesMode: initialRefImagesMode = 'all',
  visualStyle = 'real',
  onChangeVisualStyle,
  onStopPipeline,
  onOpenLightbox,
  onRefreshPartsStatus,
  onRevisePrompt,
  isRevisingPrompts = false,
  revisingStatusText = '',
  otherPartRevisingNotice,
}) => {
  const { showToast } = useToast();
  const { confirmDialog } = useConfirm();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [localPrompt, setLocalPrompt] = useState('');
  const [localDialogue, setLocalDialogue] = useState('');
  const [aiFeedbackModal, setAiFeedbackModal] = useState('');
  const [refSource, setRefSource] = useState<number>(partNum === 1 ? -1 : partNum - 2);
  const [redrawNotes, setRedrawNotes] = useState('');
  const [localPrevFrameChoice, setLocalPrevFrameChoice] = useState<string>(
    typeof initialIncludePrevFrame === 'string'
      ? initialIncludePrevFrame
      : initialIncludePrevFrame !== false
        ? 'yes'
        : 'no'
  );
  const [selectedPrevVideoParts, setSelectedPrevVideoParts] = useState<number[]>([]);
  const [localRefImagesMode, setLocalRefImagesMode] = useState<string>(initialRefImagesMode);
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
  const isSavingRef = useRef(false);
  const isDrawingRef = useRef(false);
  const isRenderingRef = useRef(false);
  const activePartNumRef = useRef(partNum);
  activePartNumRef.current = partNum;

  // Video Versions state
  const [versions, setVersions] = useState<PartVideoVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [previewVersionUrl, setPreviewVersionUrl] = useState<string | null>(null);
  const [isSettingActive, setIsSettingActive] = useState<string | null>(null);
  const [isDeletingVersion, setIsDeletingVersion] = useState<string | null>(null);

  // AI Agent Argon 4.0 Video Fixer state
  const [videoFixInstruction, setVideoFixInstruction] = useState('');
  const [isFixingVideoWithAi, setIsFixingVideoWithAi] = useState(false);
  const [fixFromOriginalBackup, setFixFromOriginalBackup] = useState(false);
  const [lastAiVideoFixReport, setLastAiVideoFixReport] = useState<{
    analysis: string;
    revisedPrompt?: string;
    revisedDialogue?: string;
  } | null>(null);

  const [partImageUrl, setPartImageUrl] = useState<string | null>(null);

  const promptKeys = Object.keys(promptsObj || {}).map(k => {
    const m = k.match(/^prompt(\d+)$/i);
    return m ? parseInt(m[1], 10) : 0;
  }).filter(n => n > 0);
  const totalParts = expectedSceneCount
    ? Math.max(expectedSceneCount, partNum)
    : (promptKeys.length > 0 ? Math.max(...promptKeys, partNum) : Math.max(partNum, 4));
  const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

  const activeVersion = versions.find((v) => v.is_active) || versions[0];
  const currentImage = sceneImages[partNum - 1] || partImageUrl;
  const currentVideo = activeVersion?.url || sceneUrls[partNum - 1];
  const displayedVideo = previewVersionUrl || currentVideo;
  const displayedVideoClean = displayedVideo ? displayedVideo.split('?')[0] : '';
  const videoBaseKey = displayedVideoClean || 'novideo';

  const fetchPartVersions = useCallback(async () => {
    if (!productName || !isOpen) return;
    setIsLoadingVersions(true);
    try {
      const res = await fetch(
        `/api/pipeline/part-versions?product_name=${encodeURIComponent(productName.trim())}&scene_index=${partNum - 1}&_t=${Date.now()}`
      );
      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.versions)) {
          setVersions(data.versions);
        }
        if (data.image_url) {
          setPartImageUrl(data.image_url);
        }
      }
    } catch (err) {
      console.warn('fetchPartVersions error:', err);
    } finally {
      setIsLoadingVersions(false);
    }
  }, [productName, partNum, isOpen]);

  const handleSetActiveVersion = async (v: PartVideoVersion) => {
    setIsSettingActive(v.filename);
    try {
      const res = await fetch('/api/pipeline/set-active-part-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim() || 'scene',
          scene_index: partNum - 1,
          filename: v.filename,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể đổi video chính');
      showToast(`⭐ Đã chọn ${v.filename} làm video chính của Part ${partNum}!`);
      setPreviewVersionUrl(null);
      setVideoDuration(v.duration_sec || 0);
      setTrimStart('0');
      setTrimEnd(v.duration_sec ? v.duration_sec.toFixed(2) : '');
      setIsTrimPreviewing(false);
      setVideoReloadKey((k) => k + 1);
      await onRefreshPartsStatus();
      await fetchPartVersions();
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsSettingActive(null);
    }
  };

  const handleDeleteVersion = async (v: PartVideoVersion) => {
    const ok = await confirmDialog({
      title: `Xóa video ${v.filename}?`,
      message: `Bạn có chắc muốn xóa vĩnh viễn phiên bản video này (${v.duration_sec.toFixed(1)}s, ${v.size_mb} MB)? Hành động này không thể hoàn tác.`,
      confirmText: 'Xác nhận xóa',
      cancelText: 'Hủy',
      type: 'danger',
    });
    if (!ok) return;

    setIsDeletingVersion(v.filename);
    try {
      const res = await fetch('/api/pipeline/delete-part-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim() || 'scene',
          scene_index: partNum - 1,
          filename: v.filename,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Xóa thất bại');
      showToast(`🗑️ Đã xóa phiên bản ${v.filename}`);
      if (previewVersionUrl === v.url || v.is_active || (previewVersionUrl && previewVersionUrl.includes(v.filename))) {
        setPreviewVersionUrl(null);
      }
      await onRefreshPartsStatus();
      await fetchPartVersions();
      setVideoReloadKey((k) => k + 1);
    } catch (err: any) {
      showToast(`❌ Lỗi xóa video: ${err.message}`);
    } finally {
      setIsDeletingVersion(null);
    }
  };

  // Synchronize prompt & dialogue whenever promptsObj or partNum changes
  useEffect(() => {
    if (!isOpen) return;
    const p =
      promptsObj[`prompt${partNum}`] ||
      promptsObj[`prompt_${partNum}`] ||
      promptsObj[`scene${partNum}`] ||
      (partNum === 1 ? promptsObj.prompt : '') ||
      '';
    const d =
      promptsObj[`dialogue${partNum}`] ||
      promptsObj[`dialogue_${partNum}`] ||
      promptsObj[`dialog_${partNum}`] ||
      '';
    setLocalPrompt(p);
    setLocalDialogue(d);
  }, [isOpen, partNum, promptsObj]);

  // Reset video player and version states on switch
  useEffect(() => {
    if (!isOpen) return;
    setRefSource(partNum === 1 ? -1 : partNum - 2);
    setRedrawNotes('');
    setAiFeedbackModal('');
    setTrimStart('0');
    setTrimEnd('');
    setVideoDuration(0);
    setIsTrimPreviewing(false);
    setPreviewVersionUrl(null);
    setVideoFixInstruction('');
    setLastAiVideoFixReport(null);
    setFixFromOriginalBackup(false);
    if (!sceneImages[partNum - 1]) {
      setPartImageUrl(null);
    }
    setVideoReloadKey(0);
    fetchPartVersions();
  }, [isOpen, partNum, fetchPartVersions]);

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
    if (start <= 0.01 && videoDuration > 0 && end >= videoDuration - 0.05) {
      showToast('⚠️ Bạn chưa chọn đoạn cần cắt (mốc chọn đang bằng 100% video). Hãy kéo mốc bắt đầu/kết thúc hoặc bấm "Bỏ 0.3s/0.6s/1s đầu".');
      return null;
    }

    return { start, end };
  };

  const handleSave = async () => {
    if (isSavingRef.current || isSaving || isRendering || isDrawing) return;
    const targetPartNum = partNum;
    const snapshotPrompt = localPrompt;
    const snapshotDialogue = localDialogue;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      const ok = await onSavePartPrompt(targetPartNum, snapshotPrompt, snapshotDialogue);
      if (ok) showToast(`💾 Đã lưu kịch bản Part ${targetPartNum}!`);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleRedraw = async () => {
    if (isDrawingRef.current || isDrawing || isRendering || isSaving) return;
    const targetPartNum = partNum;
    const snapshotPrompt = localPrompt;
    const snapshotDialogue = localDialogue;
    isDrawingRef.current = true;
    setIsDrawing(true);
    try {
      await onRedrawSingleImage(targetPartNum, refSource, redrawNotes, snapshotPrompt, snapshotDialogue);
      await onRefreshPartsStatus();
      await fetchPartVersions();
    } finally {
      isDrawingRef.current = false;
      setIsDrawing(false);
    }
  };

  const handleRenderVideo = async () => {
    if (isRenderingRef.current || isRendering || isDrawing || isSaving) return;
    const targetPartNum = partNum;
    const snapshotPrompt = localPrompt;
    const snapshotDialogue = localDialogue;
    isRenderingRef.current = true;
    setIsRendering(true);
    try {
      await onRenderSingleVideo(targetPartNum, snapshotPrompt, snapshotDialogue, {
        includePrevFrame: localPrevFrameChoice === 'no' ? false : localPrevFrameChoice,
        prevFrameParts: localPrevFrameChoice === 'custom_parts' ? selectedPrevVideoParts : undefined,
        refImagesMode: localRefImagesMode,
      });
      await onRefreshPartsStatus();
      await fetchPartVersions();
    } finally {
      isRenderingRef.current = false;
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
    if (!displayedVideo) return;
    const range = readTrimRange();
    if (!range) return;

    const ok = await confirmDialog({
      title: `Cắt Video Part ${partNum}`,
      message: `Cắt Part ${partNum}, chỉ giữ đoạn ${formatSeconds(range.start)} → ${formatSeconds(range.end)} (độ dài khoảng ${formatSeconds(range.end - range.start)})? Hệ thống sẽ lưu bản backup để bạn có thể khôi phục lại bất kỳ lúc nào.`,
      confirmText: 'Tiến hành cắt',
      cancelText: 'Hủy bỏ',
      type: 'warning',
    });
    if (!ok) return;

    setIsTrimming(true);
    try {
      showToast(`✂️ Đang cắt Part ${partNum}: ${formatSeconds(range.start)} → ${formatSeconds(range.end)}...`);
      const res = await fetch('/api/pipeline/trim-part-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim() || 'scene',
          scene_index: partNum - 1,
          video_url: displayedVideo || undefined,
          start_sec: range.start,
          end_sec: range.end,
          from_original: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Cắt video thất bại');

      showToast(`🎉 Đã cắt Part ${partNum}. Thời lượng mới: ${formatSeconds(data.duration_sec)}`);
      setVideoDuration(data.duration_sec || 0);
      setTrimStart('0');
      setTrimEnd(data.duration_sec ? data.duration_sec.toFixed(2) : '');
      setIsTrimPreviewing(false);
      if (data.video_url) {
        setPreviewVersionUrl(data.video_url);
      }
      setVideoReloadKey((key) => key + 1);
      await onRefreshPartsStatus();
      await fetchPartVersions();
    } catch (err: any) {
      showToast(`❌ Lỗi cắt video: ${err.message}`);
    } finally {
      setIsTrimming(false);
    }
  };

  const handleRestoreOriginal = async () => {
    const ok = await confirmDialog({
      title: `Khôi phục video gốc Part ${partNum}`,
      message: `Khôi phục lại video gốc của Part ${partNum} trước khi cắt? Video đã cắt hiện tại sẽ được thay bằng bản gốc đầy đủ.`,
      confirmText: 'Khôi phục ngay',
      cancelText: 'Hủy bỏ',
      type: 'warning',
    });
    if (!ok) return;

    setIsRestoring(true);
    try {
      const res = await fetch('/api/pipeline/restore-part-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim() || 'scene',
          scene_index: partNum - 1,
          video_url: displayedVideo || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không có backup để khôi phục');

      showToast(`↩️ Đã khôi phục video gốc của Part ${partNum}. Thời lượng: ${formatSeconds(data.duration_sec)}`);
      setVideoDuration(data.duration_sec || 0);
      setTrimStart('0');
      setTrimEnd(data.duration_sec ? data.duration_sec.toFixed(2) : '');
      setIsTrimPreviewing(false);
      if (data.video_url) {
        setPreviewVersionUrl(data.video_url);
      }
      setVideoReloadKey((key) => key + 1);
      await onRefreshPartsStatus();
      await fetchPartVersions();
    } catch (err: any) {
      showToast(`❌ Khôi phục thất bại: ${err.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleArgonFixVideo = async () => {
    if (!displayedVideo) return;
    if (!videoFixInstruction.trim()) {
      showToast(`⚠️ Vui lòng nhập nội dung cần sửa cho video Part ${partNum}!`);
      return;
    }

    const targetPartNum = partNum;
    const snapshotPrompt = localPrompt;
    const snapshotDialogue = localDialogue;
    setIsFixingVideoWithAi(true);
    setLastAiVideoFixReport(null);
    try {
      showToast(`🤖 AI Agent Argon 4.0 đang kiểm tra đoạn lỗi, cắt giữ đoạn tốt, tự render Veo 3 đoạn thay thế & ghép vào bản mới cho Part ${targetPartNum}...`);
      const res = await fetch('/api/pipeline/ai-fix-part-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim() || 'scene',
          scene_index: targetPartNum - 1,
          video_url: displayedVideo || undefined,
          instruction: videoFixInstruction.trim(),
          current_prompt: snapshotPrompt,
          current_dialogue: snapshotDialogue,
          from_original: fixFromOriginalBackup,
          visual_style: visualStyle,
          image_url: currentImage || originalImageUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'AI Agent Argon 4.0 xử lý thất bại');

      showToast(`✅ AI Argon 4.0 đã cắt ghép & tạo bản mới (${formatSeconds(data.duration_sec)}) đặt làm ★ Video chính! Bản cũ vẫn giữ nguyên bên trên.`);
      let nextP = snapshotPrompt;
      let nextD = snapshotDialogue;
      let promptOrDialogueChanged = false;
      if (data.revised_veo_prompt && data.revised_veo_prompt.trim().length > 15) {
        nextP = data.revised_veo_prompt.trim();
        if (activePartNumRef.current === targetPartNum) setLocalPrompt(nextP);
        promptOrDialogueChanged = true;
      }
      if (data.revised_dialogue && data.revised_dialogue.trim().length > 2) {
        nextD = data.revised_dialogue.trim();
        if (activePartNumRef.current === targetPartNum) setLocalDialogue(nextD);
        promptOrDialogueChanged = true;
      }
      if (activePartNumRef.current === targetPartNum) {
        setLastAiVideoFixReport({
          analysis: data.analysis || `Đã tạo phiên bản sửa mới (${data.filename}) và đặt làm ★ Video chính cho Part ${targetPartNum}.`,
          revisedPrompt: data.revised_veo_prompt,
          revisedDialogue: data.revised_dialogue,
        });
      }
      if (promptOrDialogueChanged) {
        try {
          await onSavePartPrompt(targetPartNum, nextP, nextD);
        } catch {}
      }
      if (activePartNumRef.current === targetPartNum) {
        setVideoDuration(data.duration_sec || 0);
        setTrimStart('0');
        setTrimEnd(data.duration_sec ? data.duration_sec.toFixed(2) : '');
        setIsTrimPreviewing(false);
        setPreviewVersionUrl(null);
        setVideoReloadKey((key) => key + 1);
      }
      await onRefreshPartsStatus();
      await fetchPartVersions();
    } catch (err: any) {
      showToast(`❌ Lỗi AI Argon 4.0 sửa video: ${err.message}`);
    } finally {
      setIsFixingVideoWithAi(false);
    }
  };

  const handleArgonRerenderAndReplace = async () => {
    if (!videoFixInstruction.trim()) {
      showToast(`⚠️ Vui lòng nhập nội dung lỗi cần sửa cho video Part ${partNum}!`);
      return;
    }
    if (isRenderingRef.current || isRendering || isFixingVideoWithAi) return;

    const targetPartNum = partNum;
    const snapshotPrompt = localPrompt;
    const snapshotDialogue = localDialogue;
    setIsFixingVideoWithAi(true);
    try {
      showToast(`🤖 AI Argon 4.0 đang phân tích lỗi video Part ${targetPartNum} để viết lại Prompt & Render bản mới...`);
      let nextPrompt = snapshotPrompt;
      let nextDialogue = snapshotDialogue;
      let extraUpdatedFields: Record<string, string> | undefined;

      // 1. Revise the Part's prompt & dialogue with full CHARACTER_BIBLE and DUB_TIMELINE optimization
      try {
        const res = await fetch('/api/prompts/revise-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_name: productName.trim() || 'scene',
            product_description: productDescription?.trim() || undefined,
            category,
            prompts_obj: {
              ...promptsObj,
              [`prompt${targetPartNum}`]: snapshotPrompt,
              [`dialogue${targetPartNum}`]: snapshotDialogue,
            },
            scene_indices: [targetPartNum - 1],
            feedback: videoFixInstruction.trim(),
            image_url: currentImage || originalImageUrl,
            visual_style: visualStyle,
          }),
        });
        const data = await res.json();
        if (data.success && data.prompts_obj) {
          const revP = data.prompts_obj[`prompt${targetPartNum}`];
          const revD = data.prompts_obj[`dialogue${targetPartNum}`];
          if (revP && String(revP).trim().length > 15) {
            nextPrompt = String(revP).trim();
            if (activePartNumRef.current === targetPartNum) setLocalPrompt(nextPrompt);
          }
          if (revD !== undefined && String(revD).trim().length > 0) {
            nextDialogue = String(revD).trim();
            if (activePartNumRef.current === targetPartNum) setLocalDialogue(nextDialogue);
          }
          if (data.prompts_obj.character_bible && String(data.prompts_obj.character_bible).trim()) {
            extraUpdatedFields = { character_bible: String(data.prompts_obj.character_bible).trim() };
          }
          if (activePartNumRef.current === targetPartNum) {
            setLastAiVideoFixReport({
              analysis: data.revision_note || `Đã tối ưu lại Prompt & Lời thoại Part ${targetPartNum} theo đúng yêu cầu và bắt đầu Render bản mới.`,
              revisedPrompt: nextPrompt,
              revisedDialogue: nextDialogue,
            });
          }
        }
      } catch {}

      // 2. Save updated prompt & trigger Veo re-render (which automatically sets the new render as active!)
      await onSavePartPrompt(targetPartNum, nextPrompt, nextDialogue, extraUpdatedFields);
      setIsFixingVideoWithAi(false);
      isRenderingRef.current = true;
      setIsRendering(true);
      await onRenderSingleVideo(targetPartNum, nextPrompt, nextDialogue, {
        includePrevFrame: localPrevFrameChoice === 'no' ? false : localPrevFrameChoice,
        prevFrameParts: localPrevFrameChoice === 'custom_parts' ? selectedPrevVideoParts : undefined,
        refImagesMode: localRefImagesMode,
      });
      await onRefreshPartsStatus();
      await fetchPartVersions();
      if (activePartNumRef.current === targetPartNum) {
        setPreviewVersionUrl(null);
        setVideoReloadKey((k) => k + 1);
      }
    } catch (err: any) {
      showToast(`❌ Lỗi Render lại: ${err.message}`);
    } finally {
      setIsFixingVideoWithAi(false);
      isRenderingRef.current = false;
      setIsRendering(false);
    }
  };

  return (
    <div className="modal-overlay open" style={{ zIndex: 10010 }}>
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
            <h2 style={{ margin: 0, fontSize: '20px', lineHeight: 1.25 }}>Chỉnh sửa video · Part {partNum}/{totalParts}</h2>
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

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(partNumbers.length, 10)}, minmax(55px, 1fr))`, gap: '7px', marginBottom: '14px', overflowX: 'auto' }}>
          {partNumbers.map((num) => (
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
            gap: '12px',
            marginBottom: '12px',
            alignItems: 'start',
          }}
        >
          <div style={cardStyle}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#f472b6', marginBottom: '8px' }}>Ảnh tham chiếu · Part {partNum}</div>
            <div
              style={{ aspectRatio: '16/9', background: '#111', borderRadius: '9px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentImage ? 'zoom-in' : 'default' }}
              onClick={() => currentImage && onOpenLightbox(getDisplayImageUrl(currentImage), `Ảnh Part ${partNum}`, partNum - 1)}
            >
              {currentImage ? (
                <img src={getDisplayImageUrl(currentImage)} alt={`Part ${partNum}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Chưa có ảnh</span>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#60a5fa', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Video · Part {partNum}</span>
                {versions.length > 1 && (
                  <span style={{ fontSize: '10px', background: 'rgba(96,165,250,0.15)', color: '#93c5fd', padding: '1px 6px', borderRadius: '10px', fontWeight: 600 }}>
                    {versions.length} phiên bản
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {displayedVideo && (
                  <a
                    href={`/api/videos/download?url=${encodeURIComponent(displayedVideo)}&filename=${encodeURIComponent(`part_${partNum}`)}`}
                    download={`part_${partNum}.mp4`}
                    style={{
                      background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.4)',
                      color: '#10b981',
                      padding: '2px 8px',
                      borderRadius: '5px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                    title={`Tải video Part ${partNum} về máy`}
                  >
                    ⬇️ Tải Video
                  </a>
                )}
                {displayedVideo && <span style={{ color: '#10b981', fontWeight: 600 }}>{videoDuration > 0 ? formatSeconds(videoDuration) : 'Sẵn sàng'}</span>}
              </div>
            </div>

            {/* Preview notice banner if viewing a non-active version */}
            {previewVersionUrl && previewVersionUrl !== currentVideo && (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: '7px',
                  padding: '6px 10px',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  fontSize: '11px',
                  color: '#fbbf24',
                }}
              >
                <span>👀 Đang xem thử bản khác</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(() => {
                    const activeVer = versions.find((v) => v.url === previewVersionUrl);
                    if (!activeVer) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => handleSetActiveVersion(activeVer)}
                        disabled={!!isSettingActive}
                        style={{
                          background: '#10b981',
                          border: 'none',
                          color: '#fff',
                          borderRadius: '5px',
                          padding: '3px 8px',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {isSettingActive === activeVer.filename ? 'Đang đặt...' : '✓ Đặt làm video chính'}
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setPreviewVersionUrl(null)}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: '5px',
                      padding: '3px 8px',
                      fontSize: '10.5px',
                      cursor: 'pointer',
                    }}
                  >
                    Quay lại bản chính
                  </button>
                </div>
              </div>
            )}

            <div style={{ aspectRatio: '16/9', background: '#050505', borderRadius: '9px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {displayedVideo ? (
                <video
                  key={`${videoReloadKey}:${videoBaseKey}`}
                  ref={videoRef}
                  src={displayedVideo}
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

            {/* Version History List */}
            {versions.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    🎞️ Các phiên bản đã render ({versions.length})
                  </span>
                  {isLoadingVersions && (
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>Đang tải...</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: '2px' }}>
                  {versions.map((ver, idx) => {
                    const isCurrentDisplayed = displayedVideo === ver.url;
                    const isMain = ver.is_active;
                    const verIndexLabel = `Bản ${versions.length - idx}`;
                    const timeDate = ver.mtimeMs ? new Date(ver.mtimeMs) : (ver.created_at ? new Date(ver.created_at) : null);
                    const timeStr = timeDate && !isNaN(timeDate.getTime())
                      ? timeDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : (ver.created_at && !ver.created_at.includes('Invalid') ? ver.created_at : '');
                    return (
                      <div
                        key={ver.filename}
                        onClick={() => setPreviewVersionUrl(ver.url)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '6px 9px',
                          borderRadius: '7px',
                          background: isCurrentDisplayed
                            ? 'rgba(96,165,250,0.12)'
                            : 'var(--bg2)',
                          border: isCurrentDisplayed
                            ? '1px solid rgba(96,165,250,0.45)'
                            : isMain
                            ? '1px solid rgba(16,185,129,0.35)'
                            : '1px solid var(--border)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: isMain ? '#34d399' : 'var(--text)', whiteSpace: 'nowrap' }}>
                            {verIndexLabel}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                            {isMain && (
                              <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'rgba(16,185,129,0.2)', color: '#34d399' }}>
                                ★ Video chính
                              </span>
                            )}
                            {isCurrentDisplayed && !isMain && (
                              <span style={{ fontSize: '9.5px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px', background: 'rgba(245,158,11,0.2)', color: '#fbbf24' }}>
                                👀 Đang xem
                              </span>
                            )}
                            {ver.is_trimmed && (
                              <span style={{ fontSize: '9.5px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px', background: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }}>
                                ✂️ Đã cắt
                              </span>
                            )}
                            {ver.filename.includes('_ai') && (
                              <span style={{ fontSize: '9.5px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px', background: 'rgba(59,130,246,0.22)', color: '#93c5fd' }}>
                                🤖 AI đã sửa
                              </span>
                            )}
                            <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>
                              {ver.duration_sec.toFixed(1)}s · {ver.size_mb} MB {timeStr ? `· ${timeStr}` : ''}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          {!isMain && (
                            <button
                              type="button"
                              onClick={() => handleSetActiveVersion(ver)}
                              disabled={isSettingActive === ver.filename}
                              style={{
                                background: 'rgba(16,185,129,0.18)',
                                border: '1px solid rgba(16,185,129,0.4)',
                                color: '#34d399',
                                borderRadius: '5px',
                                padding: '3px 7px',
                                fontSize: '10.5px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Chọn phiên bản này làm video chính thức cho Part này"
                            >
                              {isSettingActive === ver.filename ? '...' : '✓ Chọn làm chính'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteVersion(ver)}
                            disabled={isDeletingVersion === ver.filename}
                            style={{
                              background: 'rgba(239,68,68,0.12)',
                              border: '1px solid rgba(239,68,68,0.3)',
                              color: '#f87171',
                              borderRadius: '5px',
                              padding: '3px 6px',
                              fontSize: '10.5px',
                              cursor: 'pointer',
                            }}
                            title="Xóa phiên bản này"
                          >
                            {isDeletingVersion === ver.filename ? '...' : '🗑️'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {displayedVideo && (
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '10px', alignItems: 'end' }}>
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

        {displayedVideo && (
          <div
            style={{
              ...cardStyle,
              marginBottom: '12px',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(59,130,246,0.08) 100%)',
              borderColor: isFixingVideoWithAi ? '#10b981' : 'rgba(16,185,129,0.38)',
              animation: isFixingVideoWithAi ? 'pulseBorder 2s infinite ease-in-out' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🤖 Sửa lại video bằng AI Agent Argon 4.0 · Part {partNum}</span>
                  <span style={{ fontSize: '10px', background: 'rgba(16,185,129,0.2)', color: '#6ee7b7', padding: '1px 7px', borderRadius: '999px', fontWeight: 700 }}>
                    gemini-4-argon-low
                  </span>
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--muted)', marginTop: '2px' }}>
                  Nhập nội dung lỗi cần sửa — AI Agent Argon 4.0 sẽ tạo <b>phiên bản mới</b> từ bản sửa và đặt làm <b>★ Video chính</b> (bản cũ vẫn giữ nguyên ở danh sách trên để bạn xóa thủ công 🗑️ nếu không ưng ý).
                </div>
              </div>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', color: '#fbbf24', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={fixFromOriginalBackup}
                  onChange={(e) => setFixFromOriginalBackup(e.target.checked)}
                  disabled={isFixingVideoWithAi}
                />
                <span>Sửa từ bản gốc chưa cắt (.orig.bak)</span>
              </label>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
              {[
                { label: '✂️ Cắt đoạn đứng đơ đầu/cuối & mượt 60FPS', text: 'Tự động phát hiện và cắt bỏ các giây nhân vật đứng đơ ở đầu hoặc cuối video, nội suy chuyển động mượt 60 FPS.' },
                { label: '🔄 Thêm hoạt ảnh thu tay/chuyển tiếp đỡ khựng', text: 'Thêm hoạt ảnh nhân vật thu tay/bước lùi chuyển đổi động tác ở cuối cảnh (reverse tail) và nội suy 60 FPS để chuyển cảnh không bị khựng.' },
                { label: '🔇 Lọc tạp âm & chuẩn hóa giọng nói', text: 'Lọc tạp âm nền (denoise), chuẩn hóa âm lượng lời thoại rõ ràng (-14 LUFS) và giữ nguyên hiệu ứng âm thanh.' },
                { label: '🔍 Phóng nhẹ 8% xóa vật thể thừa ở rìa', text: 'Crop 8% viền khung hình để loại bỏ chi tiết thừa ở rìa ảnh và nâng nét lại chuẩn 60 FPS.' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={isFixingVideoWithAi}
                  onClick={() =>
                    setVideoFixInstruction((prev) =>
                      prev.trim() ? `${prev.trim()}. ${preset.text}` : preset.text
                    )
                  }
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(16,185,129,0.3)',
                    background: 'rgba(16,185,129,0.1)',
                    color: '#a7f3d0',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: isFixingVideoWithAi ? 'not-allowed' : 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={videoFixInstruction}
              disabled={isFixingVideoWithAi || isRendering}
              onChange={(e) => setVideoFixInstruction(e.target.value)}
              placeholder={`Nhập nội dung cần sửa cho video Part ${partNum} (VD: Cắt bỏ 1s đầu nhân vật đang đứng đơ, thêm hoạt ảnh chuyển đổi động tác cuối cảnh cho mượt, xóa tiếng nói lỗi từ giây 4 đến giây 6, hoặc mô tả lỗi để AI sửa Prompt & Render lại...)`}
              style={{
                ...fieldStyle,
                resize: 'vertical',
                lineHeight: 1.45,
                fontFamily: 'inherit',
                borderColor: 'rgba(16,185,129,0.35)',
              }}
            />

            {lastAiVideoFixReport && (
              <div
                style={{
                  marginTop: '8px',
                  padding: '8px 10px',
                  borderRadius: '7px',
                  background: 'rgba(16,185,129,0.12)',
                  border: '1px solid rgba(16,185,129,0.35)',
                  fontSize: '11px',
                  color: '#d1fae5',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 700, color: '#34d399', marginBottom: '2px' }}>
                  ✨ Kết quả xử lý của AI Agent Argon 4.0:
                </div>
                <div>{lastAiVideoFixReport.analysis}</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                {isFixingVideoWithAi
                  ? '⏳ AI Argon 4.0 đang kiểm tra đoạn lỗi, cắt giữ đoạn tốt, render Veo 3 & ghép tạo bản mới...'
                  : `★ Đang áp dụng trên: ${activeVersion?.filename || `Part ${partNum}`}`}
              </span>

              <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginLeft: 'auto' }}>
                <button
                  type="button"
                  onClick={handleArgonRerenderAndReplace}
                  disabled={isFixingVideoWithAi || isRendering || !videoFixInstruction.trim()}
                  style={{
                    background: 'rgba(139,92,246,0.2)',
                    color: '#ddd6fe',
                    border: '1px solid rgba(139,92,246,0.45)',
                    padding: '8px 12px',
                    borderRadius: '7px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: isFixingVideoWithAi || isRendering || !videoFixInstruction.trim() ? 'not-allowed' : 'pointer',
                    opacity: isFixingVideoWithAi || isRendering || !videoFixInstruction.trim() ? 0.6 : 1,
                  }}
                  title="Viết lại Prompt toàn cảnh từ đầu (0s) và tự động Render lại Veo thay thế hoàn toàn bản chính"
                >
                  {isRendering ? '🎬 Đang Render Veo...' : '🎬 AI Sửa Prompt & Render Lại Thay Bản Chính'}
                </button>

                <button
                  type="button"
                  onClick={handleArgonFixVideo}
                  disabled={isFixingVideoWithAi || isRendering || !videoFixInstruction.trim()}
                  style={{
                    background: isFixingVideoWithAi
                      ? 'rgba(16,185,129,0.4)'
                      : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 15px',
                    borderRadius: '7px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: isFixingVideoWithAi || isRendering || !videoFixInstruction.trim() ? 'not-allowed' : 'pointer',
                    opacity: isFixingVideoWithAi || isRendering || !videoFixInstruction.trim() ? 0.65 : 1,
                    boxShadow: '0 2px 10px rgba(16,185,129,0.28)',
                  }}
                  title="AI Argon 4.0 tự soi 16 khung hình, giữ lại đoạn đã đẹp, trích xuất frame neo ngay trước đoạn lỗi để tự render Veo 3 đoạn thay thế và ghép nối mượt mà thành bản mới"
                >
                  {isFixingVideoWithAi ? '⏳ AI Argon 4.0 đang cắt & render Veo 3 ghép bản mới...' : '🛠️ AI Argon 4.0 Sửa Tạo Bản Mới (Đặt Làm Chính)'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Single AI Prompt Revision */}
          <div style={{ ...cardStyle, background: 'rgba(124,58,237,0.08)', borderColor: isRevisingPrompts ? '#ec4899' : 'rgba(139,92,246,0.35)', animation: isRevisingPrompts ? 'pulseBorder 2s infinite ease-in-out' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>🤖 AI Sửa Kịch Bản Part {partNum}</span>
              </div>
              {isRevisingPrompts && (
                <span style={{ fontSize: '10.5px', color: '#f472b6', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ec4899', animation: 'livePulse 0.8s infinite' }} />
                  <span>AI đang sửa kịch bản...</span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={aiFeedbackModal}
                disabled={isRevisingPrompts || Boolean(otherPartRevisingNotice)}
                onChange={(e) => setAiFeedbackModal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!aiFeedbackModal.trim()) {
                      showToast(`⚠️ Vui lòng nhập góp ý sửa cho Part ${partNum}!`);
                      return;
                    }
                    onRevisePrompt?.(aiFeedbackModal.trim()).catch((err: any) => {
                      showToast(`❌ Lỗi AI sửa: ${err?.message || err}`);
                    });
                  }
                }}
                placeholder={otherPartRevisingNotice ? otherPartRevisingNotice : `Nhập yêu cầu để AI viết lại Part ${partNum} (VD: Đổi góc quay, biểu cảm hài hước... rồi nhấn Enter)`}
                style={{ ...fieldStyle, flex: 1, opacity: otherPartRevisingNotice ? 0.7 : 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  if (!aiFeedbackModal.trim()) {
                    showToast(`⚠️ Vui lòng nhập góp ý sửa cho Part ${partNum}!`);
                    return;
                  }
                  onRevisePrompt?.(aiFeedbackModal.trim()).catch((err: any) => {
                    showToast(`❌ Lỗi AI sửa: ${err?.message || err}`);
                  });
                }}
                disabled={isRevisingPrompts || Boolean(otherPartRevisingNotice) || !aiFeedbackModal.trim()}
                style={{
                  background: isRevisingPrompts ? 'rgba(124,58,237,0.4)' : (otherPartRevisingNotice ? 'var(--border)' : 'linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)'),
                  color: otherPartRevisingNotice ? 'var(--muted)' : '#fff',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '8px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: isRevisingPrompts || Boolean(otherPartRevisingNotice) || !aiFeedbackModal.trim() ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexShrink: 0,
                  boxShadow: otherPartRevisingNotice ? 'none' : '0 2px 8px rgba(124,58,237,0.3)',
                }}
              >
                {isRevisingPrompts ? '⏳ Đang sửa...' : '🤖 AI Sửa'}
              </button>
              {isRevisingPrompts && (
                <button
                  type="button"
                  onClick={onStopPipeline}
                  style={{
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid rgba(239,68,68,0.5)',
                    color: '#f87171',
                    borderRadius: '7px',
                    padding: '8px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  ⛔ Hủy
                </button>
              )}
            </div>
            {revisingStatusText && isRevisingPrompts && (
              <div style={{ marginTop: '6px', fontSize: '10.5px', color: '#38bdf8' }}>
                {revisingStatusText}
              </div>
            )}
            {otherPartRevisingNotice && !isRevisingPrompts && (
              <div style={{ marginTop: '6px', fontSize: '10.5px', color: '#fbbf24', background: 'rgba(245,158,11,0.08)', padding: '5px 8px', borderRadius: '5px', border: '1px solid rgba(245,158,11,0.2)' }}>
                ⚠️ {otherPartRevisingNotice}
              </div>
            )}
          </div>

          {/* Options: Chế độ Nhân vật (Real vs 3D), Frame step trước & Hình gốc tham chiếu khi render Veo */}
          <div style={{ ...cardStyle, background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.35)', padding: '10px 14px' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#60a5fa', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
              <span>🎬 Cấu hình Render Hình & Video Part {partNum} (Veo)</span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--bg2)', padding: '2px', borderRadius: '6px', border: '1px solid rgba(96, 165, 250, 0.35)' }}>
                <button
                  type="button"
                  onClick={() => onChangeVisualStyle?.('real')}
                  style={{
                    background: visualStyle === 'real' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'transparent',
                    color: visualStyle === 'real' ? '#fff' : 'var(--muted)',
                    border: 'none',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  🧑🐾 Người/Động vật thật (Real)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeVisualStyle?.('3d')}
                  style={{
                    background: visualStyle === '3d' ? 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' : 'transparent',
                    color: visualStyle === '3d' ? '#fff' : 'var(--muted)',
                    border: 'none',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  🎬 Hoạt hình 3D
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: '#93c5fd', fontWeight: 600 }}>🔗 Frame step trước:</span>
                <select
                  value={localPrevFrameChoice}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLocalPrevFrameChoice(val);
                    if (val === 'custom_parts' && selectedPrevVideoParts.length === 0 && partNum > 1) {
                      setSelectedPrevVideoParts([partNum - 1]);
                    }
                  }}
                  style={{ ...fieldStyle, width: '100%', padding: '6px 10px', fontSize: '11px', fontWeight: 600 }}
                >
                  <option value="yes">
                    ✓ Có lấy frame step trước ({partNum > 1 ? `Part ${partNum - 1} - ` : ''}Nối cảnh)
                  </option>
                  <option value="no">✕ Không lấy frame step trước (Độc lập)</option>
                  {partNum > 1 && (
                    <option value="all_prev">
                      📚 Lấy hình từ video TẤT CẢ các phân cảnh trước (Part 1 → Part {partNum - 1})
                    </option>
                  )}
                  {partNumbers.filter((n) => n !== partNum).length > 0 && (
                    <option value="custom_parts">
                      🎯 Tự chọn hình từ video của nhiều phân cảnh trước...
                    </option>
                  )}
                  <optgroup label="── Chọn hình từ Video của từng phân cảnh ──">
                    {partNumbers.map((n) => (
                      <option key={`vf_${n}`} value={`part_${n}`}>
                        🎬 Lấy hình từ Video Part {n}
                        {n === partNum - 1 ? ' (Step liền trước)' : n < partNum ? ' (Phân cảnh trước)' : ''}
                        {sceneUrls[n - 1] ? ' ✓ Đã có video' : ' (Chưa có video)'}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: '#93c5fd', fontWeight: 600 }}>🖼️ Hình gốc tham chiếu:</span>
                <select
                  value={localRefImagesMode}
                  onChange={(e) => setLocalRefImagesMode(e.target.value)}
                  style={{ ...fieldStyle, width: '100%', padding: '6px 10px', fontSize: '11px', fontWeight: 600 }}
                >
                  <option value="all">📦 Lấy tất cả hình gốc liên quan</option>
                  <option value="current_only">🎯 Chỉ lấy hình gốc / cảnh hiện tại</option>
                  {partNum > 1 && (
                    <option value="prev_videos">
                      🎬 Lấy hình từ Video của các phân cảnh trước (Part 1 → Part {partNum - 1})
                    </option>
                  )}
                  {partNum > 1 && (
                    <option value="prev_scenes">
                      🖼️ Lấy ảnh Storyboard của các phân cảnh trước (Part 1 → Part {partNum - 1})
                    </option>
                  )}
                  <optgroup label="── Chọn hình từ Video của từng phân cảnh ──">
                    {partNumbers.map((n) => (
                      <option key={`ref_vf_${n}`} value={`prev_video_${n}`}>
                        🎬 Lấy hình từ Video của phân cảnh Part {n}
                        {sceneUrls[n - 1] ? ' ✓ Đã có video' : ' (Chưa có video)'}
                      </option>
                    ))}
                  </optgroup>
                  <option value="none">🚫 Không lấy hình gốc (Chỉ prompt)</option>
                </select>
              </div>
            </div>

            {localPrevFrameChoice === 'custom_parts' && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(96, 165, 250, 0.3)', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '10.5px', color: '#93c5fd', fontWeight: 600 }}>
                  Chọn Video phân cảnh cần lấy hình:
                </span>
                {partNumbers
                  .filter((n) => n !== partNum)
                  .map((n) => {
                    const isChecked = selectedPrevVideoParts.includes(n);
                    const hasVid = Boolean(sceneUrls[n - 1]);
                    return (
                      <button
                        key={`chk_vf_${n}`}
                        type="button"
                        onClick={() => {
                          setSelectedPrevVideoParts((prev) =>
                            prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)
                          );
                        }}
                        style={{
                          padding: '3px 9px',
                          borderRadius: '6px',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          border: isChecked ? '1px solid #60a5fa' : '1px solid var(--border)',
                          background: isChecked ? 'rgba(59, 130, 246, 0.25)' : 'var(--bg2)',
                          color: isChecked ? '#e0f2fe' : 'var(--muted)',
                        }}
                        title={hasVid ? `Video Part ${n} đã sẵn sàng` : `Part ${n} chưa có video`}
                      >
                        {isChecked ? '☑' : '☐'} Video Part {n} {hasVid ? '✓' : ''}
                      </button>
                    );
                  })}
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
                {partNumbers.map((n) => <option key={n} value={n - 1}>Part {n}</option>)}
              </select>
              {originalImageUrl && <span style={{ fontSize: '10px', color: '#10b981' }}>Có ảnh gốc</span>}
            </div>
            <textarea rows={2} value={redrawNotes} onChange={(e) => setRedrawNotes(e.target.value)} placeholder="Ghi chú vẽ lại: đổi góc camera, giữ nguyên nhân vật, tăng biểu cảm..." style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              isRenderingRef.current = false;
              setIsRendering(false);
              isDrawingRef.current = false;
              setIsDrawing(false);
              onStopPipeline();
            }}
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.45)', color: '#f87171', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
          >
            ⛔ Hủy / Dừng pipeline
          </button>
          <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleSave} disabled={isSaving || isRendering || isDrawing} style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: (isSaving || isRendering || isDrawing) ? 'not-allowed' : 'pointer', opacity: (isSaving || isRendering || isDrawing) ? 0.6 : 1 }}>{isSaving ? 'Đang lưu...' : 'Lưu prompt'}</button>
            <button type="button" onClick={handleRedraw} disabled={isDrawing || isRendering || isSaving} style={{ background: '#db2777', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: (isDrawing || isRendering || isSaving) ? 'not-allowed' : 'pointer', opacity: (isDrawing || isRendering || isSaving) ? 0.6 : 1 }}>{isDrawing ? 'Đang vẽ...' : 'Vẽ lại ảnh'}</button>
            <button type="button" onClick={handleRenderVideo} disabled={isRendering || isDrawing || isSaving} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: 700, cursor: (isRendering || isDrawing || isSaving) ? 'not-allowed' : 'pointer', opacity: (isRendering || isDrawing || isSaving) ? 0.7 : 1 }}>{isRendering ? 'Đang render...' : 'Render video'}</button>
            <button type="button" onClick={onClose} disabled={isRendering || isDrawing} style={{ background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '7px', fontSize: '11px', cursor: (isRendering || isDrawing) ? 'not-allowed' : 'pointer', opacity: (isRendering || isDrawing) ? 0.6 : 1 }}>Đóng</button>
          </div>
        </div>
      </div>
    </div>
  );
};
