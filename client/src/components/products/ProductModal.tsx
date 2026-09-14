import React, { useState, useEffect, useRef } from 'react';
import { Product, ProductCategory } from '../../types';
import { useToast } from '../../context/ToastContext';
import { getDisplayImageUrl } from '../../utils/image';

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  productToEdit?: Product | null;
  onSaveSuccess: () => void;
  onZoomImage?: (url: string) => void;
}

const CATEGORIES: { label: string; value: ProductCategory }[] = [
  { label: 'Tech', value: 'tech' },
  { label: 'Beauty', value: 'beauty' },
  { label: 'Fashion', value: 'fashion' },
  { label: 'Food', value: 'food' },
  { label: 'Fitness', value: 'fitness' },
  { label: 'Toys', value: 'toys' },
  { label: 'Household', value: 'household' },
  { label: 'Baby', value: 'baby' },
  { label: 'Pets', value: 'pets' },
];

export const ProductModal: React.FC<ProductModalProps> = ({
  isOpen,
  onClose,
  productToEdit,
  onSaveSuccess,
  onZoomImage,
}) => {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProductCategory>('tech');
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [thumbError, setThumbError] = useState(false);

  useEffect(() => {
    if (productToEdit) {
      setName(productToEdit.name || '');
      setCategory(productToEdit.category || 'tech');
      setAffiliateUrl(productToEdit.affiliate_url || '');
      // Strip '#' for easy comma-separated display editing like legacy web
      const tagsClean = (productToEdit.hashtags || []).map((h) => h.replace(/^#/, '')).join(', ');
      setHashtags(tagsClean);
      setDescription(productToEdit.description || '');
      const mainImg = productToEdit.image_url || (productToEdit.images && productToEdit.images[0]) || '';
      setImageUrl(mainImg);
      setGalleryImages(productToEdit.images || (mainImg ? [mainImg] : []));
      setThumbError(false);
      setUploadStatus('');
    } else {
      setName('');
      setCategory('tech');
      setAffiliateUrl('');
      setHashtags('');
      setDescription('');
      setImageUrl('');
      setGalleryImages([]);
      setThumbError(false);
      setUploadStatus('');
    }
  }, [productToEdit, isOpen]);

  useEffect(() => {
    setThumbError(false);
  }, [imageUrl]);

  if (!isOpen) return null;

  // Upload main product image
  const handleUploadMainImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus('⏳ Uploading...');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
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
        setImageUrl(data.url);
        setThumbError(false);
        setGalleryImages((prev) => (prev.includes(data.url) ? prev : [...prev, data.url]));
        setUploadStatus('');
        showToast('✅ Tải ảnh sản phẩm thành công!');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err: any) {
      setUploadStatus('');
      showToast('❌ Lỗi tải ảnh: ' + err.message);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  // Upload gallery image
  const handleUploadGalleryImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      showToast('⏳ Đang tải ảnh vào thư viện...');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
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
        setGalleryImages((prev) => (prev.includes(data.url) ? prev : [...prev, data.url]));
        if (!imageUrl) {
          setImageUrl(data.url);
        }
        showToast('✅ Đã thêm ảnh vào bộ sưu tập!');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err: any) {
      showToast('❌ Lỗi tải ảnh thư viện: ' + err.message);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleRemoveGalleryImage = (src: string) => {
    const next = galleryImages.filter((img) => img !== src);
    setGalleryImages(next);
    if (imageUrl === src) {
      setImageUrl(next[0] || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm!');
      return;
    }

    // Process hashtags (clean & relevant, comma/space separated, auto-extract fallback)
    let finalHashtags: string[] = [];
    if (hashtags.trim()) {
      finalHashtags = hashtags
        .split(/[\s,]+/)
        .map((t) => {
          const clean = t.trim();
          if (!clean) return '';
          return clean.startsWith('#') ? clean : `#${clean}`;
        })
        .filter(Boolean);
    } else {
      const words = trimmedName.toLowerCase().split(/[\s,\-\|_\/\+]+/).map((w) => w.trim()).filter(Boolean);
      const stopWords = new Set(['cho', 'cua', 'voi', 'nhu', 'va', 'nhung', 'chinh', 'hang', 'tot', 'nhat', 'sieu', 'hot', 'gia', 're', 'mua', 'ban', 'new', 'pro', 'max', 'full', 'size']);
      const extracted: string[] = [];
      words.forEach((w) => {
        const clean = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');
        if (clean.length >= 3 && !stopWords.has(clean) && !/^\d+$/.test(clean)) {
          extracted.push(`#${clean}`);
        }
      });
      finalHashtags = [...new Set(extracted)].slice(0, 3);
      if (finalHashtags.length === 0) finalHashtags = ['#affiliate'];
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        category,
        affiliate_url: affiliateUrl.trim(),
        hashtags: finalHashtags,
        image_url: imageUrl.trim(),
        images: galleryImages.length > 0 ? galleryImages : (imageUrl.trim() ? [imageUrl.trim()] : []),
        description: description.trim(),
      };

      const url = productToEdit ? `/api/products/${productToEdit.id}` : '/api/products';
      const method = productToEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && (data.success || data.id || data.data)) {
        showToast(productToEdit ? `✏️ Product "${trimmedName}" updated successfully!` : `📦 Product "${trimmedName}" added successfully!`);
        onSaveSuccess();
        onClose();
      } else {
        showToast('❌ Failed: ' + (data.error || 'Server error'));
      }
    } catch (err: any) {
      showToast('❌ Error: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isImgValid = Boolean(imageUrl && imageUrl.trim().startsWith('http') && !thumbError);

  return (
    <div className="modal-overlay open" id="productModalOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '580px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
          <div>
            <h2 id="productModalHeading" style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>
              {productToEdit ? '✏️ Edit Product' : '📦 Add Product'}
            </h2>
            <p id="productModalSubheading" style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
              {productToEdit ? 'Update your affiliate product details' : 'Add a new product to your affiliate listings'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '24px', cursor: 'pointer', lineHeight: 1, padding: 0 }}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Product Image (At top like legacy web) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Product Image (Optional)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
              {/* 64x64 Square Thumbnail with Box fallback */}
              <div
                id="prodImageThumb"
                onClick={() => {
                  if (isImgValid && onZoomImage) {
                    onZoomImage(getDisplayImageUrl(imageUrl));
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                title={isImgValid ? '🔍 Click phóng to ảnh / Click Upload để đổi' : 'Click để tải ảnh lên'}
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '10px',
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '26px',
                  flexShrink: 0,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                {isImgValid ? (
                  <img
                    src={getDisplayImageUrl(imageUrl)}
                    alt="Thumbnail"
                    onError={() => setThumbError(true)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span>📦</span>
                )}
              </div>

              {/* Input + Upload Button */}
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  id="prodInputImageUrl"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="Image URL (auto-filled on upload)"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginBottom: '6px',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: 'rgba(124,58,237,0.15)',
                      border: '1px solid rgba(124,58,237,0.3)',
                      color: '#a78bfa',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    📤 Upload File
                  </button>
                  {uploadStatus && <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{uploadStatus}</span>}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadMainImage}
                    style={{ display: 'none' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Gallery Images Section */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', display: 'block' }}>
              Gallery Images (Click to set as main thumbnail)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {galleryImages.map((src, idx) => (
                <div
                  key={src + idx}
                  style={{
                    position: 'relative',
                    width: '56px',
                    height: '56px',
                    borderRadius: '8px',
                    border: imageUrl === src ? '2px solid #8b5cf6' : '1px solid var(--border)',
                    overflow: 'visible',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={getDisplayImageUrl(src)}
                    alt="Gallery item"
                    onClick={() => setImageUrl(src)}
                    title="Click để đặt làm ảnh đại diện chính"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '7px', cursor: 'pointer' }}
                  />
                  {/* Delete Badge */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveGalleryImage(src);
                    }}
                    title="Xóa ảnh khỏi gallery"
                    style={{
                      position: 'absolute',
                      top: '-5px',
                      right: '-5px',
                      background: '#ef4444',
                      color: 'white',
                      borderRadius: '50%',
                      width: '16px',
                      height: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    }}
                  >
                    &times;
                  </div>
                </div>
              ))}

              {/* Add to Gallery Button */}
              <div
                onClick={() => galleryInputRef.current?.click()}
                title="Tải thêm ảnh vào Gallery"
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '8px',
                  border: '1.5px dashed rgba(124,58,237,0.5)',
                  background: 'var(--bg3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#a78bfa',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
              >
                +
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleUploadGalleryImage}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          {/* Product Name */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Product Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sony WH-1000XM5 Headphones"
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Category */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProductCategory)}
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Affiliate Link (Optional) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Affiliate Link (Optional)
            </label>
            <input
              type="text"
              value={affiliateUrl}
              onChange={(e) => setAffiliateUrl(e.target.value)}
              placeholder="https://shope.ee/..."
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Hashtags (comma separated, Optional) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Hashtags (comma separated, Optional)
            </label>
            <input
              type="text"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="sony, headphones, tech"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Description (Optional) */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Description (Optional)
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter product description..."
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
                fontSize: '13px',
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Modal Footer */}
          <div className="modal-footer" style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn-cancel" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-submit"
              disabled={isSubmitting}
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
                color: '#fff',
                border: 'none',
                padding: '9px 20px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting ? 'Saving...' : productToEdit ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
