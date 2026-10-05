import React, { useEffect, useRef, useState } from 'react';
import { VideoItem } from '../../types';
import { useToast } from '../../context/ToastContext';
import { YouTubePublishModal } from '../modals/YouTubePublishModal';
import { FacebookPublishModal } from '../modals/FacebookPublishModal';

interface VideoPlayerModalProps {
  video: VideoItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateSuccess: () => void;
}

const formatSeconds = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0.0s';
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
};

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  video,
  isOpen,
  onClose,
  onUpdateSuccess,
}) => {
  const { showToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [s3Url, setS3Url] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('full');
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoReloadKey, setVideoReloadKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isVoiceSyncing, setIsVoiceSyncing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);
  const [showFacebookModal, setShowFacebookModal] = useState(false);


  useEffect(() => {
    if (video) {
      setTitle(video.title || '');
      setCaption(video.description || video.caption || '');
      setTags((video.tags || []).join(' '));
      setImages(video.images || []);
      setS3Url(video.s3_url || '');
      setStreamUrl(video.stream_url || video.s3_url || '');
      setSelectedEpisodeId('full');
      setVideoDuration(0);
      setVideoReloadKey((key) => key + 1);
    }
  }, [video, isOpen]);

  if (!isOpen || !video) return null;

  const handleCopyCaption = () => {
    if (!caption) return;
    navigator.clipboard.writeText(caption);
    showToast('📋 Đã sao chép Caption!');
  };

  const handleCopyTags = () => {
    if (!tags) return;
    navigator.clipboard.writeText(tags);
    showToast('🏷️ Đã sao chép Hashtags!');
  };

  const handleCopyS3 = () => {
    if (!s3Url) return;
    navigator.clipboard.writeText(s3Url);
    showToast('☁️ Đã sao chép link S3!');
  };

  const handleRegenerateCaption = async () => {
    setIsRegenerating(true);
    try {
      showToast(`🤖 AI đang tạo caption cho: "${title || video.title}"...`);
      const res = await fetch('/api/pipeline/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: title || video.title,
          category: video.category || 'tech',
          imageUrl: images[0] || video.thumbnail_url || '',
        }),
      });
      const data = await res.json();
      if (data.success && data.caption) {
        setCaption(data.caption);
        showToast('✨ Đã tạo lại Caption thành công! Bấm Lưu để cập nhật.');
      } else {
        showToast(`❌ Lỗi tạo caption: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleVoiceSync = async () => {
    setIsVoiceSyncing(true);
    try {
      showToast('🎙️ Đang dùng AI phân tích mốc thời gian & lồng giọng nhân vật...');
      const res = await fetch('/api/pipeline/analyze-voice-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id, script: caption }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Lồng giọng tự động thất bại');
      showToast('🎉 Đã lồng giọng AI và đồng bộ thời gian thoại thành công!');
      if (data.video) {
        setStreamUrl(data.video.stream_url || data.video.s3_url || streamUrl);
        setVideoReloadKey((key) => key + 1);
      }
      onUpdateSuccess();
    } catch (err: any) {
      showToast(`❌ Lỗi lồng giọng: ${err.message}`);
    } finally {
      setIsVoiceSyncing(false);
    }
  };

  const handleDownloadVideo = () => {
    const rawTarget = streamUrl || video.stream_url || video.s3_url || (video.local_path ? `/downloads/${video.local_path.split('/downloads/')[1] || video.local_path}` : '');
    if (!rawTarget && !video.id) {
      showToast('⚠️ Không tìm thấy đường dẫn video để tải!');
      return;
    }
    const baseClean = (title || video.title || 'video').trim().replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9\s]/gu, '').replace(/\s+/g, '_') || 'video';
    const suffix = selectedEpisodeId === 'full' ? '_full' : `_${selectedEpisodeId}`;
    const cleanName = `${baseClean}${suffix}`;
    showToast('⬇️ Đang tải video về máy...');

    const downloadEndpoint = `/api/videos/download?id=${encodeURIComponent(video.id || '')}&url=${encodeURIComponent(rawTarget)}&filename=${encodeURIComponent(cleanName)}`;
    const a = document.createElement('a');
    a.href = downloadEndpoint;
    a.download = `${cleanName}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSaveDetails = async () => {
    setIsSaving(true);
    try {
      const tagList = tags
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`));

      const res = await fetch(`/api/videos/${video.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: caption,
          caption,
          description_vi: caption,
          tags: tagList,
          images,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('💾 Đã lưu thông tin video thành công!');
        onUpdateSuccess();
      } else {
        showToast('❌ Lỗi lưu: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Xóa video "${title || video.title}"? Thao tác này không thể hoàn tác!`)) return;
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('🗑️ Đã xóa video!');
        onClose();
        onUpdateSuccess();
      } else {
        showToast('❌ Lỗi xóa video: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      showToast('📱 Đang đăng video lên TikTok...');
      const res = await fetch(`/api/videos/${video.id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ ${data.message || 'Đăng TikTok thành công!'}`);
        onUpdateSuccess();
        onClose();
      } else {
        showToast('❌ Đăng TikTok thất bại: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleAddImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        showToast('⏳ Đang tải ảnh lên...');
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const res = await fetch('/api/upload/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, filename: file.name }),
        });
        const data = await res.json();
        if (data.success && data.url) {
          setImages((prev) => [...prev, data.url]);
          showToast('✅ Đã thêm ảnh vào video!');
        } else {
          showToast('❌ Tải ảnh thất bại: ' + (data.error || 'Unknown error'));
        }
      } catch (err: any) {
        showToast('❌ Lỗi tải ảnh: ' + err.message);
      }
    };
    input.click();
  };

  const handleRemoveImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const isPublished = video.status === 'published';

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '660px',
          maxWidth: '92vw',
          height: 'min(860px, 92vh)',
          maxHeight: '92vh',
          padding: '18px 22px',
          borderRadius: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          overflow: 'hidden',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
        }}
      >
        <div
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
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 700,
              color: 'var(--text)',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px dashed var(--border)',
              padding: '4px',
              outline: 'none',
              width: '80%',
            }}
            placeholder="Enter video title..."
          />
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              fontSize: '24px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <div
          className="modal-body-vertical"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '14px 6px 14px 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            {video.episodes && video.episodes.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEpisodeId('full');
                    setStreamUrl(video.stream_url || video.s3_url || (video.local_path ? `/downloads/${video.local_path.split('/downloads/')[1] || video.local_path}` : ''));
                  }}
                  style={{
                    background: selectedEpisodeId === 'full' ? 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)' : 'var(--bg3)',
                    border: selectedEpisodeId === 'full' ? '1px solid #60a5fa' : '1px solid var(--border)',
                    color: selectedEpisodeId === 'full' ? '#fff' : 'var(--text)',
                    borderRadius: '20px',
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  🎬 Bản Full Story
                </button>
                {video.episodes.map((ep, idx) => (
                  <button
                    key={ep.id || idx}
                    type="button"
                    onClick={() => {
                      setSelectedEpisodeId(ep.id || `ep_${idx + 1}`);
                      setStreamUrl(ep.video_url);
                    }}
                    style={{
                      background: selectedEpisodeId === (ep.id || `ep_${idx + 1}`) ? 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)' : 'var(--bg3)',
                      border: selectedEpisodeId === (ep.id || `ep_${idx + 1}`) ? '1px solid #f472b6' : '1px solid var(--border)',
                      color: selectedEpisodeId === (ep.id || `ep_${idx + 1}`) ? '#fff' : 'var(--text)',
                      borderRadius: '20px',
                      padding: '4px 12px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ✂️ {ep.title} (Scene {ep.startScene}..{ep.endScene})
                  </button>
                ))}
              </div>
            )}

            <div
              id="videoPlayerContainer"
              style={{
                background: '#000',
                borderRadius: '14px',
                overflow: 'hidden',
                width: '100%',
                maxHeight: '360px',
                aspectRatio: '16/9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
              }}
            >
              {streamUrl ? (
                <video
                  key={`${videoReloadKey}:${streamUrl}`}
                  ref={videoRef}
                  src={streamUrl}
                  controls
                  autoPlay
                  onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration || 0)}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: '#000',
                    display: 'block',
                    borderRadius: '14px',
                  }}
                />
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>Chưa có file video</div>
              )}
            </div>
            {videoDuration > 0 && (
              <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <span>⏱️ Thời lượng: <strong style={{ color: 'var(--text)' }}>{formatSeconds(videoDuration)}</strong></span>
                {s3Url && (
                  <a href={s3Url} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#38bdf8', textDecoration: 'none' }}>
                    🔗 Xem link S3
                  </a>
                )}
              </div>
            )}
          </div>

          <div
            id="videoModalDetails"
            style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>📱 TikTok Caption (Vietnamese):</span>
                  <button
                    type="button"
                    onClick={handleRegenerateCaption}
                    disabled={isRegenerating}
                    style={{
                      background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.3)',
                      color: 'var(--success)',
                      cursor: 'pointer',
                      fontSize: '10px',
                      fontWeight: 600,
                      outline: 'none',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>{isRegenerating ? '⏳ Đang tạo...' : '✨ Gemini Enhanced'}</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCaption}
                  style={{ background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                >
                  📋 Copy
                </button>
              </div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                style={{
                  fontSize: '13px',
                  color: 'var(--text)',
                  lineHeight: 1.5,
                  background: 'var(--bg3)',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  wordBreak: 'break-word',
                  width: '100%',
                  height: '120px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                placeholder="Enter Vietnamese caption..."
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>🏷️ Hashtags:</span>
                <button
                  type="button"
                  onClick={handleCopyTags}
                  style={{ background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                >
                  📋 Copy
                </button>
              </div>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                style={{
                  fontSize: '12px',
                  color: '#a78bfa',
                  fontFamily: 'monospace',
                  background: 'var(--bg3)',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  width: '100%',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                placeholder="e.g. #tag1 #tag2"
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>🖼️ Product Images:</span>
                <button
                  type="button"
                  onClick={handleAddImage}
                  style={{
                    background: 'rgba(124,58,237,0.15)',
                    border: '1px solid rgba(124,58,237,0.3)',
                    color: '#a78bfa',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: '6px',
                  }}
                >
                  + Add Image
                </button>
              </div>
              {images.length === 0 ? (
                <div
                  style={{
                    background: 'var(--bg3)',
                    border: '1px dashed var(--border)',
                    borderRadius: '8px',
                    padding: '16px',
                    textAlign: 'center',
                    color: 'var(--muted)',
                    fontSize: '12px',
                  }}
                >
                  📷 No images yet — click <strong>+ Add Image</strong> to attach product photos
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', maxHeight: '180px', overflowY: 'auto', padding: '2px' }}>
                  {images.map((img, i) => (
                    <div key={i} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', aspectRatio: '1', background: 'var(--bg3)' }}>
                      <img src={img} alt={`Product ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(i)}
                        style={{
                          position: 'absolute',
                          top: '4px',
                          right: '4px',
                          background: 'rgba(0,0,0,0.65)',
                          border: 'none',
                          color: 'white',
                          borderRadius: '50%',
                          width: '22px',
                          height: '22px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>☁️ Cloud S3 Link:</span>
                <button
                  type="button"
                  onClick={handleCopyS3}
                  style={{ background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                >
                  📋 Copy
                </button>
              </div>
              <input
                type="text"
                readOnly
                value={s3Url}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--muted)',
                  fontSize: '11px',
                  outline: 'none',
                  textOverflow: 'ellipsis',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>

        <div
          id="videoModalFooter"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '6px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg2)',
            flexShrink: 0,
            width: '100%',
            marginTop: 0,
          }}
        >
          {/* Left: Destructive action */}
          <button
            type="button"
            onClick={handleDelete}
            style={{
              background: 'rgba(239,68,68,0.1)',
              color: '#f87171',
              border: '1px solid rgba(239,68,68,0.2)',
              padding: '6px 10px',
              fontSize: '11px',
              borderRadius: '6px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Xoá video"
          >
            🗑️ Xoá
          </button>

          {/* Center: Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={handleVoiceSync}
              disabled={isVoiceSyncing}
              style={{
                background: 'rgba(124,58,237,0.15)',
                color: '#a78bfa',
                border: '1px solid rgba(124,58,237,0.35)',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isVoiceSyncing ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
              title="Lồng giọng AI cho video"
            >
              {isVoiceSyncing ? '⏳ Đang lồng...' : '🎙️ Lồng giọng'}
            </button>
            {video?.youtube_url && (
              <a
                href={video.youtube_shorts_url || video.youtube_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                }}
                title="Xem trên YouTube"
              >
                ▶️ YouTube
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowYouTubeModal(true)}
              style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: '#fff',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 1px 6px rgba(239, 68, 68, 0.25)',
              }}
              title="Đăng video lên YouTube"
            >
              🚀 Đăng YT
            </button>
            <button
              type="button"
              onClick={() => setShowFacebookModal(true)}
              style={{
                background: 'linear-gradient(135deg, #1877f2 0%, #0064e0 100%)',
                color: '#fff',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 1px 6px rgba(24, 119, 242, 0.3)',
              }}
              title="Đăng video lên Facebook (Reels hoặc Video Fanpage)"
            >
              🔵 Đăng FB
            </button>

            <button
              type="button"
              onClick={handleDownloadVideo}
              disabled={isDownloading}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#fff',
                border: 'none',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: isDownloading ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 1px 6px rgba(16,185,129,0.25)',
              }}
              title="Tải file video MP4"
            >
              {isDownloading ? '⏳ Đang tải...' : '⬇️ Tải MP4'}
            </button>
          </div>

          {/* Right: Close + Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px', whiteSpace: 'nowrap' }}
            >
              Đóng
            </button>
            <button
              type="button"
              className="btn-submit"
              onClick={handleSaveDetails}
              disabled={isSaving}
              style={{
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                boxShadow: 'none',
                padding: '6px 12px',
                fontSize: '11px',
                borderRadius: '6px',
                whiteSpace: 'nowrap',
              }}
            >
              {isSaving ? '⏳' : '💾'} Lưu
            </button>
          </div>
        </div>
      </div>

      {showYouTubeModal && video && (
        <YouTubePublishModal
          isOpen={showYouTubeModal}
          onClose={() => setShowYouTubeModal(false)}
          defaultTitle={title || video.title}
          defaultDescription={caption || video.description || video.caption || ''}
          defaultTags={tags ? tags.split(/[\s,]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean) : (video.tags || []).map((t) => t.replace(/^#/, ''))}
          defaultThumbnailUrl={video.thumbnail_url || video.source_image_url || ''}
          videoUrl={streamUrl || video.video_url}
          videoId={video.id}
          episodes={video.episodes?.map((ep) => ({
            id: ep.id,
            title: ep.title,
            video_url: ep.voiced_url || ep.video_url,
            local_path: ep.voiced_path || ep.local_path,
            thumbnail_url: ep.thumbnail_url || video.thumbnail_url || video.source_image_url || '',
          }))}
          initialTarget={selectedEpisodeId !== 'full' ? selectedEpisodeId : 'full'}
          onSuccess={() => {
            onUpdateSuccess();
          }}
        />
      )}

      {showFacebookModal && video && (
        <FacebookPublishModal
          isOpen={showFacebookModal}
          onClose={() => setShowFacebookModal(false)}
          defaultTitle={title || video.title}
          defaultDescription={caption || video.description || video.caption || ''}
          defaultTags={tags ? tags.split(/[\s,]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean) : (video.tags || []).map((t) => t.replace(/^#/, ''))}
          defaultThumbnailUrl={video.thumbnail_url || video.source_image_url || ''}
          videoUrl={streamUrl || video.video_url}
          videoId={video.id}
          episodes={video.episodes?.map((ep) => ({
            id: ep.id,
            title: ep.title,
            video_url: ep.voiced_url || ep.video_url,
            local_path: ep.voiced_path || ep.local_path,
            thumbnail_url: ep.thumbnail_url || video.thumbnail_url || video.source_image_url || '',
          }))}
          initialTarget={selectedEpisodeId !== 'full' ? selectedEpisodeId : 'full'}
          onSuccess={() => {
            onUpdateSuccess();
          }}
        />
      )}
    </div>

  );
};
