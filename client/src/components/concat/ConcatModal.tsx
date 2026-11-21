import React, { useState } from 'react';
import { VideoItem } from '../../types';
import { getDisplayImageUrl } from '../../utils/image';
import { useToast } from '../../context/ToastContext';

interface ConcatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConcatSuccess: () => void;
  availableVideos?: VideoItem[];
}

export const ConcatModal: React.FC<ConcatModalProps> = ({
  isOpen,
  onClose,
  onConcatSuccess,
  availableVideos = [],
}) => {
  const { showToast } = useToast();
  const [concatSequence, setConcatSequence] = useState<VideoItem[]>([]);
  const [outputTitle, setOutputTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMerging, setIsMerging] = useState(false);

  if (!isOpen) return null;

  const handleToggleVideo = (v: VideoItem) => {
    setConcatSequence((prev) => {
      const exists = prev.some((item) => item.id === v.id);
      if (exists) {
        return prev.filter((item) => item.id !== v.id);
      } else {
        return [...prev, v];
      }
    });
  };

  const handleRemoveItem = (index: number) => {
    setConcatSequence((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveItem = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= concatSequence.length) return;
    const copy = [...concatSequence];
    const temp = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = temp;
    setConcatSequence(copy);
  };

  const handleUploadLocalVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    showToast(`⏳ Đang tải ${files.length} video lên server...`);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const res = await fetch('/api/upload/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, filename: file.name }),
        });
        const data = await res.json();
        if (data.success && data.url) {
          const newItem: VideoItem = {
            id: `local_${Date.now()}_${i}`,
            title: data.title || file.name.replace(/\.[^/.]+$/, ''),
            stream_url: data.url,
            s3_url: data.url,
            thumbnail_url: '',
          };
          (newItem as any).local_path = data.local_path || undefined;
          setConcatSequence((prev) => [...prev, newItem]);
          showToast(`✅ Đã thêm: ${file.name}`);
        } else {
          showToast(`❌ Tải thất bại: ${data.error || 'Upload error'}`);
        }
      } catch (err: any) {
        showToast(`❌ Lỗi tải file: ${err.message}`);
      }
    }
  };

  const handleMerge = async () => {
    if (concatSequence.length < 2) {
      showToast('⚠️ Cần ít nhất 2 clip video để nối!');
      return;
    }

    setIsMerging(true);
    try {
      showToast('🎬 Đang ghép video bằng FFmpeg, vui lòng chờ...');
      const videoPaths = concatSequence.map((v) => (v as any).local_path || v.stream_url || v.s3_url || '').filter(Boolean);
      const videoIds = concatSequence.map((v) => v.id);

      const res = await fetch('/api/videos/concat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_paths: videoPaths,
          video_ids: videoIds,
          video_urls: videoPaths,
          title: outputTitle.trim() || 'Merged Video',
        }),
      });
      const data = await res.json();
      if (data.success && data.video) {
        showToast('🎉 Nối video thành công!');
        onConcatSuccess();
        onClose();
      } else {
        showToast('❌ Nối video thất bại: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    } finally {
      setIsMerging(false);
    }
  };

  const filteredVideos = availableVideos.filter((v) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const t = (v.title || '').toLowerCase();
    const d = (v.description || '').toLowerCase();
    return t.includes(q) || d.includes(q);
  });

  return (
    <div className="modal-overlay open" id="concatModalOverlay">
      <div className="modal" style={{ width: '960px', maxWidth: '96vw', padding: '26px', borderRadius: '20px', display: 'flex', flexDirection: 'column', gap: '18px', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>🎬 Ghép / Nối Video (Video Sequence Stitcher)</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Kéo thả hoặc bấm chọn các video để xếp theo thứ tự từ TRÁI sang PHẢI</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label>Tên Video Ghép (Title) *</label>
          <input
            type="text"
            placeholder="e.g. Câu chuyện Bé Meow Đi Học (Tập 1 - Full)"
            value={outputTitle}
            onChange={(e) => setOutputTitle(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '14px', outline: 'none' }}
          />
        </div>

        {/* Timeline */}
        <div style={{ background: 'var(--bg3)', border: '2px dashed #7c3aed', borderRadius: '14px', padding: '16px', minHeight: '180px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              🎞️ Thứ tự video được ghép (Từ Trái ➔ Phải)
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label
                style={{
                  background: 'rgba(124,58,237,0.2)',
                  border: '1px solid rgba(124,58,237,0.4)',
                  color: '#a78bfa',
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '6px 14px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>📤 Tải Video từ Máy Tính</span>
                <input type="file" accept="video/*" multiple onChange={handleUploadLocalVideo} style={{ display: 'none' }} />
              </label>
              {concatSequence.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConcatSequence([])}
                  style={{
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    color: '#f87171',
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  🗑️ Xóa tất cả
                </button>
              )}
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{concatSequence.length} video được chọn</span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '12px',
              maxHeight: '280px',
              overflowY: 'auto',
              padding: '10px 4px',
              minHeight: '120px',
            }}
          >
            {concatSequence.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', fontSize: '13px', padding: '24px 0' }}>
                🎯 <strong>Tải video từ máy tính</strong> hoặc <strong>Bấm chọn video bên dưới</strong> để xếp thứ tự ghép (tự động xuống dòng)
              </div>
            ) : (
              concatSequence.map((v, idx) => (
                <div
                  key={idx}
                  style={{
                    position: 'relative',
                    width: '100%',
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, background: 'rgba(124,58,237,0.25)', color: '#a78bfa', padding: '3px 8px', borderRadius: '6px', border: '1px solid rgba(124,58,237,0.3)' }}>
                      #{idx + 1} • Cảnh {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: '50%', width: '22px', height: '22px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {v.thumbnail_url ? (
                      <img src={getDisplayImageUrl(v.thumbnail_url)} alt="Thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '22px' }}>🎬</span>
                    )}
                  </div>

                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.title}>
                    {v.title || 'Untitled'}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', marginTop: '2px' }}>
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveItem(idx, -1)}
                      style={{ flex: 1, padding: '4px 2px', fontSize: '10px', fontWeight: 700, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.3 : 1 }}
                    >
                      ◀ Trái
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      style={{ flex: 1.2, padding: '4px 2px', fontSize: '10px', fontWeight: 700, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', cursor: 'pointer' }}
                    >
                      🗑️ Xóa
                    </button>
                    <button
                      type="button"
                      disabled={idx === concatSequence.length - 1}
                      onClick={() => handleMoveItem(idx, 1)}
                      style={{ flex: 1, padding: '4px 2px', fontSize: '10px', fontWeight: 700, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', cursor: idx === concatSequence.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === concatSequence.length - 1 ? 0.3 : 1 }}
                    >
                      Phải ▶
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Available Videos Pool */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>📦 Danh sách Video hiện có (Bấm để thêm)</span>
            <input
              type="text"
              placeholder="🔍 Tìm video..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ padding: '6px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px', outline: 'none' }}
            />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '12px',
              maxHeight: '220px',
              overflowY: 'auto',
              paddingRight: '4px',
            }}
          >
            {filteredVideos.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', fontSize: '12px', padding: '20px' }}>
                Không có video nào khả dụng
              </div>
            ) : (
              filteredVideos.map((v) => {
                const isSelected = concatSequence.some((item) => item.id === v.id);
                return (
                  <div
                    key={v.id}
                    onClick={() => handleToggleVideo(v)}
                    style={{
                      background: 'var(--bg3)',
                      border: `1px solid ${isSelected ? '#7c3aed' : 'var(--border)'}`,
                      borderRadius: '10px',
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '6px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      {v.thumbnail_url ? (
                        <img src={getDisplayImageUrl(v.thumbnail_url)} alt="Thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: '20px' }}>🎬</span>
                      )}
                      {isSelected && (
                        <div style={{ position: 'absolute', top: '4px', right: '4px', background: '#7c3aed', color: '#fff', fontSize: '10px', fontWeight: 'bold', width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          ✓
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {v.title || 'Untitled'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
          <button type="button" className="btn-cancel" onClick={onClose} disabled={isMerging}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-submit"
            onClick={handleMerge}
            disabled={isMerging || concatSequence.length < 2}
            style={{ boxShadow: '0 0 20px rgba(124,58,237,0.4)' }}
          >
            {isMerging ? 'Đang ghép nối...' : '🚀 Nối Video theo thứ tự'}
          </button>
        </div>
      </div>
    </div>
  );
};
