import React, { memo } from 'react';

interface SidebarProps {
  activeSection: string;
  onSelectSection: (section: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onTriggerDryRun?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = memo(({
  activeSection,
  onSelectSection,
  isOpen,
  onClose,
}) => {
  const handleSelect = (section: string) => {
    onSelectSection(section);
    onClose();
  };

  return (
    <>
      <aside id="mainSidebar" className={isOpen ? 'open' : ''}>
        <div className="nav-label">Menu</div>
        <a
          className={`nav-item ${activeSection === 'dashboard' ? 'active' : ''}`}
          onClick={() => handleSelect('dashboard')}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Dashboard
        </a>

        <a
          className={`nav-item ${activeSection === 'shorts-studio' ? 'active' : ''}`}
          onClick={() => handleSelect('shorts-studio')}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
          Shorts Studio (AI)
        </a>

        <a
          className={`nav-item ${activeSection === 'videos' ? 'active' : ''}`}
          onClick={() => handleSelect('videos')}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          Videos
        </a>

        <a
          className={`nav-item ${activeSection === 'products' ? 'active' : ''}`}
          onClick={() => handleSelect('products')}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
          Products
        </a>

        <a
          className={`nav-item ${activeSection === 'long-studio' ? 'active' : ''}`}
          onClick={() => handleSelect('long-studio')}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><polygon points="10 8 15 10.5 10 13 10 8" fill="currentColor" stroke="none"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          Video Dài 16:9 (AI)
        </a>
      </aside>

      <div
        id="sidebarOverlay"
        className={isOpen ? 'open' : ''}
        onClick={onClose}
      />
    </>
  );
});
