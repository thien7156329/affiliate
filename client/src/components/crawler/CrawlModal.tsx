import React, { useState } from 'react';
import { ProductCategory } from '../../types';
import { useToast } from '../../context/ToastContext';

interface CrawlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCrawlSuccess: () => void;
}

export const CrawlModal: React.FC<CrawlModalProps> = ({
  isOpen,
  onClose,
  onCrawlSuccess,
}) => {
  const { showToast } = useToast();
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<ProductCategory>('tech');
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawledData, setCrawledData] = useState<any>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleCrawl = async () => {
    if (!url.trim() || !url.startsWith('http')) {
      showToast('⚠️ Vui lòng dán đường link sản phẩm hợp lệ bắt đầu bằng http...');
      return;
    }

    setIsCrawling(true);
    setCrawledData(null);
    try {
      showToast('🕷️ Đang cào dữ liệu sản phẩm từ link...');
      const res = await fetch('/api/crawl/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        const d = data.data;
        setCrawledData(d);
        setEditName(d.name || '');
        setEditDescription(d.aiDescription || d.rawDescription || '');
        setEditHashtags((d.hashtags || []).join(', '));
        if (d.category) setCategory(d.category);
        showToast('✅ Cào dữ liệu sản phẩm thành công!');
      } else {
        showToast('❌ Lỗi cào sản phẩm: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi kết nối: ' + err.message);
    } finally {
      setIsCrawling(false);
    }
  };

  const handleRegenerateDesc = async () => {
    if (!crawledData) return;
    setIsRegenerating(true);
    try {
      showToast('✨ AI đang viết lại mô tả kịch bản bán hàng hấp dẫn...');
      const payload = {
        name: editName || crawledData.name,
        rawDescription: crawledData.rawDescription || '',
        price: crawledData.price || '',
        rating: crawledData.rating || '',
        ratingCount: crawledData.ratingCount || '',
        platform: crawledData.platform || 'shopee.vn',
      };
      const res = await fetch('/api/crawl/regenerate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.aiDescription) {
        setEditDescription(data.aiDescription);
        if (data.hashtags && data.hashtags.length) {
          setEditHashtags(data.hashtags.join(', '));
        }
        showToast('✅ Đã tối ưu mô tả với AI!');
      }
    } catch (err: any) {
      showToast('❌ Lỗi AI: ' + err.message);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!editName.trim()) {
      showToast('⚠️ Tên sản phẩm không được để trống');
      return;
    }
    setIsSaving(true);
    try {
      showToast('💾 Đang lưu sản phẩm vào hệ thống...');
      const hashtags = editHashtags
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter(Boolean)
        .map((h) => (h.startsWith('#') ? h : `#${h}`));

      const payload = {
        name: editName.trim(),
        category,
        affiliate_url: crawledData?.sourceUrl || url,
        hashtags,
        description: editDescription.trim(),
        image_url: crawledData?.image_url || (crawledData?.images && crawledData?.images[0]) || '',
        images: crawledData?.images || [],
      };

      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && (data.success || data.id || data.data)) {
        showToast('🎉 Đã lưu sản phẩm thành công!');
        onCrawlSuccess();
        onClose();
      } else {
        showToast('❌ Lưu thất bại: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay open" id="crawlModalOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '640px', maxWidth: '96vw', padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '19px' }}>🕷️ Import từ Link</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Crawl thông tin sản phẩm + AI viết lại nội dung</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCrawl()}
            placeholder="https://shopee.vn/... hoặc lazada.vn/..."
            style={{ flex: 1, padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '13px', outline: 'none' }}
          />
          <button
            type="button"
            className="btn-generate"
            onClick={handleCrawl}
            disabled={isCrawling}
            style={{ padding: '12px 20px', whiteSpace: 'nowrap', borderRadius: '10px', fontSize: '13px', fontWeight: 700 }}
          >
            {isCrawling ? '⏳ Đang crawl...' : '🔍 Crawl'}
          </button>
        </div>

        {isCrawling && (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙️</div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Đang crawl trang...</div>
            <div style={{ fontSize: '12px', marginTop: '6px', opacity: 0.7 }}>Puppeteer đang tải trang, khoảng 15-30 giây...</div>
          </div>
        )}

        {crawledData && !isCrawling && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <div style={{ width: '72px', height: '72px', borderRadius: '10px', background: 'var(--bg2)', flexShrink: 0, overflow: 'hidden', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>
                {(crawledData.image_url || (crawledData.images && crawledData.images[0])) ? (
                  <img src={crawledData.image_url || crawledData.images[0]} alt="Product" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  '📦'
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px' }}>{editName || '—'}</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  {crawledData.price && <span style={{ color: '#f59e0b', fontSize: '12px', fontWeight: 600 }}>{crawledData.price}</span>}
                  {crawledData.rating && <span style={{ color: 'var(--muted)', fontSize: '12px' }}>⭐ {crawledData.rating}</span>}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`pill ${category}`}>{category}</span>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{editHashtags}</span>
                </div>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>🤖 AI Caption (Vietnamese)</span>
                <button
                  type="button"
                  onClick={handleRegenerateDesc}
                  disabled={isRegenerating}
                  style={{
                    background: 'rgba(16,185,129,0.15)',
                    border: '1px solid rgba(16,185,129,0.3)',
                    color: 'var(--success)',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontWeight: 600,
                    outline: 'none',
                    padding: '3px 10px',
                    borderRadius: '12px',
                  }}
                >
                  {isRegenerating ? '⏳ Generating...' : '✨ Gemini Enhanced'}
                </button>
              </div>
              <textarea
                rows={6}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                style={{ width: '100%', padding: '12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: '13px', lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Tên sản phẩm</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ margin: 0 }}
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}>
                  <option value="tech">Tech</option>
                  <option value="beauty">Beauty</option>
                  <option value="fashion">Fashion</option>
                  <option value="food">Food</option>
                  <option value="fitness">Fitness</option>
                  <option value="toys">Toys</option>
                  <option value="household">Household</option>
                  <option value="baby">Baby</option>
                  <option value="pets">Pets</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label>Hashtags (cách nhau bởi dấu phẩy)</label>
              <input
                type="text"
                value={editHashtags}
                onChange={(e) => setEditHashtags(e.target.value)}
                placeholder="#beauty, #skincare..."
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn-cancel" onClick={onClose}>
                Huỷ
              </button>
              <button type="button" className="btn-submit" onClick={handleSaveProduct} disabled={isSaving}>
                {isSaving ? '⏳ Đang lưu...' : '💾 Lưu Product'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
