import React, { memo } from 'react';
import { getDisplayImageUrl } from '../../utils/image';

interface StoryboardCardProps {
  partNum: number;
  prompt: string;
  dialogue: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  isSelected?: boolean;
  isDrawing?: boolean;
  isRendering?: boolean;
  isRevising?: boolean;
  onToggleSelect: (partNum: number) => void;
  onOpenEditor: () => void;
  onRedrawImage: () => void;
  onRenderVideo: () => void;
  onZoomImage: () => void;
}

export const StoryboardCard: React.FC<StoryboardCardProps> = memo(({
  partNum,
  prompt,
  dialogue,
  imageUrl,
  videoUrl,
  isSelected = false,
  isDrawing = false,
  isRendering = false,
  isRevising = false,
  onToggleSelect,
  onOpenEditor,
  onRedrawImage,
  onRenderVideo,
  onZoomImage,
}) => {
  const imgExists = Boolean(imageUrl);
  const vidExists = Boolean(videoUrl);
  const displayImg = getDisplayImageUrl(imageUrl);

  return (
    <div
      id={`storyboardCard_${partNum}`}
      className="storyboard-card"
      style={{ border: `1px solid ${imgExists ? 'rgba(236,72,153,0.4)' : 'var(--border)'}` }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '9px 12px',
          background: 'var(--bg3)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            className="part-select-chk"
            checked={isSelected}
            onChange={() => onToggleSelect(partNum)}
            style={{ accentColor: '#8b5cf6', width: '15px', height: '15px', cursor: 'pointer' }}
          />
          <span>Part {partNum}</span>
        </label>
        <div style={{ display: 'flex', gap: '5px', fontSize: '10px' }}>
          {isRevising && (
            <span
              style={{
                background: 'rgba(236,72,153,0.2)',
                border: '1px solid #ec4899',
                color: '#f472b6',
                padding: '2px 7px',
                borderRadius: '6px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 0 8px rgba(236,72,153,0.3)',
              }}
            >
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#ec4899', animation: 'livePulse 0.8s infinite' }} />
              <span>🤖 2 AI đang sửa...</span>
            </span>
          )}
          <span
            style={{
              background: isDrawing
                ? 'linear-gradient(135deg, rgba(236,72,153,0.25) 0%, rgba(245,158,11,0.25) 100%)'
                : imgExists
                ? 'rgba(16,185,129,0.15)'
                : 'rgba(100,116,139,0.15)',
              border: isDrawing ? '1px solid #ec4899' : '1px solid transparent',
              color: isDrawing ? '#f472b6' : imgExists ? '#10b981' : 'var(--muted)',
              padding: '2px 8px',
              borderRadius: '6px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              boxShadow: isDrawing ? '0 0 10px rgba(236,72,153,0.35)' : 'none',
              animation: isDrawing ? 'livePulse 1s infinite' : 'none',
            }}
          >
            {isDrawing ? (
              <>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ec4899', animation: 'livePulse 0.8s infinite' }} />
                <span>🖼️ Đang vẽ...</span>
              </>
            ) : imgExists ? (
              '🖼️ Ảnh OK'
            ) : (
              'Chưa ảnh'
            )}
          </span>
          <span
            style={{
              background: isRendering
                ? 'linear-gradient(135deg, rgba(139,92,246,0.25) 0%, rgba(59,130,246,0.25) 100%)'
                : vidExists
                ? 'rgba(139,92,246,0.15)'
                : 'rgba(100,116,139,0.15)',
              border: isRendering ? '1px solid #a855f7' : '1px solid transparent',
              color: isRendering ? '#c084fc' : vidExists ? '#a78bfa' : 'var(--muted)',
              padding: '2px 8px',
              borderRadius: '6px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              boxShadow: isRendering ? '0 0 10px rgba(139,92,246,0.35)' : 'none',
              animation: isRendering ? 'livePulse 1s infinite' : 'none',
            }}
          >
            {isRendering ? (
              <>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a855f7', animation: 'livePulse 0.8s infinite' }} />
                <span>🎬 Đang tạo...</span>
              </>
            ) : vidExists ? (
              '🎬 Video OK'
            ) : (
              'Chưa video'
            )}
          </span>
        </div>
      </div>

      {/* Visual Area (Responsive 16:9 Aspect Ratio) */}
      <div
        id={`cardVisual_${partNum}`}
        onClick={onOpenEditor}
        title="🔍 Click để mở chỉnh sửa chi tiết & 2-AI thảo luận"
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          minHeight: '120px',
          background: 'var(--bg3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: 'pointer',
          border: isDrawing ? '1.5px solid #ec4899' : isRendering ? '1.5px solid #8b5cf6' : 'none',
          boxShadow: isDrawing ? '0 0 14px rgba(236,72,153,0.35)' : isRendering ? '0 0 14px rgba(139,92,246,0.35)' : 'none',
          transition: 'all 0.25s ease',
        }}
      >
        {/* Active Drawing Loading Overlay */}
        {isDrawing && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              zIndex: 10,
            }}
          >
            <span
              style={{
                width: '32px',
                height: '32px',
                border: '3px solid rgba(236,72,153,0.3)',
                borderTopColor: '#ec4899',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#f472b6', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
              🎨 Đang vẽ ảnh Part {partNum}...
            </span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.75)' }}>
              Gemini AI đang sinh ảnh 3D Pixar
            </span>
          </div>
        )}

        {/* Active Video Rendering Loading Overlay */}
        {isRendering && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              zIndex: 10,
            }}
          >
            <span
              style={{
                width: '32px',
                height: '32px',
                border: '3px solid rgba(139,92,246,0.3)',
                borderTopColor: '#a855f7',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#c084fc', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
              🎬 Đang render video Part {partNum}...
            </span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.75)' }}>
              Veo AI đang sinh hoạt cảnh video
            </span>
          </div>
        )}

        {imgExists ? (
          <>
            <img
              src={displayImg}
              alt={`Part ${partNum}`}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s' }}
              onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
              onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            />
            <div
              onClick={(e) => {
                e.stopPropagation();
                onZoomImage();
              }}
              style={{
                position: 'absolute',
                bottom: '6px',
                right: '6px',
                background: 'rgba(0,0,0,0.75)',
                backdropFilter: 'blur(4px)',
                color: '#a78bfa',
                fontSize: '10.5px',
                padding: '2px 8px',
                borderRadius: '5px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              🔍 Zoom
            </div>

            <a
              href={displayImg}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Mở ảnh gốc trong tab mới để kiểm tra"
              style={{
                position: 'absolute',
                bottom: '6px',
                left: '6px',
                background: 'rgba(0,0,0,0.75)',
                backdropFilter: 'blur(4px)',
                color: '#38bdf8',
                fontSize: '10px',
                padding: '2px 7px',
                borderRadius: '5px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                textDecoration: 'none',
              }}
            >
              🔗 Tab mới
            </a>

            {vidExists && (
              <a
                href={videoUrl || undefined}
                download={`part_${partNum}.mp4`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  background: 'rgba(16,185,129,0.92)',
                  backdropFilter: 'blur(4px)',
                  color: '#fff',
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '5px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                  cursor: 'pointer',
                  zIndex: 2,
                }}
                title={`Tải video Part ${partNum} (.mp4) về máy`}
              >
                ⬇️ Tải Part {partNum}
              </a>
            )}
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              color: 'var(--muted)',
              fontSize: '11px',
            }}
          >
            <span style={{ fontSize: '26px' }}>🎨</span>
            <span>Chưa có ảnh phân cảnh</span>
          </div>
        )}
      </div>

      {/* Buttons Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
          padding: '8px 10px 4px 10px',
          background: 'var(--bg3)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          id={`btnRedrawImage_${partNum}`}
          onClick={onRedrawImage}
          disabled={isDrawing}
          style={{
            background: isDrawing
              ? 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)'
              : 'linear-gradient(135deg, #ec4899 0%, #f59e0b 100%)',
            color: '#fff',
            border: isDrawing ? '1px solid #f472b6' : 'none',
            padding: '7px 6px',
            borderRadius: '7px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: isDrawing ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            boxShadow: isDrawing ? '0 0 10px rgba(236,72,153,0.4)' : 'none',
            transition: 'all 0.2s',
          }}
          title={`Vẽ lại ảnh cho Part ${partNum}`}
        >
          {isDrawing ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span>Đang vẽ...</span>
            </>
          ) : (
            <>🎨 {imgExists ? 'Vẽ lại Ảnh' : 'Vẽ Ảnh'}</>
          )}
        </button>

        <button
          type="button"
          id={`btnRenderVideo_${partNum}`}
          onClick={onRenderVideo}
          disabled={isRendering || !imgExists}
          style={{
            background: isRendering
              ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)'
              : 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)',
            color: '#fff',
            border: isRendering ? '1px solid #a855f7' : 'none',
            padding: '7px 6px',
            borderRadius: '7px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: isRendering || !imgExists ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            boxShadow: isRendering ? '0 0 10px rgba(139,92,246,0.4)' : 'none',
            transition: 'all 0.2s',
          }}
          title={`Render video Veo cho Part ${partNum}`}
        >
          {isRendering ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span>Đang tạo...</span>
            </>
          ) : (
            <>🎬 {vidExists ? 'Vẽ lại Video' : 'Render Video'}</>
          )}
        </button>
      </div>

      <div style={{ padding: '4px 10px 9px 10px', background: 'var(--bg3)' }}>
        <button
          type="button"
          id={`btnEditPart_${partNum}`}
          onClick={onOpenEditor}
          style={{
            width: '100%',
            background: vidExists ? 'rgba(59,130,246,0.18)' : 'rgba(139,92,246,0.15)',
            border: `1px solid ${vidExists ? 'rgba(59,130,246,0.45)' : 'rgba(139,92,246,0.45)'}`,
            color: vidExists ? '#60a5fa' : '#c084fc',
            padding: '7px 8px',
            borderRadius: '7px',
            fontSize: '11.5px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            transition: 'all 0.15s',
          }}
          title={`Mở popup sửa kịch bản chi tiết, xem trước và 2-AI phản biện Part ${partNum}`}
        >
          {vidExists ? '🎬 Xem Trước, Cắt & Sửa Chi Tiết' : '📝 Sửa Kịch Bản & 2-AI Thảo Luận'}
        </button>
      </div>
    </div>
  );
});
