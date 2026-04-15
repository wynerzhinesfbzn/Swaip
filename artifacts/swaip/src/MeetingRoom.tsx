import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  useIsSpeaking,
  useTracks,
} from '@livekit/components-react';
import { Track, type Participant, RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import MeetingChat from './MeetingChat';
const MeetingWhiteboard = React.lazy(() => import('./MeetingWhiteboard'));

const API = window.location.origin;
const ACCENT = '#6366f1';

function getMeetingIdFromPath(): string {
  const m = window.location.pathname.match(/^\/meeting-room\/([^/?#]+)/);
  return m ? m[1] : '';
}

/* ── Типы ─────────────────────────────────── */
interface ParticipantInfo {
  participantId: string;
  meetingId: string;
  meetingName: string;
  name: string;
  lastName: string;
  position: string | null;
  isHost: boolean;
  role: string;
  isAnonymous?: boolean;
}

interface LiveKitInfo {
  token: string;
  serverUrl: string;
  isHost: boolean;
  meetingName: string;
}

interface DbParticipant {
  participantId: string;
  name: string;
  lastName: string;
  position: string | null;
  role: string;
  isAnonymous: boolean;
  number?: number;
}

interface CtxMenu {
  x: number;
  y: number;
  targetId: string;
  targetRole: string;
  targetName: string;
}

/* ── Вспомогательные ──────────────────────── */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(p => p.length > 0);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '??';
}

function parseDisplayName(name: string): { firstName: string; lastName: string; position: string | null } {
  const [namePart, position] = (name || '').split(' · ');
  const parts = (namePart || '').trim().split(/\s+/).filter(p => p.length > 0);
  return { firstName: parts[0] || '', lastName: parts[1] || '', position: position || null };
}

function roleBadge(role: string): { icon: string; color: string; border: string } {
  switch (role) {
    case 'host':      return { icon: '👑', color: '#f59e0b', border: '2px solid #f59e0b' };
    case 'co-host':   return { icon: '⭐', color: '#94a3b8', border: '2px solid #94a3b8' };
    case 'moderator': return { icon: '🛡️', color: '#3b82f6', border: '2px solid #3b82f6' };
    default:          return { icon: '', color: 'transparent', border: '2px solid transparent' };
  }
}

/* ── Кружок участника ─────────────────────── */
function ParticipantCircle({
  participant, isLocal, iAmRole, dbInfo, onContext,
}: {
  participant: Participant;
  isLocal: boolean;
  iAmRole: string;
  dbInfo?: DbParticipant;
  onContext: (e: React.MouseEvent | { clientX: number; clientY: number }, targetId: string) => void;
}) {
  const isSpeaking = useIsSpeaking(participant);
  const handRaised = participant.attributes?.handRaised === 'true';
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: false });
  const micTrack = tracks.find(t => t.participant.identity === participant.identity);
  const isMicOn = micTrack?.publication?.isMuted === false;

  const role = dbInfo?.role || 'participant';
  const isAnon = dbInfo?.isAnonymous ?? false;
  const badge = roleBadge(isAnon ? '' : role);

  const parsed = parseDisplayName(participant.name || participant.identity);
  const displayFirst = isAnon ? 'Гость' : (dbInfo?.name || parsed.firstName);
  const displayLast  = isAnon ? (dbInfo?.lastName || '') : (dbInfo?.lastName || parsed.lastName);
  const initials     = isAnon ? '👤' : getInitials(`${displayFirst} ${displayLast}` || participant.identity);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canManage = ['host', 'co-host', 'moderator'].includes(iAmRole) && !isLocal;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!canManage) return;
    e.preventDefault();
    onContext(e, participant.identity);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canManage) return;
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      onContext({ clientX: touch.clientX, clientY: touch.clientY }, participant.identity);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const circleBackground = role === 'host'
    ? 'linear-gradient(135deg,#f59e0b,#fbbf24)'
    : role === 'co-host'
    ? 'linear-gradient(135deg,#64748b,#94a3b8)'
    : isLocal
    ? `linear-gradient(135deg,${ACCENT},#818cf8)`
    : isAnon
    ? 'linear-gradient(135deg,#374151,#374151)'
    : 'linear-gradient(135deg,#374151,#4b5563)';

  const circleBorder = isSpeaking
    ? `2px solid ${ACCENT}`
    : handRaised
    ? '2px solid #ef4444'
    : isAnon
    ? '2px dashed rgba(156,163,175,0.5)'
    : badge.border;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative' }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div style={{ position: 'relative' }}>
        {isSpeaking && (
          <>
            <motion.div animate={{ scale: [1, 1.35], opacity: [0.4, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
              style={{ position: 'absolute', inset: -6, borderRadius: '50%', background: ACCENT, pointerEvents: 'none' }} />
            <motion.div animate={{ scale: [1, 1.55], opacity: [0.25, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut', delay: 0.3 }}
              style={{ position: 'absolute', inset: -6, borderRadius: '50%', background: ACCENT, pointerEvents: 'none' }} />
          </>
        )}
        {handRaised && (
          <motion.div animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 1, repeat: Infinity }}
            style={{ position: 'absolute', inset: -4, borderRadius: '50%', border: '2px solid #ef4444', pointerEvents: 'none' }} />
        )}
        <motion.div
          whileTap={canManage ? { scale: 0.93 } : {}}
          style={{
            width: 64, height: 64, borderRadius: '50%',
            cursor: canManage ? 'context-menu' : 'default',
            background: circleBackground,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: isAnon ? 26 : 22, fontWeight: 900, color: '#fff',
            fontFamily: 'Montserrat,sans-serif',
            border: circleBorder,
            position: 'relative', flexShrink: 0, transition: 'border 0.3s',
          }}
        >
          {initials}
          <div style={{
            position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%',
            background: isMicOn ? '#22c55e' : '#6b7280',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, border: '2px solid #0a0a12',
          }}>
            {isMicOn ? '🎤' : '🔇'}
          </div>
          {badge.icon && (
            <div style={{
              position: 'absolute', top: -4, left: -4, width: 20, height: 20, borderRadius: '50%',
              background: '#0a0a12', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, border: `1.5px solid ${badge.color}`,
            }}>
              {badge.icon}
            </div>
          )}
          {isAnon && !badge.icon && (
            <div style={{
              position: 'absolute', top: -4, left: -4, width: 20, height: 20, borderRadius: '50%',
              background: '#0a0a12', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, border: '1.5px solid #6b7280',
            }}>
              👤
            </div>
          )}
        </motion.div>
        {handRaised && (
          <div style={{
            position: 'absolute', top: -8, right: -8, background: '#ef4444', borderRadius: '50%',
            width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
          }}>✋</div>
        )}
      </div>
      <div style={{ textAlign: 'center', maxWidth: 80 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: isAnon ? 'rgba(255,255,255,0.5)' : '#fff',
          fontStyle: isAnon ? 'italic' : 'normal',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
          {displayFirst} {displayLast}
        </div>
        {!isAnon && dbInfo?.position && (
          <div style={{ fontSize: 9, color: 'rgba(165,180,252,0.6)', marginTop: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
            {dbInfo.position}
          </div>
        )}
        {isLocal && <div style={{ fontSize: 9, color: 'rgba(99,102,241,0.7)', marginTop: 1 }}>Вы</div>}
      </div>
    </div>
  );
}

/* ── Кружок участника (без LiveKit) ──────── */
function SimpleParticipantCircle({
  dbInfo, isLocal, iAmRole, onContext,
}: {
  dbInfo: DbParticipant;
  isLocal: boolean;
  iAmRole: string;
  onContext: (e: React.MouseEvent | { clientX: number; clientY: number }, targetId: string) => void;
}) {
  const role    = dbInfo.role;
  const isAnon  = dbInfo.isAnonymous;
  const badge   = roleBadge(isAnon ? '' : role);
  const displayFirst = isAnon ? 'Гость' : dbInfo.name;
  const displayLast  = isAnon ? (dbInfo.lastName || '') : dbInfo.lastName;
  const initials     = isAnon ? '👤' : getInitials(`${displayFirst} ${displayLast}`);
  const canManage    = ['host', 'co-host', 'moderator'].includes(iAmRole) && !isLocal;

  const circleBackground = role === 'host'
    ? 'linear-gradient(135deg,#f59e0b,#fbbf24)'
    : role === 'co-host'
    ? 'linear-gradient(135deg,#64748b,#94a3b8)'
    : isLocal
    ? `linear-gradient(135deg,${ACCENT},#818cf8)`
    : isAnon
    ? 'linear-gradient(135deg,#374151,#374151)'
    : 'linear-gradient(135deg,#374151,#4b5563)';

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!canManage) return; e.preventDefault(); onContext(e, dbInfo.participantId);
  };
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canManage) return;
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      onContext({ clientX: touch.clientX, clientY: touch.clientY }, dbInfo.participantId);
    }, 600);
  };
  const handleTouchEnd = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, position:'relative' }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}>
      <div style={{ position:'relative' }}>
        <motion.div whileTap={canManage ? { scale:0.93 } : {}}
          style={{ width:64, height:64, borderRadius:'50%', cursor: canManage ? 'context-menu' : 'default',
            background: circleBackground, display:'flex', alignItems:'center', justifyContent:'center',
            fontSize: isAnon ? 26 : 22, fontWeight:900, color:'#fff', fontFamily:'Montserrat,sans-serif',
            border: isAnon ? '2px dashed rgba(107,114,128,0.55)' : badge.border,
            position:'relative', flexShrink:0, transition:'border 0.3s' }}>
          {initials}
          {/* микрофон недоступен — нет LiveKit */}
          <div style={{ position:'absolute', bottom:-2, right:-2, width:20, height:20, borderRadius:'50%',
            background:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:10, border:'2px solid #0a0a12' }}>🔇</div>
          {badge.icon && (
            <div style={{ position:'absolute', top:-4, left:-4, width:20, height:20, borderRadius:'50%',
              background:'#0a0a12', display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:11, border:`1.5px solid ${badge.color}` }}>
              {badge.icon}
            </div>
          )}
          {isAnon && !badge.icon && (
            <div style={{ position:'absolute', top:-4, left:-4, width:20, height:20, borderRadius:'50%',
              background:'#0a0a12', display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:10, border:'1.5px solid #6b7280' }}>👤</div>
          )}
        </motion.div>
      </div>
      <div style={{ textAlign:'center', maxWidth:80 }}>
        <div style={{ fontSize:11, fontWeight:700, color: isAnon ? 'rgba(255,255,255,0.5)' : '#fff',
          fontStyle: isAnon ? 'italic' : 'normal',
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:80 }}>
          {displayFirst} {displayLast}
        </div>
        {!isAnon && dbInfo.position && (
          <div style={{ fontSize:9, color:'rgba(165,180,252,0.6)', marginTop:1,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:80 }}>
            {dbInfo.position}
          </div>
        )}
        {isLocal && <div style={{ fontSize:9, color:'rgba(99,102,241,0.7)', marginTop:1 }}>Вы</div>}
      </div>
    </div>
  );
}

