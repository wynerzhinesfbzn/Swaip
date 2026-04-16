import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const API = window.location.origin;
const ACCENT = '#6366f1';

export interface ChatMessage {
  id: number;
  meetingId: string;
  participantId: string;
  senderName: string;
  type: 'text' | 'audio' | 'file';
  content: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  createdAt: string;
}

interface Props {
  meetingId: string;
  participantToken: string;
  myParticipantId: string;
  myRole: string;
  wsRef: React.RefObject<WebSocket | null>;
  isAnonymous?: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function MeetingChat({ meetingId, participantToken, myParticipantId, myRole, wsRef, isAnonymous = false }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shouldStopRef = useRef(false);

  const canDelete = ['host', 'co-host', 'moderator'].includes(myRole);

  const scrollToBottom = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, []);

  const fetchMessages = useCallback(() => {
    fetch(`${API}/api/meetings/${meetingId}/messages`, {
      headers: { 'x-participant-token': participantToken },
      credentials: 'include',
    })
      .then(r => r.json())
      .then(d => {
        if (d.messages) {
          setMessages(d.messages);
          setTimeout(scrollToBottom, 50);
        }
      })
      .catch(() => {});
  }, [meetingId, participantToken, scrollToBottom]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 8000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'new_message') {
          setMessages(prev => {
            if (prev.some(m => m.id === msg.message.id)) return prev;
            setTimeout(scrollToBottom, 50);
            return [...prev, msg.message];
          });
        } else if (msg.type === 'message_deleted') {
          setMessages(prev => prev.filter(m => m.id !== msg.messageId));
        }
      } catch {}
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, scrollToBottom]);

  const sendText = useCallback(async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setSending(true);
    setText('');
    try {
      const res = await fetch(`${API}/api/meetings/${meetingId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-participant-token': participantToken,
        },
        credentials: 'include',
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.message) {
          setMessages(prev => {
            if (prev.some(m => m.id === d.message.id)) return prev;
            setTimeout(scrollToBottom, 50);
            return [...prev, d.message];
          });
        }
      }
    } catch {}
    setSending(false);
  }, [text, sending, meetingId, participantToken, scrollToBottom]);

  const deleteMessage = useCallback(async (id: number) => {
    await fetch(`${API}/api/meetings/messages/${id}`, {
      method: 'DELETE',
      headers: { 'x-participant-token': participantToken },
      credentials: 'include',
    });
  }, [participantToken]);

  const startRecording = useCallback(async () => {
    shouldStopRef.current = false;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    if (shouldStopRef.current) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    const mimeType =
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
      MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
      MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' :
      'audio/mp4';
    const mr = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      stream!.getTracks().forEach(t => t.stop());
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (blob.size < 500) return;
      const fd = new FormData();
      fd.append('file', blob, `voice-${Date.now()}.${ext}`);
      try {
        await fetch(`${API}/api/meetings/${meetingId}/messages/upload`, {
          method: 'POST',
          headers: { 'x-participant-token': participantToken },
          credentials: 'include',
          body: fd,
        });
      } catch {}
    };
    mr.start(100);
    mediaRecorderRef.current = mr;
    if (shouldStopRef.current) {
      mr.stop();
      mediaRecorderRef.current = null;
      return;
    }
    setRecording(true);
    setRecordingSec(0);
    timerRef.current = setInterval(() => setRecordingSec(s => s + 1), 1000);
  }, [meetingId, participantToken]);

  const stopRecording = useCallback(() => {
    shouldStopRef.current = true;
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    setRecordingSec(0);
  }, []);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file, file.name);
    await fetch(`${API}/api/meetings/${meetingId}/messages/upload`, {
      method: 'POST',
      headers: { 'x-participant-token': participantToken },
      credentials: 'include',
      body: fd,
    });
    e.target.value = '';
  }, [meetingId, participantToken]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a12' }}>
      {/* Список сообщений */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 40, color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
            Пока нет сообщений. Начните общение!
          </div>
        )}

        {messages.map(msg => {
          const isMine = msg.participantId === myParticipantId;
          const firstName = msg.senderName.split(' ')[0];
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              style={{
                display: 'flex', flexDirection: 'column',
                alignItems: isMine ? 'flex-end' : 'flex-start',
              }}
            >
              {!isMine && (
                <div style={{ fontSize: 10, color: 'rgba(165,180,252,0.6)', marginBottom: 3, paddingLeft: 4 }}>
                  {msg.senderName}
                </div>
              )}

              <div style={{ position: 'relative', maxWidth: '80%' }}>
                <div style={{
                  borderRadius: isMine ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                  padding: msg.type === 'text' ? '10px 14px' : '10px 12px',
                  background: isMine
                    ? `linear-gradient(135deg,${ACCENT},#818cf8)`
                    : 'rgba(255,255,255,0.06)',
                  border: isMine ? 'none' : '1px solid rgba(255,255,255,0.08)',
                }}>
                  {msg.type === 'text' && (
                    <div style={{ fontSize: 14, color: '#fff', lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {msg.content}
                    </div>
                  )}
                  {msg.type === 'audio' && (
                    <div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>🎙 Голосовое</div>
                      <audio
                        controls
                        src={`${API}${msg.fileUrl}`}
                        style={{ height: 32, maxWidth: 220 }}
                      />
                    </div>
                  )}
                  {msg.type === 'file' && (
                    <a
                      href={`${API}${msg.fileUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        textDecoration: 'none', color: '#fff',
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                        background: 'rgba(255,255,255,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                      }}>
                        📎
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, maxWidth: 160,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {msg.fileName || 'Файл'}
                        </div>
                        {msg.fileSize && (
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                            {formatSize(msg.fileSize)}
                          </div>
                        )}
                      </div>
                    </a>
                  )}
                </div>

                {(canDelete || isMine) && (
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => deleteMessage(msg.id)}
                    style={{
                      position: 'absolute', top: -6, right: isMine ? 'auto' : -6, left: isMine ? -6 : 'auto',
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'rgba(239,68,68,0.8)', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#fff', opacity: 0, transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                  >
                    ✕
                  </motion.button>
                )}
              </div>

              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 3,
                paddingLeft: 4, paddingRight: 4 }}>
                {formatTime(msg.createdAt)}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Поле ввода */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end', gap: 8,
      }}>
        {/* Запись голоса (не для анонимов) */}
        {!isAnonymous && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {recording && (
              <>
                <motion.div animate={{ scale: [1, 1.6], opacity: [0.4, 0] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
                  style={{ position: 'absolute', inset: -4, borderRadius: '50%',
                    background: '#ef4444', pointerEvents: 'none' }} />
                <motion.div animate={{ scale: [1, 1.9], opacity: [0.2, 0] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut', delay: 0.28 }}
                  style={{ position: 'absolute', inset: -4, borderRadius: '50%',
                    background: '#ef4444', pointerEvents: 'none' }} />
              </>
            )}
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={recording ? stopRecording : startRecording}
              onContextMenu={e => e.preventDefault()}
              style={{
                position: 'relative', zIndex: 1,
                width: 38, height: 38, borderRadius: '50%', border: 'none',
                cursor: 'pointer',
                background: recording ? 'linear-gradient(135deg,#ef4444,#f87171)' : 'rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: recording ? '0 0 16px rgba(239,68,68,0.5)' : 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
                userSelect: 'none', WebkitUserSelect: 'none',
                touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
              }}
              title={recording ? 'Нажмите чтобы остановить и отправить' : 'Нажмите чтобы начать запись'}
            >
              <span style={{ fontSize: 16 }}>{recording ? '⏹' : '🎙'}</span>
            </motion.button>
          </div>
        )}

        {recording ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: '8px 14px',
            border: '1px solid rgba(239,68,68,0.3)' }}>
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}
              style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }}
            />
            <span style={{ fontSize: 13, color: '#f87171', fontWeight: 700 }}>
              Запись {recordingSec}с — отпустите для отправки
            </span>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Написать сообщение..."
            rows={1}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
              padding: '8px 12px', color: '#fff', fontSize: 14,
              fontFamily: 'Montserrat,sans-serif', resize: 'none', outline: 'none',
              maxHeight: 96, overflowY: 'auto',
            }}
          />
        )}

        {/* Прикрепить файл (не для анонимов) */}
        {!isAnonymous && (
          <>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFile} />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                flexShrink: 0, width: 38, height: 38, borderRadius: '50%', border: 'none',
                cursor: 'pointer', background: 'rgba(255,255,255,0.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title="Прикрепить файл"
            >
              <span style={{ fontSize: 16 }}>📎</span>
            </motion.button>
          </>
        )}

        {/* Отправить */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={sendText}
          disabled={sending || !text.trim()}
          style={{
            flexShrink: 0, width: 38, height: 38, borderRadius: '50%', border: 'none',
            cursor: text.trim() ? 'pointer' : 'default',
            background: text.trim()
              ? `linear-gradient(135deg,${ACCENT},#818cf8)`
              : 'rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.2s',
          }}
        >
          <span style={{ fontSize: 16 }}>➤</span>
        </motion.button>
      </div>
    </div>
  );
}
