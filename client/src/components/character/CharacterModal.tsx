import React, { useState, useEffect } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmDialogContext';

interface CharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CharacterModal: React.FC<CharacterModalProps> = ({ isOpen, onClose }) => {
  const { showToast } = useToast();
  const { confirmDialog } = useConfirm();
  const [characters, setCharacters] = useState<any[]>([]);
  const [charId, setCharId] = useState('');
  const [charName, setCharName] = useState('');
  const [charEmoji, setCharEmoji] = useState('');
  const [elevenId, setElevenId] = useState('');
  const [pitchShift, setPitchShift] = useState('1.0');
  const [isLoading, setIsLoading] = useState(false);

  const fetchCharacters = async () => {
    try {
      const res = await fetch('/api/characters');
      const data = await res.json();
      const list = data.data || (Array.isArray(data) ? data : []);
      setCharacters(list);
    } catch (e: any) {
      console.warn('Failed to fetch characters:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCharacters();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = charId.trim().toLowerCase();
    const name = charName.trim();
    const emoji = charEmoji.trim() || '👤';
    const pitch = parseFloat(pitchShift) || 1.0;

    if (!id || !name) {
      showToast('⚠️ Vui lòng nhập đầy đủ ID và Tên nhân vật!');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          avatar_emoji: emoji,
          provider: elevenId ? 'elevenlabs' : 'macos_say',
          voice_id: elevenId || `voice_${id}_001`,
          voice_settings: {
            elevenlabs_voice_id: elevenId || undefined,
            pitch_shift: pitch,
            speech_rate: pitch > 1.1 ? 185 : pitch < 0.9 ? 155 : 175,
          },
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save character');

      showToast(`✅ Đã lưu nhân vật: ${name}`);
      setCharId('');
      setCharName('');
      setCharEmoji('');
      setElevenId('');
      setPitchShift('1.0');
      fetchCharacters();
    } catch (err: any) {
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Xóa Nhân Vật',
      message: `Bạn có chắc muốn xóa nhân vật "${id}"? Thao tác này không thể hoàn tác.`,
      confirmText: 'Xóa Nhân Vật',
      cancelText: 'Hủy bỏ',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('🗑️ Đã xóa nhân vật!');
        fetchCharacters();
      }
    } catch (err: any) {
      showToast('❌ Lỗi: ' + err.message);
    }
  };

  return (
    <div className="modal-overlay open" id="characterModalOverlay">
      <div className="modal" style={{ width: '780px', maxWidth: '96vw', padding: '26px', borderRadius: '20px', display: 'flex', flexDirection: 'column', gap: '18px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>🎭 Bảng Quản Lý Giọng Nhân Vật (Character Voice Registry)</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>Cấu hình Voice ID cố định (ElevenLabs / Pitch Shift) cho từng nhân vật để đảm bảo nhất quán giọng nói</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {/* Character List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {characters.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '13px', padding: '20px' }}>
              Chưa có nhân vật nào được lưu.
            </div>
          ) : (
            characters.map((char) => (
              <div
                key={char.id}
                className="char-item-row"
                style={{
                  background: 'var(--bg2)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <div style={{ fontSize: '26px', width: '42px', height: '42px', background: 'var(--bg3)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {char.avatar_emoji || '👤'}
                  </div>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span>{char.name}</span>
                      <span style={{ fontSize: '11px', color: '#a78bfa', background: 'rgba(124,58,237,0.15)', padding: '1px 6px', borderRadius: '4px' }}>
                        ID: {char.id}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px', wordBreak: 'break-word' }}>
                      Voice ID: <strong style={{ color: '#34d399' }}>{char.voice_settings?.elevenlabs_voice_id || char.voice_id || 'default'}</strong> | Pitch: <strong>{char.voice_settings?.pitch_shift || 1.0}x</strong> | Speed: <strong>{char.voice_settings?.speech_rate || 175}</strong>
                    </div>
                  </div>
                </div>

                <div className="char-item-actions">
                  <button
                    type="button"
                    onClick={() => handleDelete(char.id)}
                    style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    🗑️ Xóa
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add Character Form */}
        <form onSubmit={handleAdd} style={{ background: 'var(--bg3)', border: '1px dashed var(--border)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#34d399' }}>➕ Thêm Nhân Vật Mới</span>
          <div className="char-grid-3" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px' }}>
            <input
              type="text"
              placeholder="Emoji (🐶)"
              value={charEmoji}
              onChange={(e) => setCharEmoji(e.target.value)}
              style={{ padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px', textAlign: 'center' }}
            />
            <input
              type="text"
              placeholder="ID (e.g. xam, sep_shiba)"
              value={charId}
              onChange={(e) => setCharId(e.target.value)}
              required
              style={{ padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px' }}
            />
            <input
              type="text"
              placeholder="Tên nhân vật (e.g. Xám)"
              value={charName}
              onChange={(e) => setCharName(e.target.value)}
              required
              style={{ padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px' }}
            />
          </div>
          <div className="char-grid-2" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
            <input
              type="text"
              placeholder="Voice ID ElevenLabs (e.g. 21m00Tcm4TlvDq8ikWAM)"
              value={elevenId}
              onChange={(e) => setElevenId(e.target.value)}
              style={{ padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px' }}
            />
            <input
              type="number"
              step="0.05"
              min="0.5"
              max="2.0"
              placeholder="Pitch (0.8 - 1.3)"
              value={pitchShift}
              onChange={(e) => setPitchShift(e.target.value)}
              style={{ padding: '8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button
              type="submit"
              className="btn-submit"
              disabled={isLoading}
              style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 600 }}
            >
              {isLoading ? 'Đang lưu...' : '💾 Lưu Nhân Vật'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
