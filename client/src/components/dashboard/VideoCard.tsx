import React, { memo, useState } from 'react';
import { VideoItem } from '../../types';
import { getDisplayImageUrl } from '../../utils/image';
import { useToast } from '../../context/ToastContext';
import { YouTubePublishModal } from '../modals/YouTubePublishModal';
import { FacebookPublishModal } from '../modals/FacebookPublishModal';

interface VideoCardProps {
  video: VideoItem;
  fallbackImageUrl?: string;
  onPlay: (video: VideoItem) => void;
  onRefresh: () => void;
  onPublish?: (id: string) => void;
}

export const VideoCard: React.FC<VideoCardProps> = memo(({
  video,
  fallbackImageUrl = '',
  onPlay,
  onRefresh: _onRefresh,
  onPublish,
}) => {
  const { showToast } = useToast();
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);
  const [showFacebookModal, setShowFacebookModal] = useState(false);


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

  const handlePublishTikTok = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPublish) {
      onPublish(video.id);
    } else {
      try {
        showToast('📱 Đang đăng video lên TikTok...');
        const res = await fetch(`/api/videos/${video.id}/publish`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(`✅ ${data.message || 'Đăng TikTok thành công!'}`);
          if (_onRefresh) _onRefresh();
        } else {
          showToast('❌ ' + (data.error || 'Lỗi đăng TikTok'));
        }
      } catch (err: any) {
        showToast('❌ Lỗi: ' + err.message);
      }
    }
  };

  const handleOpenTrimReview = (e: React.MouseEvent) => {

    e.stopPropagation();
    onPlay(video);
    showToast('✂️ Mở video editor — review điểm cắt trước khi áp dụng.');
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
          {video.youtube_url && (
            <a
              href={video.youtube_shorts_url || video.youtube_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="tag"
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                textDecoration: 'none',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
              }}
              title="Xem trên YouTube"
            >
              🔴 YouTube
            </a>
          )}
          <span className="tag">
            {new Date(video.created_at || Date.now()).toLocaleDateString('vi-VN')}
          </span>
        </div>
      </div>

      <div className="video-actions" style={{ marginTop: '12px', display: 'flex', gap: '6px' }}>
        <button
          type="button"
          className="btn-action"
          onClick={(e) => {
            e.stopPropagation();
            setShowYouTubeModal(true);
          }}
          style={{
            flex: 1,
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#ef4444',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            fontWeight: 700,
            padding: '6px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
          title="Đăng video lên YouTube (Full hoặc Shorts)"
        >
          🔴 YouTube
        </button>
        <button
          type="button"
          className="btn-action"
          onClick={(e) => {
            e.stopPropagation();
            setShowFacebookModal(true);
          }}
          style={{
            flex: 1,
            background: 'rgba(24, 119, 242, 0.15)',
            color: '#60a5fa',
            border: '1px solid rgba(24, 119, 242, 0.35)',
            fontWeight: 700,
            padding: '6px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
          title="Đăng video ngắn lên Facebook Reel / Fanpage"
        >
          🔵 Facebook
        </button>
        <button
          type="button"
          className="btn-action"
          onClick={handlePublishTikTok}
          style={{
            flex: 1,
            background: 'rgba(236, 72, 153, 0.15)',
            color: '#f472b6',
            border: '1px solid rgba(236, 72, 153, 0.35)',
            fontWeight: 700,
            padding: '6px 8px',
            fontSize: '11px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
          }}
          title="Đăng video lên TikTok"
        >
          🎵 TikTok
        </button>
      </div>

      {showYouTubeModal && (
        <YouTubePublishModal
          isOpen={showYouTubeModal}
          onClose={() => setShowYouTubeModal(false)}
          defaultTitle={video.title || ''}
          defaultDescription={video.description || video.caption || ''}
          defaultTags={(video.tags || []).map((t) => t.replace(/^#/, ''))}
          defaultThumbnailUrl={video.thumbnail_url || video.source_image_url || ''}
          videoUrl={video.video_url || video.stream_url || video.s3_url}
          videoId={video.id}
          episodes={video.episodes?.map((ep) => ({
            id: ep.id,
            title: ep.title,
            video_url: ep.voiced_url || ep.video_url,
            local_path: ep.voiced_path || ep.local_path,
            thumbnail_url: ep.thumbnail_url || video.thumbnail_url || video.source_image_url || '',
          }))}
          onSuccess={() => {
            if (_onRefresh) _onRefresh();
          }}
        />
      )}

      {showFacebookModal && (
        <FacebookPublishModal
          isOpen={showFacebookModal}
          onClose={() => setShowFacebookModal(false)}
          defaultTitle={video.title || ''}
          defaultDescription={video.description || video.caption || ''}
          defaultTags={(video.tags || []).map((t) => t.replace(/^#/, ''))}
          defaultThumbnailUrl={video.thumbnail_url || video.source_image_url || ''}
          videoUrl={video.video_url || video.stream_url || video.s3_url}
          videoId={video.id}
          episodes={video.episodes?.map((ep) => ({
            id: ep.id,
            title: ep.title,
            video_url: ep.voiced_url || ep.video_url,
            local_path: ep.voiced_path || ep.local_path,
            thumbnail_url: ep.thumbnail_url || video.thumbnail_url || video.source_image_url || '',
          }))}
          onSuccess={() => {
            if (_onRefresh) _onRefresh();
          }}
        />
      )}
    </div>
  );
});
