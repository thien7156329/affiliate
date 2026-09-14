import React, { useState, useEffect } from 'react';
import { VideoItem } from '../../types';
import { useToast } from '../../context/ToastContext';

interface VideoPlayerModalProps {
  video: VideoItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateSuccess: () => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  video,
  isOpen,
  onClose,
  onUpdateSuccess,
}) => {
  const { showToast } = useToast();
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [s3Url, setS3Url] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [trimSeconds, setTrimSeconds] = useState('0.6');
  const [isSaving, setIsSaving] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isVoiceSyncing, setIsVoiceSyncing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    if (video) {
      setTitle(video.title || '');
      setCaption(video.description || video.caption || '');
      setTags((video.tags || []).join(' '));
      setImages(video.images || []);
      setS3Url(video.s3_url || '');
      setStreamUrl(video.stream_url || video.s3_url || '');
      setTrimSeconds('0.6');
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
      }
      onUpdateSuccess();
    } catch (err: any) {
      showToast(`❌ Lỗi lồng giọng: ${err.message}`);
    } finally {
      setIsVoiceSyncing(false);
    }
  };

  const handleTrimStart = async () => {
    const sec = parseFloat(trimSeconds) || 0.6;
    if (sec <= 0) {
      showToast('⚠️ Vui lòng nhập số giây hợp lệ cần cắt đầu!');
      return;
    }
    setIsTrimming(true);
    try {
      showToast(`✂️ Đang cắt ${sec}s đầu video bằng FFmpeg và tải lên lại S3...`);
      const res = await fetch('/api/videos/trim-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id, trim_seconds: sec }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Cắt video thất bại');
      showToast('🎉 Đã cắt đầu video thành công!');
      if (data.video) {
        const fresh = (data.video.stream_url || data.video.s3_url || streamUrl);
        setStreamUrl(`${fresh}?t=${Date.now()}`);
        if (data.video.s3_url) setS3Url(data.video.s3_url);
      }
      onUpdateSuccess();
    } catch (err: any) {
      showToast(`❌ Lỗi cắt video: ${err.message}`);
    } finally {
      setIsTrimming(false);
    }
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
          width: '960px',
          maxWidth: '95vw',
          height: 'min(740px, 92vh)',
          maxHeight: '92vh',
          padding: '20px 24px',
          borderRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          overflow: 'hidden',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Header */}
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

        {/* Grid: 270px Video on Left, Content on Right */}
        <div
          className="modal-body-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '270px 1fr',
            gap: '20px',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '16px 2px 16px 0',
            alignItems: 'start',
          }}
        >
          {/* Left Column: Video Player */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <div
              id="videoPlayerContainer"
              style={{
                background: '#000',
                borderRadius: '12px',
                overflow: 'hidden',
                width: '100%',
                maxWidth: '270px',
                maxHeight: '480px',
                aspectRatio: '9/16',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--border)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
            >
              {streamUrl ? (
                <video
                  src={streamUrl}
                  controls
                  autoPlay
                  style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block', borderRadius: '12px' }}
                />
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Chưa có file video</div>
              )}
            </div>
          </div>

          {/* Right Column: Fields */}
          <div
            id="videoModalRightColumn"
            style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', paddingRight: '8px', width: '100%' }}
          >
            {/* Vietnamese Caption */}
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

            {/* Hashtags */}
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

            {/* Image Gallery */}
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

            {/* S3 Link */}
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

        {/* Footer */}
        <div
          id="videoModalFooter"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            paddingTop: '14px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg2)',
            flexShrink: 0,
            width: '100%',
            marginTop: 0,
          }}
        >
          <div id="videoModalFooterLeft" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-cancel"
              onClick={handleDelete}
              style={{
                background: 'rgba(239,68,68,0.1)',
                color: '#f87171',
                border: '1px solid rgba(239,68,68,0.2)',
                padding: '8px 12px',
                fontSize: '12px',
                borderRadius: '8px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              🗑️ Delete
            </button>

            <button
              type="button"
              onClick={handleVoiceSync}
              disabled={isVoiceSyncing}
              style={{
                background: 'rgba(124,58,237,0.15)',
                color: '#a78bfa',
                border: '1px solid rgba(124,58,237,0.35)',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <span>{isVoiceSyncing ? '⏳ Đang lồng giọng...' : '🎙️ Lồng Giọng AI'}</span>
            </button>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '3px 6px',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }} title="Thời gian cắt bỏ ở đầu video">
                ✂️ Cắt đầu:
              </span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={trimSeconds}
                onChange={(e) => setTrimSeconds(e.target.value)}
                style={{
                  width: '46px',
                  padding: '3px 4px',
                  fontSize: '11px',
                  background: 'var(--bg2)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  textAlign: 'center',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>s</span>
              <button
                type="button"
                onClick={handleTrimStart}
                disabled={isTrimming}
                style={{
                  background: 'rgba(245,158,11,0.15)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.35)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>{isTrimming ? '⏳ Cắt...' : '✂️ Cắt & Up lại'}</span>
              </button>
            </div>
          </div>

          <div id="videoModalFooterRight" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '8px', whiteSpace: 'nowrap' }}
            >
              Close
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
                padding: '8px 14px',
                fontSize: '12px',
                borderRadius: '8px',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{isSaving ? 'Saving...' : '💾 Save'}</span>
            </button>
            <button
              type="button"
              className="btn-submit"
              onClick={handlePublish}
              disabled={isPublishing || isPublished}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 700,
                borderRadius: '8px',
                whiteSpace: 'nowrap',
                opacity: isPublished ? 0.6 : 1,
              }}
            >
              <span>{isPublished ? '✓ Published' : isPublishing ? 'Publishing...' : '📱 Publish to TikTok'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
