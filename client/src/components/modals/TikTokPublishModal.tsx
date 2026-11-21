import React, { useState, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../context/ToastContext';

interface EpisodeOption {
  id: string;
  title: string;
  video_url: string;
  local_path?: string;
  thumbnail_url?: string;
}

interface TikTokPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTitle?: string;
  defaultDescription?: string;
  defaultTags?: string[];
  defaultThumbnailUrl?: string;
  defaultVideoFormat?: 'short' | 'long';
  videoPath?: string;
  videoUrl?: string;
  videoId?: string;
  productId?: string;
  productName?: string;
  episodes?: EpisodeOption[];
  initialTarget?: string;
  onSuccess?: (result: any) => void;
}

export function cleanTikTokDescription(rawDesc?: string, title: string = ''): string {
  if (!rawDesc || typeof rawDesc !== 'string') {
    return title ? `${title}` : 'Video ngắn xu hướng thịnh hành';
  }

  const trimmed = rawDesc.replace(/[<>]/g, '').trim();

  // If it's a JSON string or AI prompt
  if (
    trimmed.startsWith('{') ||
    trimmed.includes('"prompt1"') ||
    trimmed.includes('CHARACTER BIBLE') ||
    trimmed.includes('Cinematic 3D Pixar')
  ) {
    try {
      let parsed: any = null;
      if (trimmed.startsWith('{')) {
        parsed = JSON.parse(trimmed);
      } else {
        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }
      if (parsed) {
        return parsed.story_title || title || 'Video ngắn xu hướng';
      }
    } catch {
      // fallback
    }
  }

  return trimmed.slice(0, 400);
}

