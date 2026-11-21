import React from 'react';
import { AlertTriangle, ShieldAlert, Edit3, X, RefreshCw, AlertCircle } from 'lucide-react';
import { useActiveAiModels } from '../../utils/aiModels';

export interface PromptValidationIssue {
  type: string;
  text: string;
  reason: string;
}

export interface PromptValidationErrorData {
  sceneIndex: number;
  attempts: number;
  issues: PromptValidationIssue[];
  error?: string;
  currentPrompt?: string;
}

interface PromptValidationErrorDialogProps {
  isOpen: boolean;
  data: PromptValidationErrorData | null;
  onClose: () => void;
  onChangeContent: () => void;
  onEditSceneManual?: (sceneIndex: number) => void;
}

export const PromptValidationErrorDialog: React.FC<PromptValidationErrorDialogProps> = ({
  isOpen,
  data,
  onClose,
  onChangeContent,
  onEditSceneManual,
}) => {
  const aiModels = useActiveAiModels();
  if (!isOpen || !data) return null;
  const validatorLabel = aiModels.validator.label || 'AGY';

  const getIssueBadge = (type: string) => {
    switch (type.toUpperCase()) {
      case 'COPYRIGHT':
        return {
          label: 'Bản quyền & Nhân vật có tên',
          bg: 'rgba(239, 68, 68, 0.18)',
          border: 'rgba(239, 68, 68, 0.5)',
          color: '#f87171',
        };
      case 'CELEBRITY':
        return {
          label: 'Người nổi tiếng đời thực',
          bg: 'rgba(245, 158, 11, 0.18)',
          border: 'rgba(245, 158, 11, 0.5)',
          color: '#fbbf24',
        };
      case 'SAFETY':
        return {
          label: 'Chính sách an toàn & Bạo lực',
          bg: 'rgba(220, 38, 38, 0.22)',
          border: 'rgba(220, 38, 38, 0.6)',
          color: '#fca5a5',
        };
      case 'TECHNICAL_CONFLICT':
        return {
          label: 'Mâu thuẫn kỹ thuật Veo 3',
          bg: 'rgba(59, 130, 246, 0.18)',
          border: 'rgba(59, 130, 246, 0.5)',
          color: '#60a5fa',
        };
      default:
        return {
          label: type,
          bg: 'rgba(168, 85, 247, 0.18)',
          border: 'rgba(168, 85, 247, 0.5)',
          color: '#c084fc',
        };
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          background: 'linear-gradient(180deg, #1e1427 0%, #130f1e 100%)',
          border: '1.5px solid rgba(239, 68, 68, 0.45)',
          borderRadius: '18px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.75), 0 0 30px rgba(239, 68, 68, 0.22)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          animation: 'scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px',
            background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.2) 0%, rgba(124, 58, 237, 0.1) 100%)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f87171',
                boxShadow: '0 0 16px rgba(239, 68, 68, 0.35)',
                flexShrink: 0,
              }}
            >
              <ShieldAlert size={24} />
            </div>
            <div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: '#f87171',
                  marginBottom: '2px',
                }}
              >
                Hệ Thống Kiểm Định {validatorLabel}
              </div>
              <h3
                style={{
                  margin: 0,
                  fontSize: '17px',
                  fontWeight: 800,
                  color: '#fff',
                  letterSpacing: '-0.3px',
                }}
              >
                Đã Dừng Kịch Bản (Lỗi quá 3 lần)
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'var(--muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            title="Đóng hộp thoại"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Main banner callout */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={20} color="#f87171" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '13px', lineHeight: 1.55, color: '#fecaca' }}>
              <strong>Phân cảnh {data.sceneIndex}</strong> không thể render trên <strong>Google Veo 3</strong> do vi phạm
              bản quyền hoặc chính sách. AI <strong>{validatorLabel}</strong> đã tự động thử sửa đổi <strong>{data.attempts}/3 lần</strong>{' '}
              nhưng vẫn còn lỗi. Tiến trình tạo video đã tạm dừng để bạn đổi lại nội dung.
            </div>
          </div>

          {/* List of detected issues */}
          <div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#c4b5fd',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AlertCircle size={15} />
              <span>Các rủi ro phát hiện bởi {validatorLabel}:</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {data.issues && data.issues.length > 0 ? (
                data.issues.map((issue, idx) => {
                  const badge = getIssueBadge(issue.type);
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '10px',
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: badge.bg,
                            border: `1px solid ${badge.border}`,
                            color: badge.color,
                            textTransform: 'uppercase',
                          }}
                        >
                          {badge.label}
                        </span>
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#fca5a5' }}>
                          “{issue.text}”
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'rgba(255, 255, 255, 0.75)', lineHeight: 1.45 }}>
                        {issue.reason}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    fontSize: '12px',
                    color: '#fca5a5',
                  }}
                >
                  {data.error || 'Nội dung phân cảnh không phù hợp với tiêu chuẩn kết xuất video của Veo 3.'}
                </div>
              )}
            </div>
          </div>

          {/* Current offending prompt snippet */}
          {data.currentPrompt && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', marginBottom: '5px' }}>
                Prompt của Phân cảnh {data.sceneIndex} hiện tại:
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '11.5px',
                  color: 'var(--muted)',
                  fontFamily: 'monospace',
                  lineHeight: 1.45,
                  maxHeight: '80px',
                  overflowY: 'auto',
                }}
              >
                {data.currentPrompt}
              </div>
            </div>
          )}

          {/* Advice card */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              background: 'rgba(124, 58, 237, 0.1)',
              border: '1px solid rgba(124, 58, 237, 0.25)',
              fontSize: '11.5px',
              color: '#d8b4fe',
              lineHeight: 1.45,
            }}
          >
            💡 <strong>Mẹo đổi nội dung:</strong> Thay vì đặt tên nhân vật có sẵn (như Goku, Naruto, Mickey, Elsa,...),
            bạn hãy dùng mô tả chung theo phong cách Pixar 3D (ví dụ: <em>"chú mèo cam hoạt hình"</em>,{' '}
            <em>"võ sĩ thiếu niên tóc gai nhọn"</em>, <em>"siêu anh hùng giáp đỏ"</em>).
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 22px',
            background: 'rgba(0, 0, 0, 0.4)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          {onEditSceneManual && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onEditSceneManual(data.sceneIndex);
              }}
              style={{
                padding: '9px 15px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: 'var(--text)',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s',
              }}
            >
              <span>Sửa Part {data.sceneIndex} thủ công</span>
            </button>
          )}

          <button
            type="button"
            onClick={onChangeContent}
            style={{
              padding: '9px 18px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
              transition: 'all 0.15s',
            }}
          >
            <Edit3 size={15} />
            <span>Đổi lại nội dung kịch bản ngay</span>
          </button>
        </div>
      </div>
    </div>
  );
};
