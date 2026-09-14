import React, { memo } from 'react';
import { VideoItem } from '../../types';
import { getDisplayImageUrl } from '../../utils/image';
import { useToast } from '../../context/ToastContext';

interface VideoCardProps {
  video: VideoItem;
  fallbackImageUrl?: string;
  onPlay: (video: VideoItem) => void;
  onRefresh: () => void;
  onPublish: (id: string) => void;
}

export const VideoCard: React.FC<VideoCardProps> = memo(({
  video,
  fallbackImageUrl = '',
  onPlay,
  onRefresh,
  onPublish,
}) => {
  const { showToast } = useToast();
  const initialSrc = video.thumbnail_url || (video.images && video.images.length > 0 ? video.images[0] : '') || fallbackImageUrl;
  const displaySrc = getDisplayImageUrl(initialSrc);
  const fallbackSrc = getDisplayImageUrl(fallbackImageUrl);

  const handleCopyS3 = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!video.s3_url) {
      showToast('⚠️ Video chưa có link S3!');
      return;
    }
    navigator.clipboard.writeText(video.s3_url).then(() => {
      showToast('📋 Đã sao chép link S3 vào clipboard!');
    }).catch(() => {
      showToast('❌ Không thể sao chép');
    });
  };

  const handleQuickTrim = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Cắt bỏ 0.6s frame đầu của video này và tải lên lại S3?')) return;
    try {
      showToast('✂️ Đang cắt 0.6s đầu video và tải lên lại S3...');
      const res = await fetch('/api/videos/trim-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id, trim_seconds: 0.6 }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Cắt video thất bại');
      showToast('🎉 Đã cắt 0.6s đầu và cập nhật video thành công!');
      onRefresh();
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    }
  };

  const handlePublishClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPublish(video.id);
  };

  return (
    <div
      className="video-card"
      onClick={() => onPlay(video)}
      style={{ cursor: 'pointer', transition: 'transform 0.15s ease' }}
    >
      <div className="video-thumb">
        {displaySrc && (
          <img
            src={displaySrc}
            alt={video.title || 'Video'}
            onError={(e) => {
              const target = e.currentTarget;
              if (fallbackSrc && target.src !== fallbackSrc) {
                target.src = fallbackSrc;
              } else {
                target.style.display = 'none';
              }
            }}
            style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, display: 'block' }}
          />
        )}
        <div className="play-btn">▶</div>
        <div className="ai-badge">AI • Veo</div>
      </div>

      <div className="video-info" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
        <div
          className="video-title"
          style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={video.title || 'Untitled'}
        >
          {video.title || 'Untitled'}
        </div>

        <div
          className="video-desc"
          style={{
            fontSize: '12px',
            color: 'var(--muted)',
            marginTop: '6px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.4,
          }}
          title={video.description || ''}
        >
          {video.description || 'No description available'}
        </div>

        <div
          className="video-tags"
          style={{
            fontSize: '11px',
            color: '#a78bfa',
            marginTop: '6px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={(video.tags || []).join(' ')}
        >
          {(video.tags || []).join(' ')}
        </div>

        <div className="video-meta" style={{ marginTop: 'auto', paddingTop: '10px' }}>
          <span className="tag success">✓ Generated</span>
          <span className="tag">
            {new Date(video.created_at || Date.now()).toLocaleDateString('vi-VN')}
          </span>
        </div>
      </div>

      <div className="video-actions" style={{ marginTop: '12px', display: 'flex', gap: '6px' }}>
        <button
          type="button"
          className="btn-action"
          onClick={handleCopyS3}
          title="Sao chép link S3"
        >
          📋 Copy
        </button>
        <button
          type="button"
          className="btn-action"
          onClick={handleQuickTrim}
          style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
          title="Cắt bỏ 0.6s frame đầu video bị khựng và tải lên S3 lại"
        >
          ✂️ Cắt đầu
        </button>
        <button
          type="button"
          className="btn-action primary"
          onClick={handlePublishClick}
        >
          📱 Publish
        </button>
      </div>
    </div>
  );
});