/* ── Водяной знак ─────────────────────────── */
function Watermark({ name, isAnon }: { name: string; isAnon: boolean }) {
  const [time, setTime] = useState(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{
      position: 'fixed', bottom: 80, right: 12,
      opacity: 0.25, fontSize: 11, color: '#aaa',
      pointerEvents: 'none', zIndex: 9999, fontFamily: 'monospace',
      userSelect: 'none', textAlign: 'right', lineHeight: 1.5,
    }}>
      {isAnon ? 'Гость' : name}<br />{time}
    </div>
  );
}


/* ── Внутренность комнаты ─────────────────── */
function RoomInner({
  info, iAmRole, meetingId, participantToken, wsRef, onLeave, onEnd,
}: {
  info: ParticipantInfo; iAmRole: string; meetingId: string;
  participantToken: string; wsRef: React.RefObject<WebSocket | null>;
  onLeave: () => void; onEnd: () => void;
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const [micEnabled, setMicEnabled] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [wbFullscreen, setWbFullscreen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [dbParticipants, setDbParticipants] = useState<DbParticipant[]>([]);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [myRole, setMyRole] = useState<string>(iAmRole);

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 2800);
  }, []);

  /* Загружаем список DB-участников */
  const fetchDbParticipants = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/meetings/${meetingId}/participants`, {
        headers: { 'x-participant-token': participantToken },
      });
      if (r.ok) {
        const data = await r.json();
        setDbParticipants(data.participants || []);
        const me = (data.participants as DbParticipant[]).find(p => p.participantId === info.participantId);
        if (me) setMyRole(me.role);
      }
    } catch {}
  }, [meetingId, participantToken, info.participantId]);

  useEffect(() => {
    fetchDbParticipants();
    const t = setInterval(fetchDbParticipants, 5000);
    return () => clearInterval(t);
  }, [fetchDbParticipants]);

  /* LiveKit события */
  useEffect(() => {
    if (!room) return;
    const onConn = () => setConnected(true);
    const onDisc = () => {
      setConnected(false);
      showToast('⚠️ Соединение с аудио потеряно');
    };
    room.on(RoomEvent.Connected, onConn);
    room.on(RoomEvent.Disconnected, onDisc);
    if (room.state === 'connected') setConnected(true);
    return () => { room.off(RoomEvent.Connected, onConn); room.off(RoomEvent.Disconnected, onDisc); };
  }, [room, onLeave]);

  /* WS события: непрочитанные, kick, meeting_ended, mute_all, role_change */
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'new_message' && (wbFullscreen && !showOverlay)) {
          setUnreadChat(n => n + 1);
        }
        if (msg.type === 'meeting_ended') {
          sessionStorage.removeItem(`meetingToken_${meetingId}`);
          sessionStorage.removeItem(`meetingData_${meetingId}`);
          sessionStorage.setItem('meetingEndedMsg', 'Совещание завершено ведущим');
          room?.disconnect();
          window.location.href = '/';
        }
        if (msg.type === 'participant_kicked' && msg.participantId === info.participantId) {
          sessionStorage.removeItem(`meetingToken_${meetingId}`);
          sessionStorage.removeItem(`meetingData_${meetingId}`);
          sessionStorage.setItem('meetingEndedMsg', 'Вы были удалены из совещания');
          room?.disconnect();
          window.location.href = '/';
        }
        if (msg.type === 'mute_all') {
          localParticipant?.setMicrophoneEnabled(false).catch(() => {});
          setMicEnabled(false);
          showToast('🔕 Ведущий отключил все микрофоны');
        }
        if (msg.type === 'role_change' && msg.targetId === info.participantId) {
          setMyRole(msg.role);
          showToast(`Ваша роль изменена: ${msg.role}`);
          fetchDbParticipants();
        }
        /* Оптимистичное обновление списка участников */
        if (msg.type === 'participant_joined') {
          if (msg.participantId && msg.name) {
            setDbParticipants(prev => {
              if (prev.some(p => p.participantId === msg.participantId)) return prev;
              return [...prev, {
                participantId: msg.participantId,
                name: msg.name,
                lastName: msg.lastName || '',
                position: msg.position || null,
                isAnonymous: msg.isAnonymous ?? false,
                role: msg.role || 'participant',
                number: msg.number,
              }];
            });
          } else {
            fetchDbParticipants();
          }
        }
        if (msg.type === 'participant_left') {
          if (msg.participantId) {
            setDbParticipants(prev => prev.filter(p => p.participantId !== msg.participantId));
          } else {
            fetchDbParticipants();
          }
        }
        if (msg.type === 'role_change') {
          fetchDbParticipants();
        }
      } catch {}
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, wbFullscreen, showOverlay, meetingId, info.participantId, room, localParticipant, showToast, fetchDbParticipants]);

  useEffect(() => {
    if (showOverlay) setUnreadChat(0);
  }, [showOverlay]);

  /* Микрофон */
  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    try {
      const next = !localParticipant.isMicrophoneEnabled;
      await localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
    } catch { showToast('Не удалось изменить микрофон'); }
  }, [localParticipant, showToast]);

  const toggleHand = useCallback(async () => {
    if (!localParticipant) return;
    const next = !handRaised;
    setHandRaised(next);
    await localParticipant.setAttributes({ handRaised: next ? 'true' : 'false' });
    if (next) showToast('Рука поднята — ведущий вас видит');
  }, [localParticipant, handRaised, showToast]);

  const muteAll = useCallback(async () => {
    try {
      await fetch(`${API}/api/meetings/${meetingId}/mute-all`, {
        method: 'POST',
        headers: { 'x-participant-token': participantToken, 'Content-Type': 'application/json' },
      });
      showToast('🔕 Запрос на отключение микрофонов отправлен');
    } catch { showToast('Не удалось отправить запрос'); }
  }, [meetingId, participantToken, showToast]);

  const handleLeave = useCallback(async () => {
    try {
      await fetch(`${API}/api/meetings/${meetingId}/leave`, {
        method: 'POST',
        headers: { 'x-participant-token': participantToken },
      });
    } catch {}
    if (room) await room.disconnect();
    onLeave();
  }, [room, onLeave, meetingId, participantToken]);

  const handleEnd = useCallback(async () => {
    try {
      await fetch(`${API}/api/meetings/${meetingId}/end`, {
        method: 'POST', credentials: 'include',
      });
    } catch {}
    if (room) await room.disconnect();
    onEnd();
  }, [meetingId, room, onEnd]);

  /* Контекстное меню */
  const handleOpenCtx = useCallback((
    e: React.MouseEvent | { clientX: number; clientY: number },
    targetId: string,
  ) => {
    const db = dbParticipants.find(p => p.participantId === targetId);
    if (!db) return;
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      targetId,
      targetRole: db.role,
      targetName: `${db.name} ${db.lastName}`,
    });
  }, [dbParticipants]);

  const closeCtx = () => setCtxMenu(null);

  const doRoleChange = async (targetId: string, role: string) => {
    closeCtx();
    try {
      const r = await fetch(`${API}/api/meetings/${meetingId}/participants/${targetId}/role`, {
        method: 'PATCH',
        headers: { 'x-participant-token': participantToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (r.ok) {
        showToast(`Роль изменена на ${role}`);
        fetchDbParticipants();
      } else {
        const d = await r.json();
        showToast(d.error || 'Ошибка');
      }
    } catch { showToast('Ошибка сети'); }
  };

  const doKick = async (targetId: string) => {
    closeCtx();
    try {
      const r = await fetch(`${API}/api/meetings/${meetingId}/kick`, {
        method: 'POST',
        headers: { 'x-participant-token': participantToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId }),
      });
      if (r.ok) {
        showToast('Участник удалён');
        fetchDbParticipants();
      } else {
        const d = await r.json();
        showToast(d.error || 'Ошибка');
      }
    } catch { showToast('Ошибка сети'); }
  };

  const canAssignRoles = myRole === 'host' || myRole === 'co-host';
  const isAnon = info.isAnonymous ?? false;
  const canExpand = myRole === 'host' || myRole === 'co-host';
  const watermarkName = isAnon ? 'Гость' : [info.name, info.lastName].filter(Boolean).join(' ');

  /* ── Список участников (источник правды: DB) ── */
  const lkByIdentity = new Map(participants.map(p => [p.identity, p]));
  const displayList: DbParticipant[] = dbParticipants.length > 0
    ? dbParticipants
    : [{ participantId: info.participantId, name: info.name, lastName: info.lastName,
         position: info.position || null, isAnonymous: info.isAnonymous ?? false, role: myRole, number: 1 }];

  /* ── Полоса участников (горизонтальная) ── */
  const participantStrip = (
    <div style={{ display: 'flex', overflowX: 'auto', gap: 10, padding: '10px 14px',
      alignItems: 'flex-start', scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(99,102,241,0.3) transparent', height: '100%', boxSizing: 'border-box' }}>
      {displayList.map((dbp, idx) => {
        const isLocal = dbp.participantId === info.participantId;
        const lkParticipant = lkByIdentity.get(dbp.participantId) ?? null;
        const numLabel = dbp.number ?? (idx + 1);
        return (
          <div key={dbp.participantId} style={{ position: 'relative', flexShrink: 0 }}>
            {/* Порядковый номер */}
            <div style={{ position: 'absolute', top: -4, left: -4, zIndex: 2,
              width: 18, height: 18, borderRadius: '50%',
              background: '#0a0a12', border: '1.5px solid rgba(99,102,241,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 900, color: '#a5b4fc', fontFamily: 'monospace' }}>
              {numLabel}
            </div>
            {lkParticipant ? (
              <ParticipantCircle participant={lkParticipant} isLocal={isLocal}
                iAmRole={myRole} dbInfo={dbp} onContext={handleOpenCtx} />
            ) : (
              <SimpleParticipantCircle dbInfo={dbp} isLocal={isLocal}
                iAmRole={myRole} onContext={handleOpenCtx} />
            )}
          </div>
        );
      })}
    </div>
  );

  /* ── Нижняя панель управления (переиспользуется) ── */
  const controlsBar = (
    <div style={{ padding: '8px 16px 6px', borderTop: '1px solid rgba(255,255,255,0.07)',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexShrink: 0 }}>
      {/* Микрофон */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={toggleMic}
          style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: micEnabled ? `linear-gradient(135deg,${ACCENT},#818cf8)` : 'rgba(107,114,128,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: micEnabled ? `0 0 18px rgba(99,102,241,0.4)` : 'none', transition: 'all 0.25s' }}>
          <span style={{ fontSize: 18 }}>{micEnabled ? '🎤' : '🔇'}</span>
        </motion.button>
        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', fontFamily: 'Montserrat,sans-serif' }}>Микрофон</div>
      </div>
      {/* Рука — доступна всем включая анонимов */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={toggleHand}
          style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: handRaised ? 'linear-gradient(135deg,#ef4444,#f87171)' : 'rgba(107,114,128,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: handRaised ? '0 0 18px rgba(239,68,68,0.4)' : 'none', transition: 'all 0.25s' }}>
          <span style={{ fontSize: 18 }}>✋</span>
        </motion.button>
        <div style={{ fontSize: 8, color: handRaised ? '#fca5a5' : 'rgba(255,255,255,0.3)', fontFamily: 'Montserrat,sans-serif' }}>
          {handRaised ? 'Опустить' : 'Рука'}
        </div>
      </div>
      {/* Заглушить всех */}
      {canExpand && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <motion.button whileTap={{ scale: 0.9 }} onClick={muteAll}
            style={{ width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
              background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 18 }}>🔕</span>
          </motion.button>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', fontFamily: 'Montserrat,sans-serif' }}>Тишина</div>
        </div>
      )}
      {/* Выйти / Завершить */}
      <div style={{ marginLeft: 8, display: 'flex', gap: 8 }}>
        {myRole === 'host' && (
          <motion.button whileTap={{ scale: 0.93 }} onClick={() => setShowEndConfirm(true)}
            style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 10, padding: '6px 10px', color: '#f87171',
              fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'Montserrat,sans-serif' }}>
            Завершить
          </motion.button>
        )}
        <motion.button whileTap={{ scale: 0.93 }} onClick={handleLeave}
          style={{ background: 'rgba(107,114,128,0.2)', border: '1px solid rgba(107,114,128,0.3)',
            borderRadius: 10, padding: '6px 10px', color: 'rgba(255,255,255,0.7)',
            fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'Montserrat,sans-serif' }}>
          Выйти
        </motion.button>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100vh', background: '#0a0a12', display: 'flex',
      flexDirection: 'column', fontFamily: 'Montserrat,sans-serif', overflow: 'hidden' }}>

      <RoomAudioRenderer />
      <Watermark name={watermarkName} isAnon={isAnon} />

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div key="toast" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(99,102,241,0.92)', backdropFilter: 'blur(12px)', borderRadius: 12,
              padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 700, zIndex: 2000,
              boxShadow: '0 4px 24px rgba(99,102,241,0.35)', whiteSpace: 'nowrap' }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Контекстное меню ── */}
      <AnimatePresence>
        {ctxMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 1500 }} onClick={closeCtx} />
            <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
              style={{ position: 'fixed', left: Math.min(ctxMenu.x, window.innerWidth - 210),
                top: Math.min(ctxMenu.y, window.innerHeight - 240), zIndex: 1600,
                background: '#1a1a2e', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 14,
                padding: 8, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(165,180,252,0.6)',
                padding: '4px 12px 8px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {ctxMenu.targetName}
              </div>
              {myRole === 'host' && ctxMenu.targetRole !== 'co-host' && ctxMenu.targetRole !== 'host' && (
                <CtxItem icon="⭐" label="Назначить соведущим" onClick={() => doRoleChange(ctxMenu.targetId, 'co-host')} />
              )}
              {canAssignRoles && ctxMenu.targetRole !== 'moderator' && ctxMenu.targetRole !== 'host' && (
                <CtxItem icon="🛡️" label="Назначить модератором" onClick={() => doRoleChange(ctxMenu.targetId, 'moderator')} />
              )}
              {canAssignRoles && (ctxMenu.targetRole === 'co-host' || ctxMenu.targetRole === 'moderator') && (
                <CtxItem icon="👤" label="Сделать участником" onClick={() => doRoleChange(ctxMenu.targetId, 'participant')} />
              )}
              <div style={{ margin: '6px 0', borderTop: '1px solid rgba(255,255,255,0.07)' }} />
              <CtxItem icon="🔇" label="Отключить микрофон" onClick={() => { showToast('Запрос на отключение отправлен'); closeCtx(); }} />
              {ctxMenu.targetRole !== 'host' && (
                <CtxItem icon="🚫" label="Удалить из комнаты" color="#f87171" onClick={() => doKick(ctxMenu.targetId)} />
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════
          ПОЛНОЭКРАННЫЙ РЕЖИМ ДОСКИ
          ══════════════════════════════════════════ */}
      {wbFullscreen && (
        <>
          {/* Доска на весь экран */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 900, background: '#fff' }}>
            <React.Suspense fallback={
              <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
                color:'#888',fontSize:14,fontFamily:'Montserrat,sans-serif' }}>Загрузка доски...</div>
            }>
              <MeetingWhiteboard meetingId={meetingId} participantToken={participantToken}
                isHost={myRole === 'host' || myRole === 'co-host'} wsRef={wsRef} />
            </React.Suspense>
            {/* Кнопка выхода из полноэкранного режима */}
            <button onClick={() => { setWbFullscreen(false); setShowOverlay(false); }}
              title="Вернуться к обычному режиму"
              style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000,
                width: 36, height: 36, borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.15)',
                background: 'rgba(255,255,255,0.95)', cursor: 'pointer', fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
              ⛶
            </button>
          </div>

          {/* Плавающая кнопка «Участники и чат» */}
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.9 }}
            onClick={() => setShowOverlay(v => !v)}
            style={{ position: 'fixed', right: 16, bottom: 82, zIndex: 1000,
              width: 54, height: 54, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: showOverlay ? '#6366f1' : 'rgba(99,102,241,0.85)',
              backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 24,
              boxShadow: '0 4px 20px rgba(99,102,241,0.5)' }}>
            👥
            {unreadChat > 0 && (
              <div style={{ position: 'absolute', top: -2, right: -2, width: 18, height: 18, borderRadius: '50%',
                background: '#ef4444', fontSize: 9, fontWeight: 800, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {unreadChat > 9 ? '9+' : unreadChat}
              </div>
            )}
          </motion.button>

          {/* Панель управления в fullscreen */}
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
            padding: '8px 16px 6px', background: 'rgba(10,10,18,0.9)', backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {/* Микрофон */}
            <motion.button whileTap={{ scale: 0.9 }} onClick={toggleMic}
              style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: micEnabled ? `linear-gradient(135deg,${ACCENT},#818cf8)` : 'rgba(107,114,128,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                boxShadow: micEnabled ? `0 0 16px rgba(99,102,241,0.4)` : 'none', transition: 'all 0.25s' }}>
              {micEnabled ? '🎤' : '🔇'}
            </motion.button>
            {!isAnon && (
              <motion.button whileTap={{ scale: 0.9 }} onClick={toggleHand}
                style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: handRaised ? 'linear-gradient(135deg,#ef4444,#f87171)' : 'rgba(107,114,128,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                  boxShadow: handRaised ? '0 0 16px rgba(239,68,68,0.4)' : 'none', transition: 'all 0.25s' }}>
                ✋
              </motion.button>
            )}
            {myRole === 'host' && (
              <motion.button whileTap={{ scale: 0.93 }} onClick={() => setShowEndConfirm(true)}
                style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: 10, padding: '6px 12px', color: '#f87171',
                  fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'Montserrat,sans-serif' }}>
                Завершить
              </motion.button>
            )}
            <motion.button whileTap={{ scale: 0.93 }} onClick={handleLeave}
              style={{ background: 'rgba(107,114,128,0.2)', border: '1px solid rgba(107,114,128,0.3)',
                borderRadius: 10, padding: '6px 12px', color: 'rgba(255,255,255,0.7)',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'Montserrat,sans-serif' }}>
              Выйти
            </motion.button>
          </div>

          {/* Оверлей с участниками и чатом */}
          <AnimatePresence>
            {showOverlay && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: 'fixed', inset: 0, zIndex: 1100,
                  background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
                onClick={() => setShowOverlay(false)}>
                <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 32, stiffness: 320 }}
                  onClick={e => e.stopPropagation()}
                  style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '68%',
                    background: '#0f0f1a', borderRadius: '20px 20px 0 0',
                    border: '1px solid rgba(99,102,241,0.2)', display: 'flex', flexDirection: 'column' }}>
                  {/* Шапка оверлея */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 16px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(165,180,252,0.6)',
                      letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Участники ({displayList.length}) и чат
                    </span>
                    <button onClick={() => setShowOverlay(false)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>✕</button>
                  </div>
                  {/* Полоса участников */}
                  <div style={{ height: 115, flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(0,0,0,0.2)', overflowX: 'auto', overflowY: 'hidden' }}>
                    {participantStrip}
                  </div>
                  {/* Чат */}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <MeetingChat meetingId={meetingId} participantToken={participantToken}
                      myParticipantId={info.participantId} myRole={myRole}
                      wsRef={wsRef} isAnonymous={isAnon} />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* ══════════════════════════════════════════
          ОБЫЧНЫЙ РЕЖИМ: Доска 60% + Участники 15% + Чат 25%
          ══════════════════════════════════════════ */}
      {!wbFullscreen && (
        <>
          {/* Шапка */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(12px)', flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#fff', lineHeight: 1.2 }}>{info.meetingName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <motion.div animate={{ opacity: connected ? [0.7, 1, 0.7] : 1 }}
                  transition={{ duration: 1.5, repeat: connected ? Infinity : 0 }}
                  style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#22c55e' : '#ef4444' }} />
                <span style={{ fontSize: 10, color: connected ? '#86efac' : '#fca5a5' }}>
                  {displayList.length} уч.
                </span>
                <span style={{ fontSize: 9, color: roleBadge(myRole).color || 'rgba(255,255,255,0.3)', fontWeight: 700 }}>
                  · {roleBadge(myRole).icon} {myRole}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>
              {isAnon ? `Гость ${info.lastName}` : [info.name, info.lastName].filter(Boolean).join(' ')}
            </div>
          </div>

          {/* ── ДОСКА (60% оставшегося пространства) ── */}
          <div style={{ flex: 6, position: 'relative', overflow: 'hidden',
            borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <React.Suspense fallback={
              <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
                color:'rgba(255,255,255,0.4)',fontSize:14,fontFamily:'Montserrat,sans-serif' }}>
                Загрузка доски...
              </div>
            }>
              <MeetingWhiteboard meetingId={meetingId} participantToken={participantToken}
                isHost={myRole === 'host' || myRole === 'co-host'} wsRef={wsRef} />
            </React.Suspense>
            {/* Кнопка разворачивания (только ведущий/соведущий) */}
            {canExpand && (
              <button onClick={() => setWbFullscreen(true)} title="Развернуть доску на весь экран"
                style={{ position: 'absolute', top: 10, right: 10, zIndex: 20,
                  width: 34, height: 34, borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.15)',
                  background: 'rgba(255,255,255,0.9)', cursor: 'pointer', fontSize: 17,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                ⛶
              </button>
            )}
          </div>

          {/* ── УЧАСТНИКИ (15%, горизонтальная полоса) ── */}
          <div style={{ flex: 1.5, minHeight: 108, maxHeight: 130, flexShrink: 0,
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(0,0,0,0.25)', overflowX: 'auto', overflowY: 'hidden' }}>
            {participantStrip}
          </div>

          {/* ── ЧАТ (25% оставшегося пространства) ── */}
          <div style={{ flex: 2.5, overflow: 'hidden', minHeight: 0 }}>
            <MeetingChat meetingId={meetingId} participantToken={participantToken}
              myParticipantId={info.participantId} myRole={myRole}
              wsRef={wsRef} isAnonymous={isAnon} />
          </div>

          {/* ── ПАНЕЛЬ УПРАВЛЕНИЯ ── */}
          {controlsBar}
        </>
      )}

      {/* ── Модалка завершения совещания ── */}
      <AnimatePresence>
        {showEndConfirm && (
          <motion.div key="endModal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}
            onClick={() => setShowEndConfirm(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              style={{ background: '#151520', borderRadius: 20, padding: 28, maxWidth: 320, width: '100%',
                border: '1px solid rgba(239,68,68,0.25)' }}>
              <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 12 }}>⛔</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', textAlign: 'center', marginBottom: 8 }}>
                Завершить совещание?
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.6, marginBottom: 24 }}>
                Все участники будут отключены и уведомлены.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowEndConfirm(false)}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Montserrat,sans-serif' }}>
                  Отмена
                </motion.button>
                <motion.button whileTap={{ scale: 0.95 }} onClick={handleEnd}
                  style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                    background: 'linear-gradient(135deg,#ef4444,#f87171)', color: '#fff',
                    fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'Montserrat,sans-serif' }}>
                  Завершить
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Пункт контекстного меню ──────────────── */
function CtxItem({ icon, label, onClick, color }: { icon: string; label: string; onClick: () => void; color?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 12px', borderRadius: 10, border: 'none',
        background: hover ? 'rgba(255,255,255,0.07)' : 'transparent',
        cursor: 'pointer', textAlign: 'left', transition: 'background .15s',
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || '#fff', fontFamily: 'Montserrat,sans-serif' }}>{label}</span>
    </button>
  );
}

/* ── Внешняя оболочка: auth + LiveKit токен + WS ─── */
export default function MeetingRoom() {
  const meetingId = getMeetingIdFromPath();
  const [info, setInfo] = useState<ParticipantInfo | null>(null);
  const [lkInfo, setLkInfo] = useState<LiveKitInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!meetingId) { setStatus('error'); setErrorMsg('Некорректная ссылка'); return; }
    const participantToken = sessionStorage.getItem(`meetingToken_${meetingId}`);
    if (!participantToken) { window.location.href = `/meet/${meetingId}`; return; }

    (async () => {
      try {
        const checkRes = await fetch(`${API}/api/meetings/check-participant`, {
          headers: { 'x-participant-token': participantToken },
          credentials: 'include',
        });
        const checkData = await checkRes.json();
        if (!checkData.valid) { window.location.href = `/meet/${meetingId}`; return; }
        setInfo(checkData);

        const tokenRes = await fetch(`${API}/api/meetings/token`, {
          method: 'POST',
          headers: { 'x-participant-token': participantToken, 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (!tokenRes.ok) {
          const e = await tokenRes.json();
          setErrorMsg(e.error || 'Ошибка получения токена'); setStatus('error'); return;
        }
        const lkData = await tokenRes.json();
        setLkInfo(lkData);

        const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsHost = new URL(API).host;
        const ws = new WebSocket(`${wsProtocol}://${wsHost}/api/ws/meeting-chat?token=${encodeURIComponent(participantToken)}`);
        wsRef.current = ws;

        setStatus('ready');
      } catch {
        setErrorMsg('Ошибка подключения к серверу'); setStatus('error');
      }
    })();

    return () => { wsRef.current?.close(); };
  }, [meetingId]);

  const handleLeave = useCallback(() => {
    wsRef.current?.close();
    sessionStorage.removeItem(`meetingToken_${meetingId}`);
    sessionStorage.removeItem(`meetingData_${meetingId}`);
    window.location.href = '/';
  }, [meetingId]);

  const handleEnd = useCallback(() => {
    wsRef.current?.close();
    sessionStorage.removeItem(`meetingToken_${meetingId}`);
    sessionStorage.removeItem(`meetingData_${meetingId}`);
    window.location.href = '/';
  }, [meetingId]);

  const participantToken = sessionStorage.getItem(`meetingToken_${meetingId}`) || '';

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a12', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, fontFamily: 'Montserrat,sans-serif' }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          style={{ width: 40, height: 40, borderRadius: '50%',
            border: '3px solid rgba(99,102,241,0.2)', borderTop: `3px solid ${ACCENT}` }} />
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>Подключение к совещанию...</div>
      </div>
    );
  }

  if (status === 'error' || !info || !lkInfo) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a12', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Montserrat,sans-serif', gap: 12 }}>
        <div style={{ fontSize: 52 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>Нет доступа</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', maxWidth: 280 }}>
          {errorMsg || 'Не удалось подтвердить участие в совещании'}
        </div>
        <motion.button whileTap={{ scale: 0.95 }}
          onClick={() => window.location.href = `/meet/${meetingId}`}
          style={{ marginTop: 8, padding: '12px 28px',
            background: `linear-gradient(135deg,${ACCENT},#818cf8)`,
            border: 'none', borderRadius: 14, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
          Войти снова
        </motion.button>
      </div>
    );
  }

  const iAmRole = info.role || (info.isHost || lkInfo.isHost ? 'host' : 'participant');

  return (
    <LiveKitRoom
      serverUrl={lkInfo.serverUrl}
      token={lkInfo.token}
      connect={true}
      audio={true}
      video={false}
      options={{ adaptiveStream: true, dynacast: true }}
      style={{ height: '100vh' }}
    >
      <RoomInner
        info={info}
        iAmRole={iAmRole}
        meetingId={meetingId}
        participantToken={participantToken}
        wsRef={wsRef}
        onLeave={handleLeave}
        onEnd={handleEnd}
      />
    </LiveKitRoom>
  );
}