export const TikTokPublishModal: React.FC<TikTokPublishModalProps> = memo(({
  isOpen,
  onClose,
  defaultTitle = '',
  defaultDescription = '',
  defaultTags = ['viral', 'xuhuong', 'trending', 'shorts', 'short', 'fyp'],
  defaultThumbnailUrl,
  defaultVideoFormat = 'short',
  videoPath,
  videoUrl,
  videoId,
  productId,
  productName = '',
  episodes = [],
  initialTarget = 'full',
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [tiktokFormat, setTiktokFormat] = useState<'short' | 'long'>(defaultVideoFormat);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [mode, setMode] = useState<'post' | 'draft'>('post');
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'private'>('public');
  const [selectedTarget, setSelectedTarget] = useState<string>('full');

  const [isUploading, setIsUploading] = useState(false);
  const [isLaunchingChrome, setIsLaunchingChrome] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<{
    loading: boolean;
    connected: boolean;
    loggedIn: boolean;
    username?: string;
    message?: string;
  }>({
    loading: true,
    connected: false,
    loggedIn: false,
  });

  const buildTikTokTagsForFormat = (fmt: 'short' | 'long') => {
    const base =
      defaultTags && defaultTags.length > 0
        ? defaultTags.map((t) => t.replace(/^#+/, '').toLowerCase())
        : fmt === 'long'
        ? ['kienthuc', 'giaima', 'xuhuong', 'trending', 'videodai', 'fyp']
        : ['viral', 'xuhuong', 'trending', 'shorts', 'short', 'fyp'];
    if (fmt === 'long') {
      const filtered = base.filter((t) => t !== 'shorts' && t !== 'short');
      if (!filtered.includes('videodai')) filtered.unshift('videodai');
      if (!filtered.includes('kienthuc')) filtered.unshift('kienthuc');
      return Array.from(new Set(filtered)).join(' ');
    }
    return Array.from(new Set(base)).join(' ');
  };

  const handleSwitchTikTokFormat = (fmt: 'short' | 'long') => {
    setTiktokFormat(fmt);
    setTags(buildTikTokTagsForFormat(fmt));
  };

  // Check TikTok connection on open
  useEffect(() => {
    if (!isOpen) return;

    // Reset fields
    const initialTitle = defaultTitle || productName || (defaultVideoFormat === 'long' ? 'Video Chuyên Sâu 16:9' : 'Video Ngắn Xu Hướng');
    setTiktokFormat(defaultVideoFormat);
    setTitle(initialTitle);
    setCaption(cleanTikTokDescription(defaultDescription, initialTitle));
    setTags(buildTikTokTagsForFormat(defaultVideoFormat));
    setSelectedTarget(initialTarget || 'full');
    setVisibility('public');
    setIsUploading(false);
    setIsLaunchingChrome(false);
    setUploadProgressText('');

    // Fetch status
    fetchTikTokStatus();
  }, [isOpen, defaultTitle, defaultDescription, defaultTags, defaultVideoFormat, productName, initialTarget]);

  const fetchTikTokStatus = async () => {
    setConnectionStatus((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/tiktok/status');
      const data = await res.json();
      setConnectionStatus({
        loading: false,
        connected: data.connected ?? false,
        loggedIn: data.loggedIn ?? false,
        username: data.username,
        message: data.message,
      });
    } catch (err: any) {
      setConnectionStatus({
        loading: false,
        connected: false,
        loggedIn: false,
        message: 'Không thể kết nối đến API: ' + err.message,
      });
    }
  };

  const handleLaunchChrome = async () => {
    setIsLaunchingChrome(true);
    showToast('🚀 Đang khởi động Chrome TikTok Studio...');
    try {
      const res = await fetch('/api/tiktok/launch-chrome', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Đã mở Chrome TikTok Studio!');
        await fetchTikTokStatus();
      } else {
        showToast('⚠️ ' + (data.message || 'Không thể mở Chrome'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    } finally {
      setIsLaunchingChrome(false);
    }
  };

  if (!isOpen) return null;

  // Selected video file / URL
  const isTargetEpisode = selectedTarget !== 'full' && episodes.length > 0;
  const currentEpisode = isTargetEpisode
    ? episodes.find((ep) => ep.id === selectedTarget)
    : null;

  const activeVideoUrl = currentEpisode ? currentEpisode.video_url : videoUrl;
  const activeVideoPath = currentEpisode ? currentEpisode.local_path : videoPath;

  const handlePublish = async () => {
    if (!title.trim()) {
      showToast('⚠️ Vui lòng nhập tiêu đề video!');
      return;
    }

    if (!activeVideoUrl && !activeVideoPath) {
      showToast('⚠️ Không tìm thấy nguồn video để tải lên!');
      return;
    }

    setIsUploading(true);
    setUploadProgressText('🤖 Đang kết nối Puppeteer với TikTok Studio...');

    try {
      const tagArray = tags
        .split(/[,\s]+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      setUploadProgressText(
        mode === 'post'
          ? '🚀 Đang nạp video và đăng công khai lên kênh TikTok...'
          : '📝 Đang nạp video và lưu bản nháp vào TikTok Studio...'
      );

      const res = await fetch('/api/tiktok/publish-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: activeVideoPath,
          video_url: activeVideoUrl,
          video_id: videoId,
          product_id: productId,
          product_name: productName,
          title: title.trim(),
          caption: caption.trim(),
          tags: tagArray,
          mode: mode,
          video_format: tiktokFormat,
          visibility: visibility,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi khi upload lên TikTok');
      }

      showToast(
        mode === 'post'
          ? '🎉 Đã đăng video thành công lên trang cá nhân TikTok!'
          : '✅ Đã lưu bản nháp video thành công vào TikTok Studio!',
        7000
      );

      if (onSuccess) onSuccess(data);
      onClose();
    } catch (err: any) {
      console.error('TikTok publish error:', err);
      showToast('❌ Thất bại: ' + err.message);
    } finally {
      setIsUploading(false);
      setUploadProgressText('');
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #18181b 0%, #09090b 100%)',
          border: '1px solid rgba(254, 44, 85, 0.35)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(254, 44, 85, 0.15)',
          overflow: 'hidden',
          color: '#f4f4f5',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(254, 44, 85, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #000000 0%, #111111 100%)',
                border: '1px solid rgba(254, 44, 85, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                boxShadow: '0 0 12px rgba(254, 44, 85, 0.4)',
              }}
            >
              🎵
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#fff' }}>
                Đăng Video Lên TikTok (Puppeteer Bot)
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#a1a1aa' }}>
                Tự động hóa hoàn toàn — không cần duyệt API, đăng thẳng lên kênh cá nhân
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a1a1aa',
              fontSize: '22px',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              padding: '4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* Status connection bar */}
          <div
            style={{
              background: connectionStatus.loggedIn
                ? 'rgba(16, 185, 129, 0.12)'
                : 'rgba(239, 68, 68, 0.12)',
              border: `1px solid ${
                connectionStatus.loggedIn
                  ? 'rgba(16, 185, 129, 0.3)'
                  : 'rgba(239, 68, 68, 0.3)'
              }`,
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{connectionStatus.loggedIn ? '🟢' : '🔴'}</span>
              <span>
                <strong>Trạng thái TikTok Studio:</strong>{' '}
                {connectionStatus.loading
                  ? 'Đang kiểm tra kết nối Chrome...'
                  : connectionStatus.loggedIn
                  ? `Đã đăng nhập: ${connectionStatus.username || 'Tài khoản hoạt động'}`
                  : connectionStatus.message}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {!connectionStatus.loggedIn && (
                <button
                  type="button"
                  onClick={handleLaunchChrome}
                  disabled={isLaunchingChrome || connectionStatus.loading}
                  style={{
                    background: 'linear-gradient(135deg, #fe2c55 0%, #25f4ee 100%)',
                    border: 'none',
                    color: '#ffffff',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: isLaunchingChrome ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 8px rgba(254, 44, 85, 0.3)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  {isLaunchingChrome ? '⏳ Đang mở...' : '🚀 Mở Chrome TikTok'}
                </button>
              )}
              <button
                type="button"
                onClick={fetchTikTokStatus}
                disabled={connectionStatus.loading}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#e4e4e7',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                🔄 Làm mới
              </button>
            </div>
          </div>

          {/* Episode selector if available */}
          {episodes.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Chọn Bản Video Cần Đăng:
              </label>
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: '#27272a',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '13px',
                }}
              >
                <option value="full">🎬 Bản Full Video Hoàn Chỉnh</option>
                {episodes.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    📱 {ep.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Quick Format Toggle: Short (9:16) vs Long (16:9) */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
              📐 Định Dạng Nội Dung (Short / Long):
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div
                onClick={() => handleSwitchTikTokFormat('short')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: `2px solid ${tiktokFormat === 'short' ? '#fe2c55' : 'rgba(255,255,255,0.1)'}`,
                  background: tiktokFormat === 'short' ? 'rgba(254, 44, 85, 0.14)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '13px', color: tiktokFormat === 'short' ? '#ff3b5c' : '#fff' }}>
                  📱 Short Video (9:16)
                </div>
                <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '2px' }}>
                  Video ngắn dọc chuẩn xu hướng #shorts #fyp
                </div>
              </div>

              <div
                onClick={() => handleSwitchTikTokFormat('long')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: `2px solid ${tiktokFormat === 'long' ? '#38bdf8' : 'rgba(255,255,255,0.1)'}`,
                  background: tiktokFormat === 'long' ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '13px', color: tiktokFormat === 'long' ? '#7dd3fc' : '#fff' }}>
                  🖥️ Long Video Màn Ngang (16:9)
                </div>
                <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '2px' }}>
                  Video dài chuyên sâu Full-screen 16:9 #videodai #kienthuc
                </div>
              </div>
            </div>
          </div>

          {/* Posting Mode (Publish vs Draft) */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
              Chế Độ Đăng Bài:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div
                onClick={() => setMode('post')}
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  border: `2px solid ${mode === 'post' ? '#fe2c55' : 'rgba(255,255,255,0.1)'}`,
                  background: mode === 'post' ? 'rgba(254, 44, 85, 0.12)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '13px', color: mode === 'post' ? '#ff3b5c' : '#fff', marginBottom: '3px' }}>
                  🚀 Đăng Ngay (Công khai)
                </div>
                <div style={{ fontSize: '11px', color: '#a1a1aa' }}>
                  Video sẽ được xuất bản công khai ngay lập tức lên kênh cá nhân của bạn.
                </div>
              </div>

              <div
                onClick={() => setMode('draft')}
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  border: `2px solid ${mode === 'draft' ? '#25f4ee' : 'rgba(255,255,255,0.1)'}`,
                  background: mode === 'draft' ? 'rgba(37, 244, 238, 0.1)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '13px', color: mode === 'draft' ? '#25f4ee' : '#fff', marginBottom: '3px' }}>
                  📝 Lưu Bản Nháp (TikTok Studio)
                </div>
                <div style={{ fontSize: '11px', color: '#a1a1aa' }}>
                  Lưu vào mục bản nháp để bạn kiểm tra hoặc gắn link TikTok Shop trên điện thoại trước khi đăng.
                </div>
              </div>
            </div>
          </div>

          {/* Privacy / Visibility Setting */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
              Quyền Riêng Tư (Ai có thể xem video):
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              <div
                onClick={() => setVisibility('public')}
                style={{
                  padding: '10px 8px',
                  borderRadius: '10px',
                  border: `2px solid ${visibility === 'public' ? '#10b981' : 'rgba(255,255,255,0.1)'}`,
                  background: visibility === 'public' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '12px', color: visibility === 'public' ? '#34d399' : '#fff', marginBottom: '2px' }}>
                  🌐 Mọi người (Public)
                </div>
                <div style={{ fontSize: '10px', color: '#a1a1aa' }}>Công khai lên feed TikTok</div>
              </div>

              <div
                onClick={() => setVisibility('friends')}
                style={{
                  padding: '10px 8px',
                  borderRadius: '10px',
                  border: `2px solid ${visibility === 'friends' ? '#3b82f6' : 'rgba(255,255,255,0.1)'}`,
                  background: visibility === 'friends' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '12px', color: visibility === 'friends' ? '#60a5fa' : '#fff', marginBottom: '2px' }}>
                  👥 Bạn bè (Friends)
                </div>
                <div style={{ fontSize: '10px', color: '#a1a1aa' }}>Follower tương hỗ</div>
              </div>

              <div
                onClick={() => setVisibility('private')}
                style={{
                  padding: '10px 8px',
                  borderRadius: '10px',
                  border: `2px solid ${visibility === 'private' ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`,
                  background: visibility === 'private' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '12px', color: visibility === 'private' ? '#fbbf24' : '#fff', marginBottom: '2px' }}>
                  🔒 Chỉ mình bạn (Private)
                </div>
                <div style={{ fontSize: '10px', color: '#a1a1aa' }}>Riêng tư chỉ mình xem</div>
              </div>
            </div>
          </div>

          {/* Title */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Tiêu Đề Video:
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề video..."
              style={{
                width: '100%',
                padding: '9px 12px',
                backgroundColor: '#27272a',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Caption / Description */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Mô Tả & Kịch Bản Hài:
            </label>
            <textarea
              rows={3}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Nhập mô tả tóm tắt..."
              style={{
                width: '100%',
                padding: '9px 12px',
                backgroundColor: '#27272a',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Tags */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Hashtags (cách nhau bởi dấu cách hoặc phẩy):
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="MayTV HaiHuoc 3DAnimation comedy viral fyp..."
              style={{
                width: '100%',
                padding: '9px 12px',
                backgroundColor: '#27272a',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Progress message if uploading */}
          {isUploading && (
            <div
              style={{
                padding: '12px 16px',
                background: 'rgba(254, 44, 85, 0.15)',
                border: '1px solid rgba(254, 44, 85, 0.4)',
                borderRadius: '10px',
                color: '#ff6b8b',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontWeight: 600,
              }}
            >
              <span className="spinner" style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>
                ⏳
              </span>
              <span>{uploadProgressText}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            style={{
              padding: '9px 18px',
              backgroundColor: '#27272a',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              color: '#d4d4d8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isUploading ? 'not-allowed' : 'pointer',
            }}
          >
            Hủy Bỏ
          </button>

          <button
            type="button"
            onClick={handlePublish}
            disabled={isUploading || !connectionStatus.loggedIn}
            style={{
              padding: '9px 22px',
              background: isUploading
                ? '#52525b'
                : 'linear-gradient(135deg, #fe2c55 0%, #25f4ee 100%)',
              border: 'none',
              borderRadius: '8px',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: isUploading || !connectionStatus.loggedIn ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: isUploading ? 'none' : '0 4px 15px rgba(254, 44, 85, 0.4)',
            }}
          >
            {isUploading
              ? '⏳ Đang Tải Lên...'
              : mode === 'post'
              ? '🚀 Đăng Ngay Lên TikTok'
              : '📝 Lưu Vào Bản Nháp'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
});
