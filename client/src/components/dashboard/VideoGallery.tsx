import React from 'react';
import { VideoItem, Product } from '../../types';
import { VideoCard } from './VideoCard';

interface VideoGalleryProps {
  videos: VideoItem[];
  products?: Product[];
  currentPage: number;
  totalPages: number;
  isLoading: boolean;
  videoFormatTab?: 'short' | 'long';
  onChangeVideoFormatTab?: (tab: 'short' | 'long') => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onOpenConcatModal: () => void;
  onPlayVideo: (video: VideoItem) => void;
  onPublishVideo: (id: string) => void;
}

export const VideoGallery: React.FC<VideoGalleryProps> = ({
  videos,
  products = [],
  currentPage,
  totalPages,
  isLoading,
  videoFormatTab = 'short',
  onChangeVideoFormatTab,
  onPageChange,
  onRefresh,
  onOpenConcatModal,
  onPlayVideo,
  onPublishVideo,
}) => {
  return (
    <div id="sectionDashboard">
      <div className="section-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h2>{videoFormatTab === 'long' ? '🖥️ Kho Video Dài (16:9)' : '📱 Kho Video Shorts (9:16)'}</h2>
          {onChangeVideoFormatTab && (
            <div
              style={{
                display: 'inline-flex',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '10px',
                padding: '3px',
                gap: '4px',
              }}
            >
              <button
                type="button"
                onClick={() => onChangeVideoFormatTab('short')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 700,
                  background: videoFormatTab === 'short' ? '#0284c7' : 'transparent',
                  color: videoFormatTab === 'short' ? '#ffffff' : '#94a3b8',
                }}
              >
                📱 Video Shorts (9:16)
              </button>
              <button
                type="button"
                onClick={() => onChangeVideoFormatTab('long')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 700,
                  background: videoFormatTab === 'long' ? '#f59e0b' : 'transparent',
                  color: videoFormatTab === 'long' ? '#0f172a' : '#94a3b8',
                }}
              >
                🖥️ Video Dài (16:9 · Lưu Riêng)
              </button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn-sm"
            onClick={onOpenConcatModal}
            style={{
              background: 'rgba(124,58,237,0.15)',
              border: '1px solid rgba(124,58,237,0.3)',
              color: '#a78bfa',
            }}
          >
            🔗 Nối Video
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            {isLoading ? '🔄 Đang tải...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🎬</div>
          <strong>No videos yet</strong>
          <span>Click "Generate Video" to create your first AI video</span>
        </div>
      ) : (
        <div className="video-grid">
          {videos.map((v) => {
            let fallbackUrl = '';
            if (products.length > 0) {
              const normalizeStr = (str: string) => (str || '').normalize('NFC').trim().toLowerCase();
              const vTitleNorm = normalizeStr(v.title);
              const prod = products.find((p) => {
                const pNameNorm = normalizeStr(p.name);
                return pNameNorm === vTitleNorm || vTitleNorm.includes(pNameNorm) || pNameNorm.includes(vTitleNorm);
              });
              if (prod) {
                fallbackUrl = prod.image_url || (prod.images && prod.images.length > 0 ? prod.images[0] : '') || '';
              }
            }

            return (
              <VideoCard
                key={v.id}
                video={v}
                fallbackImageUrl={fallbackUrl}
                onPlay={onPlayVideo}
                onRefresh={onRefresh}
                onPublish={onPublishVideo}
              />
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination-container">
          <button
            type="button"
            className="pagination-btn"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            ← Prev
          </button>
          <span className="pagination-info">
            Trang {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="pagination-btn"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};
