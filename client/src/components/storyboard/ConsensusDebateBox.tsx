import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import { AiDebateMessage } from '../../types';
import { useToast } from '../../context/ToastContext';
import { DebateFeedView } from './DebateFeedView';

interface ConsensusDebateBoxProps {
  productName: string;
  category: string;
  imageUrl?: string;
  productDesc?: string;
  onConsensusReached: (promptsObj: Record<string, string>) => void;
  onOpenPartEditor?: (partNum: number) => void;
}

const DebateCardItem: React.FC<{ msg: AiDebateMessage }> = memo(({ msg }) => {
  const isUser = msg.agent.includes('Đạo Diễn') || msg.role.includes('Chỉ Đạo');
  const isAi1 = msg.agent.includes('AI 1');
  const isConsensus100 = msg.title.includes('100%');
  const borderCol = isConsensus100 ? '#10b981' : isAi1 ? '#8b5cf6' : '#f59e0b';
  const bgCol = isConsensus100 ? 'rgba(16,185,129,0.14)' : isAi1 ? 'rgba(139,92,246,0.12)' : 'rgba(245,158,11,0.12)';

  return (
    <div
      style={{
        marginBottom: '8px',
        padding: '8px 10px',
        borderLeft: `3px solid ${borderCol}`,
        background: isUser ? 'rgba(6,182,212,0.14)' : bgCol,
        borderRadius: '6px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: borderCol, marginBottom: '4px' }}>
        <span>{isUser ? '👤 ' : ''}{msg.agent} ({msg.role})</span>
        <span style={{ color: 'var(--muted)' }}>{msg.timestamp}</span>
      </div>
      <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', color: isConsensus100 ? '#10b981' : isUser ? '#38bdf8' : 'var(--text)' }}>
        {msg.title}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: '11px', lineHeight: '1.4', color: 'var(--text)' }}>
        {msg.content}
      </div>
    </div>
  );
});

