import React, { memo } from 'react';

interface SidebarProps {
  activeSection: string;
  onSelectSection: (section: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onTriggerDryRun: () => void;
}

export const Sidebar: React.FC<SidebarProps> = memo(({
  activeSection,
  onSelectSection,
  isOpen,
  onClose,
  onTriggerDryRun,
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

        <div className="nav-label">Automation</div>
        <a
          className="nav-item"
          onClick={() => {
            onTriggerDryRun();
            onClose();
          }}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Dry Run Test
        </a>

        <a
          className={`nav-item ${activeSection === 'logs' ? 'active' : ''}`}
          onClick={() => handleSelect('logs')}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Activity Log
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
