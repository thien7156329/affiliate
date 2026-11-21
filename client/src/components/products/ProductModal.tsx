import React, { useState, useEffect, useRef } from 'react';
import { Product, ProductCategory } from '../../types';
import { useToast } from '../../context/ToastContext';
import { getDisplayImageUrl } from '../../utils/image';
import { compressImageFile } from '../../utils/imageCompressor';
import { Lightbox } from '../common/Lightbox';

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
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [galleryUploadStatus, setGalleryUploadStatus] = useState('');
  const [thumbError, setThumbError] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    src: string;
    x: number;
    y: number;
    label: string;
    isMain: boolean;
  } | null>(null);

  const showHoverZoom = (e: React.MouseEvent<HTMLElement>, src: string, label: string, isMain: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const popupWidth = 300;
    const popupHeight = 340;
    let x = rect.right + 12;
    if (x + popupWidth > window.innerWidth - 16) {
      x = Math.max(16, rect.left - popupWidth - 12);
    }
    let y = rect.top - 20;
    if (y + popupHeight > window.innerHeight - 16) {
      y = Math.max(16, window.innerHeight - popupHeight - 16);
    }
    if (y < 16) y = 16;
    setHoverPreview({ src: getDisplayImageUrl(src), x, y, label, isMain });
  };

  // Chỉ sử dụng các Hashtag thực sự có nghĩa và đang có lượng tìm kiếm lớn trên YouTube Shorts & TikTok
  // Tuyệt đối KHÔNG tự ghép bừa tên bài dài hoặc cắt vụn từng chữ đơn vô nghĩa
  const generateMeaningfulViralHashtags = (rawName: string, rawDesc: string): string[] => {
    const tags: string[] = [];
    const addTag = (t: string) => {
      const clean = t.replace(/^#+/, '').trim().toLowerCase();
      if (clean && !tags.includes(`#${clean}`)) {
        tags.push(`#${clean}`);
      }
    };

    const combinedVi = `${rawName} ${rawDesc}`.toLowerCase();

    // 1. Mặc định luôn có bộ hashtag xu hướng chuẩn cho các clip: #viral, #xuhuong, #trending, #shorts
    addTag('viral');
    addTag('xuhuong');
    addTag('trending');
    addTag('shorts');
    addTag('short');
    addTag('fyp');
    addTag('toptrending');

    // 2. Nhóm chủ đề Tài chính / Kiến thức / Đời sống
    if (/(tài chính|tiền|lương|đầu tư|vay|nợ|tiết kiệm)/i.test(combinedVi)) {
      addTag('taichinh');
      addTag('kienthuc');
    }
    if (/(giao thông|đèn đỏ|đèn vàng|phạt|xe máy|ô tô|nghị định)/i.test(combinedVi)) {
      addTag('luatgiaothong');
      addTag('kienthuc');
    }
    if (/(sức khỏe|giảm cân|ăn sáng|bệnh|thói quen|cơ thể)/i.test(combinedVi)) {
      addTag('suckhoe');
      addTag('kienthuc');
    }

    // 3. Nhóm chủ đề Gia đình / Vợ chồng
    if (/(gia đình|vợ chồng|bố chồng|mẹ chồng|nàng dâu|anh tư|chị lụa|ông bảy)/i.test(combinedVi)) {
      addTag('giadinh');
      addTag('vochong');
      addTag('tamsu');
    }

    // 4. Nhóm Thú cưng / Hoạt hình đáng yêu
    if (/(chú mèo|con mèo|mèo con|meow|gấu nâu|gấu trắng|bubu|dudu|cún con|thú cưng)/i.test(combinedVi)) {
      addTag('thucung');
      addTag('meocute');
      addTag('hoathinh3d');
    }

    // 5. Các hashtag nội dung đời sống & kiến thức thực tế được người dùng quan tâm cao trên Shorts / TikTok
    addTag('kienthuc');
    addTag('doisong');
    addTag('khampha');
    addTag('suthatthuvi');
    addTag('kynangsong');
    addTag('meovat');
    addTag('tamlyhoc');
    addTag('baihoccuocsong');

    return tags.slice(0, 16);
  };

  const isBrokenOrMeaninglessTags = (tagList: string[]): boolean => {
    if (!tagList || tagList.length === 0) return true;
    const cleaned = tagList.map((t) => t.replace(/^#+/, '').trim().toLowerCase());
    if (cleaned.length <= 3 && cleaned.every((t) => t.length <= 6)) return true;
    return false;
  };

  useEffect(() => {
    if (productToEdit) {
      setName(productToEdit.name || '');
      setCategory(productToEdit.category || 'tech');
      setAffiliateUrl(productToEdit.affiliate_url || '');
      const existingTags = productToEdit.hashtags || [];
      const smartTags = isBrokenOrMeaninglessTags(existingTags)
        ? generateMeaningfulViralHashtags(productToEdit.name || '', productToEdit.description || '')
        : existingTags;
      const tagsClean = smartTags.map((h) => h.replace(/^#/, '')).join(', ');
      setHashtags(tagsClean);
      setDescription(productToEdit.description || '');
      const mainImg = productToEdit.image_url || (productToEdit.images && productToEdit.images[0]) || '';
      setImageUrl(mainImg);
      setGalleryImages(productToEdit.images || (mainImg ? [mainImg] : []));
      setThumbError(false);
      setUploadStatus('');
      setIsUploadingGallery(false);
      setGalleryUploadStatus('');
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
      setIsUploadingGallery(false);
      setGalleryUploadStatus('');
    }
  }, [productToEdit, isOpen]);

  useEffect(() => {
    setThumbError(false);
  }, [imageUrl]);

  if (!isOpen) return null;

  // Upload main product image (supports multiple files)
  const handleUploadMainImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      let successCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadStatus(`⏳ Đang tải ${i + 1}/${files.length}...`);
        try {
          const { dataUrl } = await compressImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 });
          const res = await fetch('/api/upload/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, filename: file.name }),
          });
          const data = await res.json();
          if (data.success && data.url) {
            successCount++;
            if (i === 0) {
              setImageUrl(data.url);
              setThumbError(false);
            }
            setGalleryImages((prev) => (prev.includes(data.url) ? prev : [...prev, data.url]));
          }
        } catch (singleErr: any) {
          console.error(`Upload error for ${file.name}:`, singleErr);
        }
      }
      setUploadStatus('');
      if (successCount > 0) {
        showToast(`✅ Đã tải lên ${successCount}/${files.length} ảnh!`);
      } else {
        showToast('❌ Tải ảnh thất bại. Vui lòng thử lại!');
      }
    } catch (err: any) {
      setUploadStatus('');
      showToast('❌ Lỗi tải ảnh: ' + err.message);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  // Upload gallery image (supports multiple files with real-time loading feedback)
  const handleUploadGalleryImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsUploadingGallery(true);
    let successCount = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setGalleryUploadStatus(`Đang tải ${i + 1}/${files.length}...`);
        try {
          const { dataUrl } = await compressImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 });
          const res = await fetch('/api/upload/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, filename: file.name }),
          });
          const data = await res.json();
          if (data.success && data.url) {
            successCount++;
            setGalleryImages((prev) => (prev.includes(data.url) ? prev : [...prev, data.url]));
            setImageUrl((prev) => prev || data.url);
          }
        } catch (singleErr: any) {
          console.error(`Lỗi tải ảnh gallery ${file.name}:`, singleErr);
        }
      }
      if (successCount > 0) {
        showToast(`✅ Đã thêm ${successCount}/${files.length} ảnh vào bộ sưu tập!`);
      } else {
        showToast('❌ Không thể tải ảnh lên thư viện. Vui lòng thử lại!');
      }
    } catch (err: any) {
      showToast('❌ Lỗi tải ảnh thư viện: ' + err.message);
    } finally {
      setIsUploadingGallery(false);
      setGalleryUploadStatus('');
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

    // Process hashtags (clean & relevant, comma/space separated, auto-extract meaningful viral tags if empty)
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
      if (isBrokenOrMeaninglessTags(finalHashtags)) {
        finalHashtags = generateMeaningfulViralHashtags(trimmedName, description);
      }
    } else {
      finalHashtags = generateMeaningfulViralHashtags(trimmedName, description);
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
    <div className="modal-overlay open" id="productModalOverlay">
      <div className="modal" style={{ maxWidth: '580px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
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
                  if (isImgValid) {
                    setHoverPreview(null);
                    const idxInGallery = galleryImages.findIndex((g) => g === imageUrl);
                    setLightboxIndex(idxInGallery >= 0 ? idxInGallery : 0);
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                onMouseEnter={(e) => {
                  if (isImgValid) {
                    e.currentTarget.style.transform = 'scale(1.1)';
                    e.currentTarget.style.borderColor = '#a855f7';
                    showHoverZoom(e, imageUrl, 'Ảnh đại diện chính (Main Thumbnail)', true);
                  }
                }}
                onMouseMove={(e) => {
                  if (isImgValid) {
                    showHoverZoom(e, imageUrl, 'Ảnh đại diện chính (Main Thumbnail)', true);
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                  setHoverPreview(null);
                }}
                title={isImgValid ? '🔍 Rê chuột để xem nhanh • Click để phóng to toàn màn hình' : 'Click để tải ảnh lên'}
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
                  transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
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
                    multiple
                    onChange={handleUploadMainImage}
                    style={{ display: 'none' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Gallery Images Section */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                Gallery Images (Hover to zoom • Click to view full • ⭐ to set main)
                {isUploadingGallery && (
                  <span style={{ color: '#a78bfa', fontSize: '11px', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ display: 'inline-block', width: '11px', height: '11px', border: '2px solid rgba(167,139,250,0.3)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    {galleryUploadStatus || 'Đang tải...'}
                  </span>
                )}
              </label>
              {galleryImages.length > 0 && (
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {galleryImages.length} ảnh
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {galleryImages.map((src, idx) => (
                <div
                  key={src + idx}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.12)';
                    e.currentTarget.style.zIndex = '25';
                    showHoverZoom(e, src, `Ảnh Gallery #${idx + 1} / ${galleryImages.length}`, imageUrl === src);
                  }}
                  onMouseMove={(e) => {
                    showHoverZoom(e, src, `Ảnh Gallery #${idx + 1} / ${galleryImages.length}`, imageUrl === src);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.zIndex = '1';
                    setHoverPreview(null);
                  }}
                  style={{
                    position: 'relative',
                    width: '56px',
                    height: '56px',
                    borderRadius: '8px',
                    border: imageUrl === src ? '2px solid #8b5cf6' : '1px solid var(--border)',
                    boxShadow: imageUrl === src ? '0 0 10px rgba(139,92,246,0.45)' : 'none',
                    overflow: 'visible',
                    flexShrink: 0,
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                >
                  <img
                    src={getDisplayImageUrl(src)}
                    alt={`Gallery item ${idx + 1}`}
                    onClick={() => {
                      setHoverPreview(null);
                      setLightboxIndex(idx);
                    }}
                    title="🔍 Rê chuột để zoom nhanh • Click để xem ảnh to toàn màn hình"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '7px', cursor: 'zoom-in' }}
                  />
                  {/* Set as Main Thumbnail Badge */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageUrl(src);
                    }}
                    title={imageUrl === src ? 'Đang là ảnh đại diện chính' : 'Đặt làm ảnh đại diện chính'}
                    style={{
                      position: 'absolute',
                      bottom: '-4px',
                      left: '-4px',
                      background: imageUrl === src ? '#8b5cf6' : 'rgba(15,23,42,0.85)',
                      border: imageUrl === src ? '1px solid #c4b5fd' : '1px solid rgba(255,255,255,0.25)',
                      color: imageUrl === src ? '#fde047' : '#cbd5e1',
                      borderRadius: '6px',
                      padding: '1px 4px',
                      fontSize: '9px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      lineHeight: 1.2,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                    }}
                  >
                    {imageUrl === src ? '★' : '☆'}#{idx + 1}
                  </div>
                  {/* Delete Badge */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setHoverPreview(null);
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
                onClick={() => {
                  if (!isUploadingGallery) {
                    galleryInputRef.current?.click();
                  }
                }}
                title={isUploadingGallery ? galleryUploadStatus : "Tải thêm ảnh vào Gallery (chọn được nhiều ảnh)"}
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '8px',
                  border: isUploadingGallery ? '1.5px solid #a78bfa' : '1.5px dashed rgba(124,58,237,0.5)',
                  background: isUploadingGallery ? 'rgba(124,58,237,0.1)' : 'var(--bg3)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: isUploadingGallery ? 'not-allowed' : 'pointer',
                  color: '#a78bfa',
                  fontSize: isUploadingGallery ? '11px' : '20px',
                  fontWeight: 'bold',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                  opacity: isUploadingGallery ? 0.9 : 1,
                  gap: '2px',
                }}
              >
                {isUploadingGallery ? (
                  <>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid rgba(167,139,250,0.3)',
                      borderTopColor: '#a78bfa',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    <span style={{ fontSize: '9px', fontWeight: 600, color: '#c4b5fd' }}>
                      {galleryUploadStatus.replace('Đang tải ', '') || '...'}
                    </span>
                  </>
                ) : (
                  '+'
                )}
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                Hashtags (Tự động gắn #viral, #xuhuong, #trending, #shorts nếu để trống)
              </label>
              <button
                type="button"
                onClick={() => {
                  const autoTags = generateMeaningfulViralHashtags(name || 'viral shorts', description || '');
                  setHashtags(autoTags.map((h) => h.replace(/^#/, '')).join(', '));
                }}
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#34d399',
                  borderRadius: '6px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✨ Tự gắn Hashtag Viral (#viral #xuhuong #trending)
              </button>
            </div>
            <input
              type="text"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="viral, xuhuong, trending, shorts, short, fyp, kienthuc"
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

      {/* Floating Hover Zoom Preview Card */}
      {hoverPreview && lightboxIndex === null && (
        <div
          style={{
            position: 'fixed',
            left: `${hoverPreview.x}px`,
            top: `${hoverPreview.y}px`,
            width: '300px',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(12px)',
            border: hoverPreview.isMain ? '2px solid #a855f7' : '1.5px solid rgba(255,255,255,0.2)',
            borderRadius: '14px',
            padding: '10px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.85)',
            zIndex: 100000,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            animation: 'fadeIn 0.12s ease-out',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '260px',
              borderRadius: '10px',
              overflow: 'hidden',
              background: '#090d16',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={hoverPreview.src}
              alt="Hover Zoom Preview"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc' }}>
              {hoverPreview.label}
            </span>
            {hoverPreview.isMain && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  background: 'rgba(168,85,247,0.22)',
                  border: '1px solid rgba(168,85,247,0.5)',
                  color: '#e9d5ff',
                  padding: '2px 7px',
                  borderRadius: '8px',
                }}
              >
                ★ Ảnh chính
              </span>
            )}
          </div>
          <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>
            🔍 Click vào ảnh để xem toàn màn hình • Click ★ để đặt làm ảnh chính
          </div>
        </div>
      )}

      {/* Full-Screen Lightbox Viewer on Click */}
      {lightboxIndex !== null && (
        <Lightbox
          imageUrl={
            galleryImages.length > 0
              ? galleryImages[lightboxIndex] || imageUrl
              : imageUrl
          }
          images={galleryImages.length > 0 ? galleryImages : imageUrl ? [imageUrl] : []}
          currentIndex={lightboxIndex}
          title={name ? `${name} — Ảnh ${lightboxIndex + 1}` : `Xem ảnh chi tiết (${lightboxIndex + 1}/${Math.max(galleryImages.length, 1)})`}
          onClose={() => setLightboxIndex(null)}
          onChangeIndex={(nextIdx) => setLightboxIndex(nextIdx)}
        />
      )}
    </div>
  );
};