export const ConsensusDebateBox: React.FC<ConsensusDebateBoxProps> = memo(({
  productName,
  category,
  imageUrl,
  productDesc,
  onConsensusReached,
  onOpenPartEditor,
}) => {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<AiDebateMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [statusText, setStatusText] = useState('');
  const [preFeedback, setPreFeedback] = useState('');
  const [liveFeedback, setLiveFeedback] = useState('');
  const [sceneCount, setSceneCount] = useState<number>(8);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const startDebateStream = useCallback(async (customFeedback?: string, continuePrevious = false) => {
    if (!productName.trim()) {
      showToast('⚠️ Vui lòng nhập tên sản phẩm trước khi thảo luận 2 AI!');
      return;
    }

    setIsStreaming(true);
    const newSessionId = continuePrevious && sessionId ? sessionId : 'sess_' + Math.random().toString(36).substring(2, 10);
    setSessionId(newSessionId);

    const maxExistingRound = messages.reduce((max, m) => {
      let r = m.round;
      if (!r) {
        const match = m.title?.match(/Round\s*(\d+)/i) || m.content?.match(/Round\s*(\d+)/i);
        r = match ? parseInt(match[1], 10) : 1;
      }
      return Math.max(max, Number(r) || 1);
    }, currentRound || 1);

    const targetStartRound = continuePrevious ? maxExistingRound + 1 : 1;

    if (!continuePrevious) {
      setMessages([]);
      setCurrentRound(1);
      setStatusText('🎭 AI 1 (Codex Sol Light) & 🧐 AI 2 (Gemini 3.8 Low) đang khởi tạo phiên kiểm định...');
    } else {
      setCurrentRound(targetStartRound);
      setStatusText(`📢 Tiếp thu góp ý của Đạo diễn và bắt đầu tranh biện Round ${targetStartRound}...`);
    }

    if (continuePrevious && customFeedback) {
      const userMsg: AiDebateMessage = {
        agent: "Đạo Diễn (Bạn / User)",
        model: "Human Director",
        role: "Chỉ Đạo Kịch Bản",
        title: `📢 Góp Ý Trực Tiếp Từ Đạo Diễn (Round ${targetStartRound})`,
        content: customFeedback,
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        round: targetStartRound,
      };
      setMessages((prev) => [...prev, userMsg]);
    }

    try {
      const res = await fetch('/api/prompts/consensus-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          category,
          product_image_url: imageUrl || undefined,
          product_description: productDesc || undefined,
          scene_count: sceneCount,
          user_feedback: customFeedback || preFeedback.trim() || undefined,
          session_id: newSessionId,
          start_round: targetStartRound,
        }),
      });

      if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`Máy chủ báo lỗi HTTP ${res.status}: ${errTxt.slice(0, 100)}`);
      }

      if (!res.body) throw new Error('Trình duyệt không hỗ trợ đọc luồng phản biện.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.replace(/^data:\s*/, '');
            try {
              const evt = JSON.parse(jsonStr);

              if (evt.type === 'round_start') {
                setCurrentRound(evt.round);
                setStatusText(`🔄 Round ${evt.round}: Đang tranh biện kịch bản & kiểm định độ khớp nhân vật...`);
              } else if (evt.type === 'ai1_start') {
                setStatusText(`🎭 AI 1 (AGY 3.8) đang sáng tác và tối ưu kịch bản 3D (Round ${evt.round})...`);
              } else if (evt.type === 'ai1_done') {
                if (evt.message) {
                  const m = { ...evt.message, round: evt.round || currentRound };
                  setMessages((prev) => [...prev, m]);
                }
              } else if (evt.type === 'ai2_start') {
                setStatusText(`🧐 AI 2 (Gemini 3.8 Low) đang kiểm định tiêu chí nhân vật & bố cục...`);
              } else if (evt.type === 'ai2_done') {
                if (evt.message) {
                  const m = { ...evt.message, round: evt.round || currentRound };
                  setMessages((prev) => [...prev, m]);
                }
                if (evt.reached) {
                  setStatusText(`🎉 ĐỒNG THUẬN 100% HOÀN HẢO ĐẠT ĐƯỢC TẠI ROUND ${evt.round}!`);
                } else {
                  setStatusText(`⚠️ Round ${evt.round} đạt ${evt.percentage}%. Chuyển sang Round ${evt.round + 1}...`);
                }
              } else if (evt.type === 'complete') {
                if (evt.result?.promptsObj) {
                  onConsensusReached(evt.result.promptsObj);
                  setStatusText(`🎉 ĐỒNG THUẬN 100% (${evt.result.rounds || 1} rounds): ${evt.result.summary || 'Nhân vật & bố cục chuẩn 100%'}`);
                  showToast(`🎉 2 AI đã đạt 100% đồng thuận sau ${evt.result.rounds || 1} round!`);
                }
              } else if (evt.type === 'error') {
                throw new Error(evt.error || 'Lỗi phiên phản biện');
              }
            } catch (pErr: any) {
              if (pErr.message && !pErr.message.includes('JSON')) throw pErr;
            }
          }
        }
      }
    } catch (err: any) {
      setStatusText(`❌ Lỗi thảo luận: ${err.message}`);
      showToast(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsStreaming(false);
    }
  }, [productName, category, imageUrl, productDesc, preFeedback, currentRound, sessionId, onConsensusReached, showToast]);

  const handleSendLiveFeedback = useCallback(() => {
    if (!liveFeedback.trim()) return;
    const fb = liveFeedback.trim();
    setLiveFeedback('');
    startDebateStream(fb, true);
  }, [liveFeedback, startDebateStream]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        marginBottom: '16px',
        padding: '14px',
        background: 'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(59,130,246,0.1) 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(124,58,237,0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>🤝 2-AI Validation (Codex Sol sáng tác, Gemini 3.8 Low kiểm định đến khi đạt 100%)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <select
            value={sceneCount}
            onChange={(e) => setSceneCount(parseInt(e.target.value, 10))}
            disabled={isStreaming}
            title="Chọn số lượng cảnh / thời lượng video"
            style={{
              background: 'var(--bg2)',
              border: '1px solid rgba(124,58,237,0.4)',
              color: 'var(--text)',
              padding: '5px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value={8}>⭐ 8 Cảnh (~80s) - Short 80s Chuẩn (Mặc định)</option>
            <option value={3}>⚡ 3 Cảnh (~30s) - Short 30s Nhanh</option>
            <option value={4}>⚡ 4 Cảnh (~40s) - Short 40s Vừa vặn</option>
            <option value={5}>⚡ 5 Cảnh (~50s) - Short 50s Súc tích</option>
            <option value={6}>🎬 6 Cảnh (~60s) - Short 60s Tình huống</option>
            <option value={10}>🌟 10 Cảnh (~100s) - Ngụ Ngôn & Veo</option>
            <option value={12}>📖 12 Cảnh (~2 Phút) - Cổ Tích Đầy Đủ</option>
          </select>
          <button
            type="button"
            onClick={() => startDebateStream()}
            disabled={isStreaming}
            style={{
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isStreaming ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <span>{isStreaming ? '⏳ Đang thảo luận 2 AI...' : '✨ Thảo luận 2 AI ngay'}</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: '#c4b5fd' }}>
          💡 Góp ý / Chỉ đạo kịch bản cho 2 AI (Tùy chọn):
        </label>
        <textarea
          rows={2}
          value={preFeedback}
          onChange={(e) => setPreFeedback(e.target.value)}
          placeholder="VD: Giữ 2 chú gấu chibi mập lùn; cảnh 3 chạy ra đồng cỏ; màu sắc tươi vui..."
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'var(--bg3)',
            border: '1px solid rgba(124,58,237,0.35)',
            borderRadius: '8px',
            color: 'var(--text)',
            fontSize: '12px',
            resize: 'vertical',
            minHeight: '44px',
          }}
        />
      </div>

      {statusText && (
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#8b5cf6', marginTop: '2px' }}>
          {statusText}
        </div>
      )}

      {messages.length > 0 && (
        <div
          style={{
            marginTop: '6px',
            padding: '10px',
            background: 'var(--bg2)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            maxHeight: '520px',
            overflowY: 'auto',
            fontSize: '12px',
          }}
        >
          <DebateFeedView
            messages={messages}
            currentRound={currentRound}
            isDebating={isStreaming}
            onOpenPartEditor={onOpenPartEditor}
          />
          <div ref={messagesEndRef} />
        </div>
      )}

      {messages.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          <textarea
            rows={1}
            value={liveFeedback}
            onChange={(e) => setLiveFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendLiveFeedback();
              }
            }}
            placeholder="💬 Góp ý trực tiếp cho 2 AI (Enter để gửi)..."
            style={{
              flex: 1,
              padding: '7px 10px',
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text)',
              fontSize: '12px',
              outline: 'none',
              resize: 'none',
              minHeight: '36px',
            }}
          />
          <button
            type="button"
            onClick={handleSendLiveFeedback}
            disabled={isStreaming || !liveFeedback.trim()}
            style={{
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isStreaming || !liveFeedback.trim() ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            💬 Gửi góp ý
          </button>
        </div>
      )}
    </div>
  );
});
