import React, { useState, useEffect, useCallback, memo } from 'react';
import { getDisplayImageUrl } from '../../utils/image';

interface LightboxProps {
  imageUrl: string | null;
  images?: string[];
  currentIndex?: number;
  dialogues?: string[];
  title?: string;
  onClose: () => void;
  onChangeIndex?: (index: number) => void;
}

export const Lightbox: React.FC<LightboxProps> = memo(({
  imageUrl,
  images = [],
  currentIndex = 0,
  dialogues = [],
  title = '',
  onClose,
  onChangeIndex,
}) => {
  const [activeIdx, setActiveIdx] = useState(currentIndex);
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    setActiveIdx(currentIndex);
  }, [currentIndex]);

  const allImages = images.length > 0 ? images : imageUrl ? [imageUrl] : [];
  const rawImg = allImages[activeIdx] || imageUrl;
  const currentImg = getDisplayImageUrl(rawImg);
  const currentDialogue = dialogues[activeIdx] || '';


  const handlePrev = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (activeIdx > 0) {
      const next = activeIdx - 1;
      setActiveIdx(next);
      onChangeIndex?.(next);
      setZoomLevel(1);
    }
  }, [activeIdx, onChangeIndex]);

  const handleNext = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (activeIdx < allImages.length - 1) {
      const next = activeIdx + 1;
      setActiveIdx(next);
      onChangeIndex?.(next);
      setZoomLevel(1);
    }
  }, [activeIdx, allImages.length, onChangeIndex]);

  // Keyboard navigation (◄ / ► / Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handlePrev, handleNext]);

  if (!currentImg) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6, 9, 18, 0.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        userSelect: 'none',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      {/* Top Header Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), rgba(0,0,0,0))',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: '15px' }}>
            {title || `Phân cảnh ${activeIdx + 1} / ${allImages.length}`}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: '#ec4899',
              background: 'rgba(236,72,153,0.18)',
              border: '1px solid rgba(236,72,153,0.3)',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 600,
            }}
          >
            Bảng 6 bước chi tiết
          </span>
          <span
            style={{
              fontSize: '12px',
              color: 'var(--muted)',
              background: 'rgba(255,255,255,0.08)',
              padding: '2px 8px',
              borderRadius: '12px',
            }}
          >
            {activeIdx + 1} / {allImages.length}
          </span>
        </div>

        {/* Zoom Controls & Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
            title="Thu nhỏ (-)"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              fontWeight: 'bold',
            }}
          >
            −
          </button>

          <span
            onClick={() => setZoomLevel(1)}
            title="Click để đặt lại 100%"
            style={{
              color: '#cbd5e1',
              fontSize: '12px',
              fontWeight: 600,
              minWidth: '46px',
              textAlign: 'center',
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: '6px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {Math.round(zoomLevel * 100)}%
          </span>

          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
            title="Phóng to (+)"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              fontWeight: 'bold',
            }}
          >
            +
          </button>

          <button
            type="button"
            onClick={() => setZoomLevel(1)}
            title="Vừa khung hình (Fit)"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              padding: '0 12px',
              height: '34px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            🔄 Vừa khung
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Đóng (Esc)"
            style={{
              background: 'rgba(239,68,68,0.2)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#fca5a5',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 'bold',
              marginLeft: '6px',
            }}
          >
            &times;
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Navigation Arrows */}
        {allImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrev}
              disabled={activeIdx <= 0}
              title="Phân cảnh trước (◄)"
              style={{
                position: 'absolute',
                left: '24px',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 20,
                background: 'rgba(15,23,42,0.85)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                cursor: activeIdx <= 0 ? 'not-allowed' : 'pointer',
                opacity: activeIdx <= 0 ? 0.3 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                transition: 'all 0.2s',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}
            >
              ‹
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={activeIdx >= allImages.length - 1}
              title="Phân cảnh kế tiếp (►)"
              style={{
                position: 'absolute',
                right: '24px',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 20,
                background: 'rgba(15,23,42,0.85)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                cursor: activeIdx >= allImages.length - 1 ? 'not-allowed' : 'pointer',
                opacity: activeIdx >= allImages.length - 1 ? 0.3 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                transition: 'all 0.2s',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}
            >
              ›
            </button>
          </>
        )}

        {/* Central Displayed Image */}
        <div
          style={{
            transform: `scale(${zoomLevel})`,
            transition: 'transform 0.15s ease-out',
            transformOrigin: 'center center',
          }}
        >
          <img
            src={currentImg}
            alt="Current Scene"
            style={{
              display: 'block',
              maxWidth: '90vw',
              maxHeight: 'calc(100vh - 240px)',
              objectFit: 'contain',
              borderRadius: '10px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
            }}
          />
        </div>

        {/* Dialogue Caption Subtitle Bar */}
        {currentDialogue && (
          <div
            style={{
              marginTop: '12px',
              background: 'rgba(255, 255, 255, 0.95)',
              color: '#0f172a',
              padding: '10px 20px',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: 600,
              maxWidth: '850px',
              textAlign: 'center',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              lineHeight: 1.4,
            }}
          >
            {currentDialogue}
          </div>
        )}
      </div>

      {/* Bottom Thumbnail Strip Carousel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 24px 14px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0))',
          zIndex: 10,
          gap: '8px',
        }}
      >
        {allImages.length > 1 && (
          <div
            style={{
              display: 'flex',
              gap: '10px',
              maxWidth: '92vw',
              overflowX: 'auto',
              padding: '4px 2px',
            }}
          >
            {allImages.map((img, idx) => {
              const isActive = idx === activeIdx;
              return (
                <div
                  key={idx}
                  onClick={() => {
                    setActiveIdx(idx);
                    onChangeIndex?.(idx);
                    setZoomLevel(1);
                  }}
                  style={{
                    flexShrink: 0,
                    width: '64px',
                    height: '46px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: isActive ? '2px solid #ec4899' : '2px solid rgba(255,255,255,0.2)',
                    boxShadow: isActive ? '0 0 12px rgba(236,72,153,0.8)' : 'none',
                    transform: isActive ? 'scale(1.08)' : 'scale(1)',
                    transition: 'transform 0.15s ease, border-color 0.15s ease',
                    background: 'var(--bg3)',
                  }}
                >
                  <img src={getDisplayImageUrl(img)} alt={`Part ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Hints */}
        <div
          style={{
            color: '#94a3b8',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <span>💡 Phím <strong>◄ / ►</strong>: Chuyển phân cảnh</span>
          <span>•</span>
          <span>Phím <strong>Esc</strong>: Đóng</span>
        </div>
      </div>
    </div>
  );
});
