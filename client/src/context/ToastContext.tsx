import React, { createContext, useContext, useState, useCallback } from 'react';

interface Toast {
  id: string;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, duration = 3500) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className="toast-msg">
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
