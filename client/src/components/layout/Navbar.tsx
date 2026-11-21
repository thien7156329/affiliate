import React, { useState, useEffect, memo } from 'react';
import { useToast } from '../../context/ToastContext';

interface NavbarProps {
  onOpenGenerateModal: () => void;
  onOpenCharacterModal: () => void;
  onOpenConcatModal: () => void;
  onToggleSidebar: () => void;
}

export const Navbar: React.FC<NavbarProps> = memo(({
  onOpenGenerateModal,
  onOpenCharacterModal,
  onOpenConcatModal,
  onToggleSidebar,
}) => {
  const [serverOnline, setServerOnline] = useState<boolean>(true);
  const [serverMode, setServerMode] = useState<string>('Connecting...');

  const checkHealth = async () => {
    try {
      const res = await fetch('/health');
      const data = await res.json();
      setServerOnline(true);
      setServerMode(`Server OK • ${data.tiktok_mode === 'mock' ? 'TikTok Mock' : 'TikTok Live'}`);
    } catch {
      setServerOnline(false);
      setServerMode('Server offline');
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          className="menu-toggle"
          id="menuToggleBtn"
          onClick={onToggleSidebar}
          aria-label="Toggle menu"
        >
          ☰
        </button>
        <div className="logo">
          <div className="logo-icon">🎬</div>
          Affiliate AI Studio
        </div>
      </div>

      <div className="header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--muted)' }}>
          <div
            className="status-dot"
            id="serverDot"
            style={{ background: serverOnline ? 'var(--success)' : 'var(--danger)' }}
          />
          <span id="serverStatus">{serverMode}</span>
        </div>

        <button
          type="button"
          className="btn-sm btn-nav-action"
          style={{
            padding: '8px 12px',
            borderRadius: '10px',
            background: 'rgba(16,185,129,0.15)',
            border: '1px solid rgba(16,185,129,0.3)',
            color: '#34d399',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            whiteSpace: 'nowrap',
          }}
          onClick={onOpenCharacterModal}
          title="Quản lý giọng nhân vật"
        >
          <span>🎭</span>
          <span className="btn-nav-text">Giọng Nhân Vật</span>
        </button>

        <button
          type="button"
          className="btn-sm btn-nav-action"
          style={{
            padding: '8px 12px',
            borderRadius: '10px',
            background: 'rgba(124,58,237,0.15)',
            border: '1px solid rgba(124,58,237,0.3)',
            color: '#a78bfa',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            whiteSpace: 'nowrap',
          }}
          onClick={onOpenConcatModal}
          title="Nối các video ngắn thành video hoàn chỉnh"
        >
          <span>🔗</span>
          <span className="btn-nav-text">Nối Video</span>
        </button>

        <button
          type="button"
          className="btn-generate"
          onClick={onOpenGenerateModal}
          title="Tạo video mới với AI"
        >
          <span>▶</span>
          <span className="btn-nav-generate-text">Generate Video</span>
        </button>
      </div>
    </header>
  );
});

