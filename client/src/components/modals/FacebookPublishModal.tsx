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

interface FacebookPublishModalProps {
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
  episodes?: EpisodeOption[];
  initialTarget?: string;
  onSuccess?: (result: any) => void;
}

export function cleanStoryDescriptionForFB(
  rawDesc?: string,
  title: string = '',
  format: 'short' | 'long' = 'short'
): string {
  const defaultTagTail =
    format === 'long'
      ? '#kienthuc #giaima #xuhuong #trending #videodai #facebookwatch'
      : '#viral #xuhuong #trending #shorts #reels #fyp';

  if (!rawDesc || typeof rawDesc !== 'string') {
    return title ? `${title}\n\n${defaultTagTail}` : `Video xu hướng.\n\n${defaultTagTail}`;
  }

  let trimmed = rawDesc.trim();
  if (format === 'long') {
    trimmed = trimmed.replace(/#(shorts|short|reels|reel)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }

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
        const storyTitle = parsed.story_title || title || 'Video Ngắn Xu Hướng';
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

        let summary = `🎬 ${storyTitle}`;
        if (storyTheme) {
          summary += `\n${storyTheme}`;
        }

        if (highlights.length > 0) {
          summary += `\n\n💬 Điểm nhấn:\n` + highlights.map((l) => `• ${l}`).join('\n');
        }

        summary += `\n\n👉 Nhấn Theo Dõi Fanpage & Thả Tim để đón xem các video mới nhất nhé!\n#viral #xuhuong #trending #shorts #reels #fyp`;
        return summary;
      }
    } catch {}

    return title
      ? `${title}\n\n👉 Nhấn Theo Dõi Fanpage & Thả Tim nhé!\n#viral #xuhuong #trending #shorts #reels #fyp`
      : 'Video ngắn xu hướng.\n\n#viral #xuhuong #trending #shorts #reels #fyp';
  }

  let res = trimmed;
  if (!/#(viral|xuhuong|trending|reels|kienthuc|videodai)\b/i.test(res)) {
    res += `\n\n${defaultTagTail}`;
  }
  return res;
}

