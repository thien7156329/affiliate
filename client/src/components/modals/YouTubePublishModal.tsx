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

interface YouTubePublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTitle?: string;
  defaultDescription?: string;
  defaultTags?: string[];
  defaultThumbnailUrl?: string;
  videoPath?: string;
  videoUrl?: string;
  videoId?: string;
  youtubeVideoId?: string;
  sceneImages?: string[];
  episodes?: EpisodeOption[];
  initialTarget?: string;
  onSuccess?: (result: any) => void;
}

export function cleanStoryDescription(rawDesc?: string, title: string = ''): string {
  if (!rawDesc || typeof rawDesc !== 'string') {
    return title
      ? `Cùng theo dõi câu chuyện hoạt hình chibi đáng yêu: "${title}". Chúc các bạn xem video vui vẻ!\n\n#hoathinh #chibi #shorts`
      : 'Video hoạt hình chibi đáng yêu.\n\n#hoathinh #chibi #shorts';
  }

  // Remove forbidden YouTube characters '<' and '>'
  const trimmed = rawDesc.replace(/[<>]/g, '').trim();

  // If it's a JSON string or contains AI prompt directives
  if (
    trimmed.startsWith('{') ||
    trimmed.includes('"prompt1"') ||
    trimmed.includes('CHARACTER BIBLE') ||
    trimmed.includes('Cinematic 3D Pixar') ||
    trimmed.includes('DUB_TIMELINE:')
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
        const storyTitle = parsed.story_title || title || 'Câu Chuyện Chibi';
        const storyTheme = parsed.story_theme || '';

        const highlights: string[] = [];
        for (let i = 1; i <= 20; i++) {
          const d = parsed[`dialogue${i}`];
          if (d && typeof d === 'string') {
            const firstLine = d.split('\n')[0]?.trim();
            if (firstLine && highlights.length < 3) {
              highlights.push(firstLine);
            }
          }
        }

        let summary = `Cùng theo dõi câu chuyện hoạt hình chibi đáng yêu: "${storyTitle}".`;
        if (storyTheme) {
          summary += `\n${storyTheme}`;
        } else {
          summary += `\nMột câu chuyện dễ thương, ấm áp và ngập tràn tiếng cười của các bạn nhỏ!`;
        }

        if (highlights.length > 0) {
          summary += `\n\n💬 Điểm nhấn câu chuyện:\n` + highlights.map((l) => `• ${l}`).join('\n');
        }

        summary += `\n\nĐừng quên nhấn Like & Đăng ký kênh để đón xem những tập mới nhất nhé!\n#hoathinh #chibi #shorts`;
        return summary;
      }
    } catch {
      // Fallback
    }

    return title
      ? `Cùng theo dõi câu chuyện hoạt hình chibi đáng yêu: "${title}".\nMột câu chuyện dễ thương, ấm áp và ngập tràn tiếng cười của các bạn nhỏ!\n\nĐừng quên nhấn Like & Đăng ký kênh để đón xem những tập mới nhất nhé!\n#hoathinh #chibi #shorts`
      : 'Câu chuyện hoạt hình chibi dễ thương dành cho các bạn nhỏ.\n\n#hoathinh #chibi #shorts';
  }

  return trimmed;
}

