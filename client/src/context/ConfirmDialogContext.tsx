import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { AlertTriangle, Trash2, HelpCircle, Info, CheckCircle2, X } from 'lucide-react';

export type ConfirmDialogType = 'danger' | 'warning' | 'info' | 'success';

export interface ConfirmDialogOptions {
  title?: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  type?: ConfirmDialogType;
}

export interface ConfirmDialogContextValue {
  confirmDialog: (options: ConfirmDialogOptions | string) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue>({
  confirmDialog: () => Promise.resolve(false),
});

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirmDialog = useCallback((opts: ConfirmDialogOptions | string): Promise<boolean> => {
    const normalized: ConfirmDialogOptions =
      typeof opts === 'string'
        ? {
            title: 'Xác nhận hành động',
            message: opts,
            confirmText: 'Đồng ý',
            cancelText: 'Hủy bỏ',
            type: 'warning',
          }
        : {
            title: opts.title || (opts.type === 'danger' ? 'Xác nhận xóa' : 'Xác nhận'),
            message: opts.message,
            confirmText: opts.confirmText || (opts.type === 'danger' ? 'Xóa ngay' : 'Đồng ý'),
            cancelText: opts.cancelText || 'Hủy bỏ',
            type: opts.type || 'warning',
          };

    setOptions(normalized);
    setIsOpen(true);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleConfirm = () => {
    setIsOpen(false);
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  };

  // Keyboard accessibility: Escape to cancel, Enter to confirm
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        // Prevent accidental triggers if focus is in a textarea
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'textarea') {
          e.preventDefault();
          handleConfirm();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const getTypeStyles = (type: ConfirmDialogType = 'warning') => {
    switch (type) {
      case 'danger':
        return {
          icon: <Trash2 size={24} />,
          badgeColor: '#f87171',
          glowColor: 'rgba(239, 68, 68, 0.35)',
          borderColor: 'rgba(239, 68, 68, 0.45)',
          iconBg: 'rgba(239, 68, 68, 0.18)',
          confirmBtnBg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          confirmBtnShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
        };
      case 'warning':
        return {
          icon: <AlertTriangle size={24} />,
          badgeColor: '#fbbf24',
          glowColor: 'rgba(245, 158, 11, 0.35)',
          borderColor: 'rgba(245, 158, 11, 0.45)',
          iconBg: 'rgba(245, 158, 11, 0.18)',
          confirmBtnBg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          confirmBtnShadow: '0 4px 14px rgba(245, 158, 11, 0.4)',
        };
      case 'success':
        return {
          icon: <CheckCircle2 size={24} />,
          badgeColor: '#34d399',
          glowColor: 'rgba(16, 185, 129, 0.35)',
          borderColor: 'rgba(16, 185, 129, 0.45)',
          iconBg: 'rgba(16, 185, 129, 0.18)',
          confirmBtnBg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          confirmBtnShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
        };
      case 'info':
      default:
        return {
          icon: <HelpCircle size={24} />,
          badgeColor: '#c084fc',
          glowColor: 'rgba(168, 85, 247, 0.35)',
          borderColor: 'rgba(168, 85, 247, 0.45)',
          iconBg: 'rgba(168, 85, 247, 0.18)',
          confirmBtnBg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
          confirmBtnShadow: '0 4px 14px rgba(139, 92, 246, 0.4)',
        };
    }
  };

  const currentStyles = getTypeStyles(options?.type);

  return (
    <ConfirmDialogContext.Provider value={{ confirmDialog }}>
      {children}

      {isOpen && options && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 10090,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={(e) => e.target === e.currentTarget && handleCancel()}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '460px',
              background: 'linear-gradient(180deg, #1e162a 0%, #120e1b 100%)',
              border: `1.5px solid ${currentStyles.borderColor}`,
              borderRadius: '16px',
              boxShadow: `0 20px 50px rgba(0, 0, 0, 0.75), 0 0 25px ${currentStyles.glowColor}`,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              animation: 'scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: currentStyles.iconBg,
                    border: `1px solid ${currentStyles.borderColor}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: currentStyles.badgeColor,
                    boxShadow: `0 0 14px ${currentStyles.glowColor}`,
                    flexShrink: 0,
                  }}
                >
                  {currentStyles.icon}
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: 800,
                    color: '#fff',
                    letterSpacing: '-0.3px',
                  }}
                >
                  {options.title}
                </h3>
              </div>

              <button
                type="button"
                onClick={handleCancel}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '7px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                title="Hủy bỏ (Esc)"
              >
                <X size={15} />
              </button>
            </div>

            {/* Message Body */}
            <div
              style={{
                padding: '20px',
                fontSize: '13.5px',
                lineHeight: 1.6,
                color: 'rgba(255, 255, 255, 0.88)',
              }}
            >
              {options.message}
            </div>

            {/* Footer Buttons */}
            <div
              style={{
                padding: '14px 20px',
                background: 'rgba(0, 0, 0, 0.35)',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  color: 'var(--text)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {options.cancelText}
              </button>

              <button
                type="button"
                onClick={handleConfirm}
                autoFocus
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  background: currentStyles.confirmBtnBg,
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#fff',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: currentStyles.confirmBtnShadow,
                  transition: 'all 0.15s',
                }}
              >
                {options.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
};

export const useConfirm = () => useContext(ConfirmDialogContext);