export const FacebookPublishModal: React.FC<FacebookPublishModalProps> = memo(({
  isOpen,
  onClose,
  defaultTitle = '',
  defaultDescription = '',
  defaultTags = [],
  defaultThumbnailUrl = '',
  defaultVideoFormat = 'short',
  videoPath = '',
  videoUrl = '',
  videoId = '',
  episodes = [],
  initialTarget,
  onSuccess,
}) => {
  const { showToast } = useToast();

  // FB Status
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pages, setPages] = useState<Array<{ id: string; name: string; category?: string; avatarUrl?: string }>>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [statusError, setStatusError] = useState<string>('');

  // Config editor state (for in-modal token setup)
  const [showConfigEdit, setShowConfigEdit] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [pageIdInput, setPageIdInput] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Form State
  const [videoType, setVideoType] = useState<'reel' | 'feed'>(defaultVideoFormat === 'long' ? 'feed' : 'reel');
  const [selectedTarget, setSelectedTarget] = useState<'full' | 'all' | string>('full');
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(() => cleanStoryDescriptionForFB(defaultDescription, defaultTitle, defaultVideoFormat));

  // Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [publishedResults, setPublishedResults] = useState<Array<{ title: string; url: string; reelUrl?: string }>>([]);

  const checkStatus = async () => {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const res = await fetch('/api/facebook/status');
      const data = await res.json();
      if (data.success) {
        setIsConfigured(Boolean(data.configured));
        setIsAuthenticated(Boolean(data.authenticated));
        setPages(data.pages || []);
        setUserName(data.userName || '');
        if (data.selectedPage?.id) {
          setSelectedPageId(data.selectedPage.id);
        } else if (data.pages && data.pages.length > 0) {
          setSelectedPageId(data.pages[0].id);
        }
        if (data.error && !data.authenticated) {
          setStatusError(data.error);
        }
      } else {
        setIsConfigured(false);
        setIsAuthenticated(false);
        setStatusError(data.error || 'Chưa thể kết nối Facebook API');
      }
    } catch (err: any) {
      console.error('Error fetching Facebook status:', err);
      setStatusError(err.message);
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleSwitchFbMode = (nextType: 'reel' | 'feed') => {
    setVideoType(nextType);
    setDescription(cleanStoryDescriptionForFB(defaultDescription, title || defaultTitle, nextType === 'feed' ? 'long' : 'short'));
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
      setVideoType(defaultVideoFormat === 'long' ? 'feed' : 'reel');
      setTitle(defaultTitle);
      setDescription(cleanStoryDescriptionForFB(defaultDescription, defaultTitle, defaultVideoFormat));
      setSelectedTarget(initialTarget || 'full');
      setPublishedResults([]);
      setIsUploading(false);
      setShowConfigEdit(false);
    }
  }, [isOpen, defaultTitle, defaultDescription, defaultTags, defaultThumbnailUrl, defaultVideoFormat, initialTarget]);

  const handleSaveConfig = async () => {
    if (!tokenInput.trim() && !pageIdInput.trim()) {
      showToast('⚠️ Vui lòng nhập Access Token từ Meta Graph API Explorer');
      return;
    }
    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/facebook/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: tokenInput.trim(),
          page_id: pageIdInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('🎉 Đã cập nhật cấu hình Facebook Token thành công!');
        setShowConfigEdit(false);
        checkStatus();
      } else {
        showToast('❌ ' + (data.error || 'Lỗi lưu cấu hình'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const addHashtag = (tag: string) => {
    if (!description.includes(tag)) {
      setDescription((prev) => `${prev.trim()} ${tag}`);
    }
  };

  const handleUpload = async () => {
    if (!title.trim()) {
      showToast('⚠️ Vui lòng nhập tiêu đề video!');
      return;
    }

    if (!isAuthenticated && pages.length === 0) {
      showToast('⚠️ Chưa có Token Facebook hợp lệ. Vui lòng cấu hình token trước!');
      setShowConfigEdit(true);
      return;
    }

    setIsUploading(true);
    setPublishedResults([]);

    try {
      // 1. Prepare items
      const queue: Array<{ title: string; url?: string; path?: string }> = [];

      if (selectedTarget === 'all' && episodes.length > 0) {
        // Upload all episodes as short videos / Reels
        episodes.forEach((ep, idx) => {
          queue.push({
            title: `${title} - ${ep.title || `Tập ${idx + 1}`}`,
            url: ep.video_url,
            path: ep.local_path,
          });
        });
      } else if (selectedTarget !== 'full' && episodes.length > 0) {
        const found = episodes.find((e) => e.id === selectedTarget);
        if (found) {
          queue.push({
            title: `${title} - ${found.title || 'Tập Video'}`,
            url: found.video_url,
            path: found.local_path,
          });
        }
      }

      if (queue.length === 0) {
        queue.push({
          title: title.trim(),
          url: videoUrl,
          path: videoPath,
        });
      }

      const results: Array<{ title: string; url: string; reelUrl?: string }> = [];

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setUploadProgressText(
          queue.length > 1
            ? `[${i + 1}/${queue.length}] Đang đẩy video "${item.title}" lên Facebook...`
            : `Đang đẩy video "${item.title}" lên Facebook...`
        );

        const res = await fetch('/api/facebook/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_url: item.url,
            local_path: item.path,
            video_id: videoId,
            page_id: selectedPageId,
            title: item.title,
            description: description.trim(),
            video_type: videoType,
          }),
        });

        const data = await res.json();
        if (data.success) {
          results.push({
            title: item.title,
            url: data.postUrl || `https://www.facebook.com/${data.pageId}/videos/${data.videoId}`,
            reelUrl: data.reelUrl,
          });
        } else {
          throw new Error(data.error || 'Facebook API Server Error');
        }
      }

      setPublishedResults(results);
      const successMsg =
        results.length === 1
          ? `🎉 Đã đẩy thành công "${results[0].title}" lên Facebook (${videoType === 'reel' ? 'Reels' : 'Video'})!`
          : `🎉 Đã đẩy thành công toàn bộ ${results.length} video lên Facebook!`;
      showToast(successMsg, 8000);
      onSuccess?.(results);
    } catch (err: any) {
      showToast('❌ Lỗi upload Facebook: ' + err.message, 8000);
    } finally {
      setIsUploading(false);
      setUploadProgressText('');
    }
  };

  if (!isOpen) return null;

  const selectedPage = pages.find((p) => p.id === selectedPageId) || pages[0];

  return createPortal(
    <div
      className="modal-overlay open"
      style={{ zIndex: 10050 }}
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
          border: '1px solid rgba(24, 119, 242, 0.4)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
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
            background: 'linear-gradient(135deg, rgba(24, 119, 242, 0.2) 0%, rgba(59, 130, 246, 0.12) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: '#1877f2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '20px',
                fontWeight: 900,
                boxShadow: '0 4px 12px rgba(24, 119, 242, 0.4)',
              }}
            >
              f
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                Đăng Video Lên Facebook
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 7px',
                    borderRadius: '10px',
                    background: videoType === 'reel' ? '#ec4899' : '#1877f2',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {videoType === 'reel' ? '📱 REELS / SHORTS' : '🎬 FEED VIDEO'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Xuất bản Reels video ngắn hoặc Video chuẩn trực tiếp lên Fanpage
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Fanpage & Account Status Banner */}
          <div
            style={{
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {selectedPage?.avatarUrl ? (
                  <img
                    src={selectedPage.avatarUrl}
                    alt={selectedPage.name}
                    style={{ width: '38px', height: '38px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #1877f2' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      background: 'rgba(24, 119, 242, 0.2)',
                      border: '1px solid rgba(24, 119, 242, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#60a5fa',
                      fontSize: '16px',
                    }}
                  >
                    🚩
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {loadingStatus ? (
                      '⏳ Đang kiểm tra Facebook Token...'
                    ) : isAuthenticated && selectedPage ? (
                      <>
                        {selectedPage.name}
                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                          🟢 Đã kết nối Fanpage
                        </span>
                      </>
                    ) : (
                      <>
                        Chưa cấu hình Token FB
                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
                          🔴 Chưa kết nối
                        </span>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {userName && `Tài khoản Meta: ${userName}`}
                    {selectedPage?.category && ` • ${selectedPage.category}`}
                    {selectedPage?.id && ` • ID: ${selectedPage.id}`}
                    {!isAuthenticated && 'Vui lòng dán Token vào .env hoặc click "Cài đặt Token" bên dưới'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setShowConfigEdit(!showConfigEdit)}
                  style={{
                    background: showConfigEdit ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ⚙️ {showConfigEdit ? 'Đóng cài đặt' : 'Cài đặt Token'}
                </button>
                <button
                  type="button"
                  onClick={checkStatus}
                  disabled={loadingStatus}
                  style={{
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="Kiểm tra lại token"
                >
                  🔄 Refresh
                </button>
              </div>
            </div>

            {/* If user manages multiple Fanpages */}
            {pages.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Chọn Fanpage đăng:</span>
                <select
                  value={selectedPageId}
                  onChange={(e) => setSelectedPageId(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                >
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (ID: {p.id})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Quick Token Config Form */}
            {showConfigEdit && (
              <div
                style={{
                  marginTop: '6px',
                  background: 'var(--bg2)',
                  border: '1px dashed rgba(59, 130, 246, 0.4)',
                  borderRadius: '8px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#60a5fa' }}>
                  🔑 Cấu hình Facebook Access Token (Graph API)
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: '1.4' }}>
                  Bạn có thể dán trực tiếp token từ <b>Meta for Developers &gt; Graph API Explorer</b> vào đây (hoặc mở file <code style={{ color: '#fbbf24' }}>.env</code> thêm biến <code style={{ color: '#fbbf24' }}>FB_ACCESS_TOKEN=...</code>).
                  <br />
                  Các quyền cần thiết: <b style={{ color: '#fff' }}>pages_show_list</b>, <b style={{ color: '#fff' }}>pages_read_engagement</b>, <b style={{ color: '#fff' }}>pages_manage_posts</b>.
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
                    Mã truy cập (Access Token):
                  </label>
                  <input
                    type="password"
                    placeholder="EAAPITKXfkZCIBSu..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--bg3)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
                    ID Fanpage (Tùy chọn - nếu để trống sẽ tự động lấy trang bạn quản lý):
                  </label>
                  <input
                    type="text"
                    placeholder="VD: 100083281234567"
                    value={pageIdInput}
                    onChange={(e) => setPageIdInput(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--bg3)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowConfigEdit(false)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--muted)',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    disabled={isSavingConfig}
                    style={{
                      background: '#1877f2',
                      border: 'none',
                      color: '#fff',
                      padding: '5px 14px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: isSavingConfig ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSavingConfig ? '⏳ Đang lưu...' : '💾 Lưu & Kiểm Tra Token'}
                  </button>
                </div>
              </div>
            )}

            {statusError && !showConfigEdit && (
              <div
                style={{
                  fontSize: '11px',
                  color: '#f87171',
                  background: 'rgba(239, 68, 68, 0.1)',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                }}
              >
                ⚠️ {statusError}
              </div>
            )}
          </div>

          {/* Form Options: Video Type & Target */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Kiểu video: Short / Reels vs Video chuẩn */}
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: 'var(--text)', marginBottom: '5px' }}>
                📐 Chế độ Short (9:16) / Long (16:9):
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => handleSwitchFbMode('reel')}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '7px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    background: videoType === 'reel' ? 'rgba(236, 72, 153, 0.2)' : 'var(--bg3)',
                    border: videoType === 'reel' ? '1.5px solid #ec4899' : '1px solid var(--border)',
                    color: videoType === 'reel' ? '#f472b6' : 'var(--muted)',
                  }}
                >
                  <span>📱 Short / FB Reel</span>
                  <span style={{ fontSize: '9.5px', fontWeight: 500 }}>Video dọc ngắn 9:16</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchFbMode('feed')}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '7px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    background: videoType === 'feed' ? 'rgba(24, 119, 242, 0.2)' : 'var(--bg3)',
                    border: videoType === 'feed' ? '1.5px solid #1877f2' : '1px solid var(--border)',
                    color: videoType === 'feed' ? '#60a5fa' : 'var(--muted)',
                  }}
                >
                  <span>🖥️ Long Video 16:9</span>
                  <span style={{ fontSize: '9.5px', fontWeight: 500 }}>Màn ngang HD / Watch</span>
                </button>
              </div>
            </div>

            {/* Chọn video/tập muốn đăng */}
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: 'var(--text)', marginBottom: '5px' }}>
                Chọn Video / Tập cần đăng:
              </label>
              <select
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '9px 10px',
                  borderRadius: '7px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                }}
              >
                <option value="full">🎬 Bản Full Hoàn Chỉnh (Tất cả scene)</option>
                {episodes.map((ep, idx) => (
                  <option key={ep.id || idx} value={ep.id || String(idx)}>
                    ✂️ {ep.title || `Tập ${idx + 1}`} (Dành cho Reels)
                  </option>
                ))}
                {episodes.length > 1 && (
                  <option value="all">🚀 Đăng TẤT CẢ các tập ({episodes.length} tập Reels)</option>
                )}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: 'var(--text)', marginBottom: '5px' }}>
              Tiêu đề bài đăng Facebook:
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề hấp dẫn cho Facebook..."
              style={{
                width: '100%',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '8px 12px',
                borderRadius: '7px',
                fontSize: '12px',
                fontWeight: 600,
              }}
            />
          </div>

          {/* Description & Hashtags */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text)' }}>
                Nội dung Chú thích (Caption) & Hashtags:
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['#Reels', '#Shorts', '#Viral', '#Trending', '#Chibi'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addHashtag(tag)}
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      color: '#60a5fa',
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    +{tag}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nội dung caption Facebook..."
              style={{
                width: '100%',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '8px 12px',
                borderRadius: '7px',
                fontSize: '11.5px',
                lineHeight: '1.4',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Published Results list */}
          {publishedResults.length > 0 && (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🎉 Đã đăng video lên Facebook thành công!
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                📌 Lưu ý: Video Reels nằm trong tab <b>Thước phim (Reels)</b> của Fanpage. Bạn có thể bấm nút bên dưới để mở xem trực tiếp video vừa đăng:
              </div>
              {publishedResults.map((r, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'var(--bg2)', padding: '8px 12px', borderRadius: '7px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.title}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {r.reelUrl && (
                      <a
                        href={r.reelUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                          color: '#fff',
                          padding: '5px 12px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        📱 Mở Xem Reel
                      </a>
                    )}
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        background: '#1877f2',
                        color: '#fff',
                        padding: '5px 12px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      ▶️ Xem Post
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg3)',
          }}
        >
          <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
            {isUploading && <span>⏳ {uploadProgressText}</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
              disabled={isUploading}
              style={{
                background: 'linear-gradient(135deg, #1877f2 0%, #0064e0 100%)',
                color: '#fff',
                border: 'none',
                padding: '8px 18px',
                borderRadius: '7px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: isUploading ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 3px 12px rgba(24, 119, 242, 0.4)',
                opacity: isUploading ? 0.7 : 1,
              }}
            >
              {isUploading ? '⏳ Đang Đẩy Lên Facebook...' : videoType === 'reel' ? '🚀 Đẩy Lên Facebook Reel' : '🚀 Đẩy Lên Facebook'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});