export const YouTubePublishModal: React.FC<YouTubePublishModalProps> = memo(({
  isOpen,
  onClose,
  defaultTitle = '',
  defaultDescription = '',
  defaultTags = [],
  defaultThumbnailUrl = '',
  videoPath = '',
  videoUrl = '',
  videoId = '',
  youtubeVideoId = '',
  sceneImages = [],
  episodes = [],
  initialTarget,
  onSuccess,
}) => {
  const { showToast } = useToast();

  // YouTube Account Status
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [channelTitle, setChannelTitle] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Upload Form
  const [selectedTarget, setSelectedTarget] = useState<'full' | 'all' | string>('full');
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(() => cleanStoryDescription(defaultDescription, defaultTitle));
  const [tags, setTags] = useState(defaultTags.join(', '));
  const [thumbnailUrl, setThumbnailUrl] = useState<string>(defaultThumbnailUrl);
  const [privacyStatus, setPrivacyStatus] = useState<'public' | 'unlisted' | 'private'>('public');
  const [madeForKids, setMadeForKids] = useState(false); // Default: No, it's not made for kids
  const [categoryId, setCategoryId] = useState('1'); // 1: Film & Animation

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [publishedResults, setPublishedResults] = useState<Array<{ title: string; url: string; shortsUrl?: string }>>([]);
  const [currentYtVideoId, setCurrentYtVideoId] = useState(youtubeVideoId);
  const [isUpdatingThumb, setIsUpdatingThumb] = useState(false);

  const checkStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/youtube/status');
      const data = await res.json();
      if (data.success) {
        setIsConfigured(Boolean(data.configured));
        setIsAuthenticated(Boolean(data.authenticated));
        setChannelTitle(data.channelTitle || '');
        setAvatarUrl(data.avatarUrl || '');
      }
    } catch (err: any) {
      console.error('Error fetching YouTube status:', err);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
      setTitle(defaultTitle);
      setDescription(cleanStoryDescription(defaultDescription, defaultTitle));
      setTags(defaultTags.join(', '));
      setThumbnailUrl(defaultThumbnailUrl || '');
      setSelectedTarget(initialTarget || 'full');
      setMadeForKids(false);
      setCurrentYtVideoId(youtubeVideoId || '');
      setPublishedResults([]);
      setIsUploading(false);
    }
  }, [isOpen, defaultTitle, defaultDescription, defaultTags, defaultThumbnailUrl, initialTarget, youtubeVideoId]);

  // Listen for OAuth success popup callback or window focus
  useEffect(() => {
    const handleAuthMessage = (e: MessageEvent) => {
      if (e.data?.type === 'YOUTUBE_AUTH_SUCCESS') {
        showToast('🎉 Đã xác thực kênh YouTube thành công!');
        checkStatus();
      }
    };
    const handleWindowFocus = () => {
      if (isOpen && !isAuthenticated) {
        checkStatus();
      }
    };
    window.addEventListener('message', handleAuthMessage);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('message', handleAuthMessage);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [isOpen, isAuthenticated, showToast]);



  const handleConnectYoutube = async () => {
    try {
      const res = await fetch('/api/youtube/auth-url');
      const data = await res.json();
      if (data.success && data.url) {
        const w = 600;
        const h = 700;
        const left = window.screen.width / 2 - w / 2;
        const top = window.screen.height / 2 - h / 2;
        window.open(data.url, 'YouTubeAuthPopup', `width=${w},height=${h},top=${top},left=${left}`);
      } else {
        showToast('❌ ' + (data.error || 'Chưa tạo được URL đăng nhập Google'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi kết nối YouTube: ' + err.message);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/youtube/disconnect', { method: 'POST' });
      showToast('🔌 Đã hủy liên kết tài khoản YouTube');
      checkStatus();
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    }
  };

  const handleUpload = async () => {
    if (!title.trim()) {
      showToast('⚠️ Vui lòng nhập tiêu đề video!');
      return;
    }

    setIsUploading(true);
    setPublishedResults([]);

    try {
      // 1. Determine videos to upload
      const queue: Array<{ title: string; url?: string; path?: string; thumbnailUrl?: string }> = [];

      if (selectedTarget === 'all' && episodes.length > 0) {
        // Upload all episodes
        episodes.forEach((ep, idx) => {
          queue.push({
            title: `${title} - ${ep.title || `Tập ${idx + 1}`} #Shorts`,
            url: ep.video_url,
            path: ep.local_path,
            thumbnailUrl: ep.thumbnail_url || thumbnailUrl || defaultThumbnailUrl,
          });
        });
      } else if (selectedTarget !== 'full' && episodes.length > 0) {
        // Single specific episode
        const found = episodes.find((e) => e.id === selectedTarget);
        if (found) {
          queue.push({
            title: `${title} - ${found.title} #Shorts`,
            url: found.video_url,
            path: found.local_path,
            thumbnailUrl: found.thumbnail_url || thumbnailUrl || defaultThumbnailUrl,
          });
        }
      } else {
        // Full Story Video
        const fullTitle = /#shorts/i.test(title) ? title.trim() : `${title.trim()} #Shorts`;
        queue.push({
          title: fullTitle,
          url: videoUrl,
          path: videoPath,
          thumbnailUrl: thumbnailUrl || defaultThumbnailUrl,
        });
      }

      if (queue.length === 0) {
        throw new Error('Không xác định được video để upload');
      }

      const results: Array<{ title: string; url: string; shortsUrl?: string }> = [];

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setUploadProgressText(`🚀 Đang upload (${i + 1}/${queue.length}): "${item.title}"...`);
        showToast(`🚀 Đang đăng video ${i + 1}/${queue.length} lên YouTube...`);

        const res = await fetch('/api/youtube/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_id: videoId || undefined,
            video_url: item.url,
            local_path: item.path,
            thumbnail_url: item.thumbnailUrl || undefined,
            title: item.title.replace(/[<>]/g, '').trim().slice(0, 100),
            description: description.replace(/[<>]/g, '').trim().slice(0, 5000),
            tags: tags.replace(/[<>]/g, ''),
            privacy_status: privacyStatus,
            made_for_kids: madeForKids,
            category_id: categoryId,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json();
        if (data.success) {
          if (data.videoId) {
            setCurrentYtVideoId(data.videoId);
          }
          results.push({
            title: item.title,
            url: data.youtubeUrl || `https://www.youtube.com/watch?v=${data.videoId}`,
            shortsUrl: data.shortsUrl,
          });
        } else {
          throw new Error(data.error || 'Server error');
        }
      }

      setPublishedResults(results);
      const successMsg =
        results.length === 1
          ? `🎉 Đã đăng thành công "${results[0].title}" lên YouTube!`
          : `🎉 Đã đăng thành công toàn bộ ${results.length} video lên YouTube!`;
      showToast(successMsg, 8000);
      onSuccess?.(results);

      // Tự động đóng modal sau 3s để admin xem thông báo thành công
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (err: any) {
      showToast('❌ Lỗi upload YouTube: ' + err.message, 8000);
    } finally {
      setIsUploading(false);
      setUploadProgressText('');
    }
  };

  const handleUpdateThumbnailDirectly = async (targetId: string) => {
    if (!thumbnailUrl) {
      showToast('⚠️ Vui lòng chọn ảnh Avatar / Thumbnail trước!');
      return;
    }
    setIsUpdatingThumb(true);
    try {
      const res = await fetch('/api/youtube/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: targetId,
          thumbnail_url: thumbnailUrl,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('🎉 Đã cập nhật Avatar lên YouTube thành công!');
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      showToast('❌ Lỗi cập nhật Avatar: ' + err.message, 7000);
    } finally {
      setIsUpdatingThumb(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-overlay open"
      style={{ zIndex: 10050 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '680px',
          maxWidth: '92vw',
          maxHeight: '92vh',
          background: 'var(--bg2)',
          borderRadius: '16px',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>🎬</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                Đăng Video Lên YouTube (YouTube Data API v3)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Upload trực tiếp vào kênh, tự động gắn thẻ Shorts, tối ưu cho phim hoạt hình thiếu nhi
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Channel Connection Status Card */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '10px',
              background: isAuthenticated ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${isAuthenticated ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.35)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Channel" style={{ width: '36px', height: '36px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)' }} />
              ) : (
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                  📺
                </div>
              )}
              <div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: isAuthenticated ? '#34d399' : isConfigured ? '#f87171' : '#fbbf24' }}>
                  {loadingStatus
                    ? '⏳ Đang kiểm tra trạng thái YouTube...'
                    : isAuthenticated
                    ? `✅ Đã kết nối: ${channelTitle}`
                    : isConfigured
                    ? '⚠️ Chưa kết nối kênh YouTube'
                    : '⚙️ Chưa cấu hình YouTube API trong .env'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {isAuthenticated
                    ? 'Sẵn sàng upload video lên YouTube bằng OAuth 2.0'
                    : isConfigured
                    ? 'Bấm "Đăng Nhập Google" để cấp quyền upload video vào kênh'
                    : 'Thêm YOUTUBE_CLIENT_ID & YOUTUBE_CLIENT_SECRET vào file .env'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {!isAuthenticated ? (
                <button
                  type="button"
                  onClick={handleConnectYoutube}
                  disabled={!isConfigured}
                  title={!isConfigured ? 'Vui lòng thêm YOUTUBE_CLIENT_ID và YOUTUBE_CLIENT_SECRET vào .env' : 'Đăng nhập Google'}
                  style={{
                    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                    color: '#fff',
                    border: 'none',
                    padding: '7px 16px',
                    borderRadius: '8px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: isConfigured ? 'pointer' : 'not-allowed',
                    opacity: isConfigured ? 1 : 0.5,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  🔗 Đăng Nhập Google
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Đăng Xuất
                </button>
              )}
            </div>
          </div>

          {/* Video Selection (If episodes exist) */}
          {episodes.length > 0 && (
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: '6px' }}>
                🎯 Chọn Video Xuất Bản Lên YouTube:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: selectedTarget === 'full' ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg3)',
                    border: `1.5px solid ${selectedTarget === 'full' ? '#6366f1' : 'var(--border)'}`,
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    fontWeight: 600,
                  }}
                >
                  <input
                    type="radio"
                    name="ytTarget"
                    checked={selectedTarget === 'full'}
                    onChange={() => setSelectedTarget('full')}
                    style={{ accentColor: '#6366f1' }}
                  />
                  <span>🎬 Bản Full Story</span>
                </label>

                {episodes.map((ep, idx) => (
                  <label
                    key={ep.id || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: selectedTarget === ep.id ? 'rgba(236, 72, 153, 0.2)' : 'var(--bg3)',
                      border: `1.5px solid ${selectedTarget === ep.id ? '#ec4899' : 'var(--border)'}`,
                      cursor: 'pointer',
                      fontSize: '11.5px',
                      fontWeight: 600,
                    }}
                  >
                    <input
                      type="radio"
                      name="ytTarget"
                      checked={selectedTarget === ep.id}
                      onChange={() => setSelectedTarget(ep.id)}
                      style={{ accentColor: '#ec4899' }}
                    />
                    <span>✂️ {ep.title} (Shorts)</span>
                  </label>
                ))}

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: selectedTarget === 'all' ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg3)',
                    border: `1.5px solid ${selectedTarget === 'all' ? '#10b981' : 'var(--border)'}`,
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    fontWeight: 600,
                  }}
                >
                  <input
                    type="radio"
                    name="ytTarget"
                    checked={selectedTarget === 'all'}
                    onChange={() => setSelectedTarget('all')}
                    style={{ accentColor: '#10b981' }}
                  />
                  <span>🚀 Toàn Bộ ({episodes.length} Tập Shorts)</span>
                </label>
              </div>
            </div>
          )}

          {/* Form Fields */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Tiêu đề YouTube (Title):</label>
              <span style={{ fontSize: '10.5px', color: title.length > 90 ? '#ef4444' : 'var(--muted)' }}>{title.length}/100</span>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Thỏ và Rùa | Hoạt Hình 3D Chibi Ngụ Ngôn #Shorts"
              maxLength={100}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px' }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Mô tả video (Description):</label>
              <button
                type="button"
                onClick={() => {
                  setDescription(cleanStoryDescription('', title));
                  showToast('✨ Đã tạo tóm tắt câu chuyện mới gọn gàng!');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#818cf8',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  textDecoration: 'underline',
                }}
              >
                ✨ Tạo tóm tắt câu chuyện
              </button>
            </div>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tóm tắt ngắn gọn nội dung câu chuyện cho khán giả xem YouTube..."
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px', resize: 'vertical', lineHeight: '1.45' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>
              💡 Tóm tắt ngắn gọn cốt truyện cho khán giả YouTube (không phải prompt AI tạo video).
            </div>
          </div>

          {/* Avatar / Thumbnail Section */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>
                🖼️ Ảnh bìa / Avatar video (Thumbnail):
              </label>
              <span style={{ fontSize: '10.5px', color: 'var(--muted)' }}>Tỷ lệ 16:9 hoặc 9:16 (JPG, PNG)</span>
            </div>

            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
              <div
                style={{
                  width: '84px',
                  height: '84px',
                  borderRadius: '8px',
                  border: '1px dashed var(--border)',
                  background: 'var(--bg3)',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt="Thumbnail preview"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '6px' }}>
                    <div style={{ fontSize: '20px' }}>🖼️</div>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>Chưa có ảnh</div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <label
                    style={{
                      cursor: 'pointer',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#a5b4fc',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    📁 Tải ảnh từ máy
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === 'string') {
                              setThumbnailUrl(reader.result);
                              showToast('🖼️ Đã chọn ảnh bìa mới!');
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>

                  {thumbnailUrl && (
                    <button
                      type="button"
                      onClick={() => setThumbnailUrl('')}
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        borderRadius: '6px',
                        color: '#f87171',
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '5px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      ✕ Bỏ ảnh
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: '1.35' }}>
                  Ảnh này sẽ tự động đặt làm hình đại diện (avatar/thumbnail) cho video trên YouTube.
                </div>

                {sceneImages && sceneImages.filter(Boolean).length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '5px', fontWeight: 600 }}>
                      ✨ Chọn nhanh Avatar từ các cảnh hoạt hình:
                    </div>
                    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                      {sceneImages.filter(Boolean).map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setThumbnailUrl(img);
                            showToast(`🖼️ Đã chọn Cảnh ${idx + 1} làm Avatar!`);
                          }}
                          style={{
                            border: thumbnailUrl === img ? '2px solid #3b82f6' : '1px solid var(--border)',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            padding: 0,
                            background: 'none',
                            cursor: 'pointer',
                            flexShrink: 0,
                            width: '44px',
                            height: '44px',
                            position: 'relative',
                          }}
                          title={`Cảnh ${idx + 1}`}
                        >
                          <img src={img} alt={`Scene ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <span style={{ position: 'absolute', bottom: 1, right: 2, fontSize: '9px', background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '0 2px', borderRadius: '2px' }}>
                            {idx + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {currentYtVideoId && (
                  <div style={{ marginTop: '6px' }}>
                    <button
                      type="button"
                      disabled={isUpdatingThumb}
                      onClick={() => handleUpdateThumbnailDirectly(currentYtVideoId)}
                      style={{
                        background: 'rgba(16, 185, 129, 0.15)',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        borderRadius: '6px',
                        color: '#34d399',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        padding: '6px 12px',
                        cursor: isUpdatingThumb ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      {isUpdatingThumb ? '⏳ Đang cập nhật Avatar...' : '🔄 Đặt lại Avatar này cho video đã đăng trên YouTube'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Tags (ngăn cách bằng dấu phẩy):</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="truyen thieu nhi, hoat hinh 3d, shorts, ngu ngon, ke chuyen be"
              style={{ width: '100%', padding: '7px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Chế độ hiển thị (Privacy):</label>
              <select
                value={privacyStatus}
                onChange={(e) => setPrivacyStatus(e.target.value as any)}
                style={{ width: '100%', padding: '7px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px' }}
              >
                <option value="public">🌐 Công khai (Public)</option>
                <option value="unlisted">🔗 Không công khai (Unlisted)</option>
                <option value="private">🔒 Riêng tư (Private)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Thể loại (Category):</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px' }}
              >
                <option value="1">🎬 Phim & Hoạt họa (Film & Animation)</option>
                <option value="24">🎪 Giải trí (Entertainment)</option>
                <option value="27">🎓 Giáo dục (Education)</option>
                <option value="15">🐾 Động vật & Thú cưng (Pets & Animals)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>
              👶 Đối tượng người xem (Audience):
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  background: !madeForKids ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg3)',
                  border: !madeForKids ? '1.5px solid #3b82f6' : '1px solid var(--border)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="radio"
                  name="madeForKids"
                  checked={!madeForKids}
                  onChange={() => setMadeForKids(false)}
                  style={{ accentColor: '#3b82f6', width: '16px', height: '16px', marginTop: '2px' }}
                />
                <div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: !madeForKids ? '#60a5fa' : 'var(--text)' }}>
                    🚫 No, it's not made for kids
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                    Không dành riêng cho trẻ em (Mặc định: bật bình luận & đề xuất Shorts)
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  background: madeForKids ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg3)',
                  border: madeForKids ? '1.5px solid #3b82f6' : '1px solid var(--border)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="radio"
                  name="madeForKids"
                  checked={madeForKids}
                  onChange={() => setMadeForKids(true)}
                  style={{ accentColor: '#3b82f6', width: '16px', height: '16px', marginTop: '2px' }}
                />
                <div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: madeForKids ? '#60a5fa' : 'var(--text)' }}>
                    👶 Yes, it's made for kids
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                    Nội dung dành riêng cho trẻ em (Tắt bình luận & thông báo)
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Success Results Card */}
          {publishedResults.length > 0 && (
            <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.4)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#34d399' }}>
                🎉 Đã đăng thành công lên YouTube:
              </div>
              {publishedResults.map((res, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg2)', padding: '6px 10px', borderRadius: '6px', fontSize: '12px' }}>
                  <span style={{ fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                    {res.title}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <a
                      href={res.shortsUrl || res.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#ef4444', fontWeight: 700, textDecoration: 'none', background: 'rgba(239, 68, 68, 0.15)', padding: '3px 8px', borderRadius: '4px' }}
                    >
                      ▶️ Mở YouTube
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg3)',
          }}
        >
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
            {uploadProgressText || 'YouTube Data API v3 • Upload an toàn qua Google OAuth'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={isUploading}
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={isUploading || !isAuthenticated}
              style={{
                background: isUploading ? '#6b7280' : 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                color: '#fff',
                border: 'none',
                padding: '8px 18px',
                borderRadius: '8px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: isUploading || !isAuthenticated ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: isUploading ? 'none' : '0 2px 10px rgba(239, 68, 68, 0.4)',
              }}
            >
              {isUploading ? (
                <>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <span>Đang Upload...</span>
                </>
              ) : (
                <>
                  <span>🚀 Đăng Lên YouTube</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});
