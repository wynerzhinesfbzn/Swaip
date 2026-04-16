import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const API = window.location.origin;

function getMeetingIdFromPath(): string {
  const m = window.location.pathname.match(/^\/meet\/([^/?#]+)/);
  return m ? m[1] : '';
}
function getTokenFromQuery(): string {
  return new URLSearchParams(window.location.search).get('token') || '';
}

interface MeetingInfo {
  name: string;
  startTime: number | null;
  tokenType: string;
  hasCodeWord: boolean;
  allowAnonymous: boolean;
  tokenExpiry: number | null;
  anonymousToken: string | null;
}

const RULES_KEY = 'hasSeenMeetingRules';

function RulesModal({ onAccept }: { onAccept: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        backdropFilter: 'blur(8px)' }}>
      <motion.div initial={{ scale: 0.88, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ background: '#0f0f1a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 24,
          padding: 28, width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(99,102,241,0.2)' }}>
        <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>📋</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', marginBottom: 18,
          textAlign: 'center', fontFamily: 'Montserrat,sans-serif' }}>Правила конференции</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {[
            ['🖐️', 'Не перебивайте, поднимайте руку'],
            ['🎙️', 'Отключайте микрофон, когда не говорите'],
            ['🚫', 'Не записывайте экран без разрешения ведущего'],
            ['🔐', 'Не передавайте токен доступа посторонним'],
          ].map(([icon, text]) => (
            <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5,
                fontFamily: 'Montserrat,sans-serif' }}>{text}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center',
          marginBottom: 20, fontFamily: 'Arial,sans-serif' }}>Спасибо за понимание!</div>
        <motion.button whileTap={{ scale: 0.95 }} onClick={onAccept}
          style={{ width: '100%', padding: 14, background: 'linear-gradient(135deg,#6366f1,#818cf8)',
            border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'Montserrat,sans-serif' }}>
          ✅ Понятно, начинаем!
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

export default function MeetingJoin() {
  const meetingId = getMeetingIdFromPath();
  const urlToken  = getTokenFromQuery();

  const [info,       setInfo]       = useState<MeetingInfo | null>(null);
  const [infoErr,    setInfoErr]    = useState('');
  const [loading,    setLoading]    = useState(true);

  const [fName,      setFName]      = useState('');
  const [fLastName,  setFLastName]  = useState('');
  const [fPosition,  setFPosition]  = useState('');
  const [fToken,     setFToken]     = useState(urlToken);
  const [fCodeWord,  setFCodeWord]  = useState('');
  const [isAnon,     setIsAnon]     = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [countdown,  setCountdown]  = useState('');
  const [showRules,  setShowRules]  = useState(false);
  const [pendingNav, setPendingNav] = useState('');

  useEffect(() => {
    if (!meetingId) { setInfoErr('Комната не найдена'); setLoading(false); return; }
    fetch(`${API}/api/meetings/info/${meetingId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setInfoErr(d.error); }
        else { setInfo(d); }
      })
      .catch(() => setInfoErr('Ошибка подключения'))
      .finally(() => setLoading(false));
  }, [meetingId]);

  useEffect(() => {
    if (!info?.startTime) return;
    const update = () => {
      const diff = info.startTime! * 1000 - Date.now();
      if (diff <= 0) { setCountdown(''); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown([h && `${h}ч`, m && `${m}м`, `${s}с`].filter(Boolean).join(' '));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [info?.startTime]);

  const doNavigate = (path: string) => {
    window.location.href = path;
  };

  /* Токен в URL совпадает с anonymousToken комнаты → автоматический анонимный вход */
  const isAnonByUrl = !!(
    info?.anonymousToken &&
    urlToken.toUpperCase() === info.anonymousToken.toUpperCase()
  );

  const effectiveIsAnon = isAnonByUrl || isAnon;

  const canSubmit = effectiveIsAnon
    ? !submitting
    : !submitting && fName.trim() !== '';

  const handleSubmit = async () => {
    if (!effectiveIsAnon && !fName.trim()) { setError('Введите ваше имя'); return; }
    setError(''); setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        meetingId,
        token: fToken.trim() || undefined,
        codeWord: fCodeWord.trim() || undefined,
        isAnonymous: effectiveIsAnon,
      };
      if (!effectiveIsAnon) {
        body.name = fName.trim();
        body.lastName = fLastName.trim();
        body.position = fPosition.trim() || undefined;
      }
      const r = await fetch(`${API}/api/meetings/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Ошибка входа'); setSubmitting(false); return; }

      sessionStorage.setItem(`meetingToken_${meetingId}`, d.participantToken);
      sessionStorage.setItem(`meetingData_${meetingId}`, JSON.stringify(d.meetingData));

      const targetPath = `/meeting-room/${meetingId}`;
      if (!localStorage.getItem(RULES_KEY)) {
        setPendingNav(targetPath);
        setShowRules(true);
      } else {
        doNavigate(targetPath);
      }
    } catch { setError('Ошибка подключения'); setSubmitting(false); }
  };

  const handleRulesAccept = () => {
    localStorage.setItem(RULES_KEY, '1');
    setShowRules(false);
    doNavigate(pendingNav);
  };

  const ACCENT = '#6366f1';

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a12', display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: 'Montserrat,sans-serif', fontSize: 16 }}>
      Загружаем...
    </div>
  );

  if (infoErr) return (
    <div style={{ minHeight: '100vh', background: '#0a0a12', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Montserrat,sans-serif' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🚫</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Комната не найдена</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>{infoErr}</div>
    </div>
  );

  const notYetStarted = info?.startTime && Date.now() < info.startTime * 1000;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a12', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
      fontFamily: 'Montserrat,sans-serif' }}>

      <AnimatePresence>{showRules && <RulesModal onAccept={handleRulesAccept} />}</AnimatePresence>

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        style={{ width: '100%', maxWidth: 420 }}>

        {/* Заголовок */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 4 }}>
            {info?.name}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(165,180,252,0.7)', fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Комната #{meetingId}
          </div>
          {info?.startTime && (
            <div style={{ marginTop: 10, padding: '6px 14px',
              background: notYetStarted ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.08)',
              border: `1px solid ${notYetStarted ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.25)'}`,
              borderRadius: 10, display: 'inline-block' }}>
              <span style={{ fontSize: 12, color: notYetStarted ? '#fbbf24' : '#86efac', fontWeight: 700 }}>
                {notYetStarted
                  ? `⏳ Начало через: ${countdown}`
                  : `🟢 Идёт • начато ${new Date(info.startTime * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
              </span>
            </div>
          )}
        </div>

        {/* Форма */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 24, padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4, textAlign: 'center' }}>
            Вход в конференцию
          </div>

          {/* Анонимный гость по URL-токену — специальный экран */}
          {isAnonByUrl ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>🎭</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
                Анонимный гость
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: 16 }}>
                Вы войдёте без имени и фамилии.<br />
                Другие участники увидят вас как <strong style={{ color: '#a5b4fc' }}>«Гость»</strong>.<br />
                Вы можете писать в чат и поднимать руку.
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '10px', borderRadius: 12,
                background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', marginBottom: 8, textAlign: 'left' }}>
                <span style={{ fontSize: 16 }}>🚫</span>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Рисование на доске и отправка файлов — недоступны
                </div>
              </div>
            </div>
          ) : (
            <>
          {/* Анонимный вход (чекбокс) */}
          {info?.allowAnonymous && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              padding: '10px 14px', borderRadius: 12,
              background: isAnon ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isAnon ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
              transition: 'all .2s' }}>
              <input
                type="checkbox" checked={isAnon} onChange={e => setIsAnon(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: ACCENT, cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>👤 Войти анонимно</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                  Вы будете видны как «Гость» — имя не требуется
                </div>
              </div>
            </label>
          )}

          {/* Имя + Фамилия (скрыты если анонимно) */}
          {!isAnon && (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                    letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Имя *
                  </label>
                  <input value={fName} onChange={e => setFName(e.target.value)}
                    placeholder="Иван"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
                      border: `1.5px solid ${fName ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 10, padding: '11px 12px', color: '#fff', fontSize: 14,
                      outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .2s' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                    letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                    Фамилия
                  </label>
                  <input value={fLastName} onChange={e => setFLastName(e.target.value)}
                    placeholder="Иванов"
                    style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
                      border: `1.5px solid ${fLastName ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 10, padding: '11px 12px', color: '#fff', fontSize: 14,
                      outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .2s' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  Должность (необязательно)
                </label>
                <input value={fPosition} onChange={e => setFPosition(e.target.value)}
                  placeholder="Менеджер проекта"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
                    border: '1.5px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, padding: '11px 12px', color: '#fff', fontSize: 14,
                    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </div>
            </>
          )}

          {/* Токен — скрываем для открытых конференций */}
          {info?.tokenType === 'open' ? (
            <div style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🚪</span>
              <div style={{ fontSize: 13, color: 'rgba(134,239,172,0.8)', fontWeight: 700 }}>
                Открытая конференция — токен не нужен
              </div>
            </div>
          ) : urlToken ? (
            <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>🔑</span>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(134,239,172,0.7)', fontWeight: 700, marginBottom: 2 }}>
                  ТОКЕН ИЗ ССЫЛКИ
                </div>
                <div style={{ fontSize: 14, color: '#86efac', fontWeight: 800, letterSpacing: '0.1em', fontFamily: 'monospace' }}>
                  {urlToken}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Токен доступа *
              </label>
              <input value={fToken} onChange={e => setFToken(e.target.value.toUpperCase())}
                placeholder="ABC123"
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
                  border: `1.5px solid ${fToken ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 10, padding: '11px 12px', color: '#fff', fontSize: 15,
                  outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace',
                  letterSpacing: '0.12em', transition: 'border-color .2s' }} />
            </div>
          )}

          {/* Кодовое слово (только если есть у комнаты) */}
          {info?.hasCodeWord && !isAnonByUrl && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Кодовое слово *
              </label>
              <input value={fCodeWord} onChange={e => setFCodeWord(e.target.value)}
                placeholder="Введите кодовое слово"
                style={{ width: '100%', background: 'rgba(255,255,255,0.06)',
                  border: `1.5px solid ${fCodeWord ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 10, padding: '11px 12px', color: '#fff', fontSize: 14,
                  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .2s' }} />
            </div>
          )}
            </>
          )}

          {/* Ошибка */}
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#fca5a5', textAlign: 'center' }}>
                ⚠️ {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Кнопка входа */}
          <motion.button whileTap={{ scale: 0.97 }} onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ padding: 15,
              background: canSubmit
                ? 'linear-gradient(135deg,#6366f1,#818cf8)' : 'rgba(255,255,255,0.08)',
              border: 'none', borderRadius: 14,
              color: canSubmit ? '#fff' : 'rgba(255,255,255,0.3)',
              fontSize: 16, fontWeight: 800, cursor: canSubmit ? 'pointer' : 'default',
              fontFamily: 'Montserrat,sans-serif', letterSpacing: '0.03em',
              transition: 'background .2s' }}>
            {submitting ? '⏳ Входим...' : isAnonByUrl ? '🎭 Войти анонимно' : effectiveIsAnon ? '👤 Войти анонимно' : '🚀 Войти в конференцию'}
          </motion.button>

        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11,
          color: 'rgba(255,255,255,0.2)', fontFamily: 'Arial,sans-serif' }}>
          SWAIP · Конференции
        </div>
      </motion.div>
    </div>
  );
}
