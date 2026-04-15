import React, { useEffect, useRef, useCallback, useState } from 'react';

const API = window.location.origin;
const SAVE_DEBOUNCE_MS = 1500;

interface Props {
  meetingId: string;
  participantToken: string;
  isHost: boolean;
  wsRef: React.RefObject<WebSocket | null>;
}

type Tool = 'pencil' | 'line' | 'rect' | 'ellipse' | 'text' | 'eraser';

type DrawAction =
  | { type: 'pencil'; points: [number, number][]; color: string; width: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string; width: number }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number };

interface Snapshot {
  version: 1;
  actions: DrawAction[];
}

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'pencil',  icon: '✏️', label: 'Карандаш' },
  { id: 'line',    icon: '╱',  label: 'Линия' },
  { id: 'rect',    icon: '▭',  label: 'Прямоугольник' },
  { id: 'ellipse', icon: '⬭',  label: 'Эллипс' },
  { id: 'text',    icon: 'T',  label: 'Текст' },
  { id: 'eraser',  icon: '⬜', label: 'Ластик' },
];

const PALETTE = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const WIDTHS   = [2, 4, 8, 14];

function renderActions(ctx: CanvasRenderingContext2D, actions: DrawAction[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (const a of actions) {
    ctx.save();
    if (a.type !== 'text') {
      ctx.strokeStyle = a.color;
      ctx.lineWidth   = a.width;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
    }

    if (a.type === 'pencil') {
      if (a.points.length < 2) { ctx.restore(); continue; }
      ctx.beginPath();
      ctx.moveTo(a.points[0][0], a.points[0][1]);
      for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i][0], a.points[i][1]);
      ctx.stroke();
    } else if (a.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();
    } else if (a.type === 'rect') {
      ctx.strokeRect(a.x, a.y, a.w, a.h);
    } else if (a.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(a.cx, a.cy, Math.abs(a.rx), Math.abs(a.ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (a.type === 'text') {
      ctx.fillStyle = a.color;
      ctx.font = `${a.size}px Montserrat, sans-serif`;
      ctx.fillText(a.text, a.x, a.y);
    }
    ctx.restore();
  }
}

export default function MeetingWhiteboard({ meetingId, participantToken, isHost, wsRef }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool,    setTool]    = useState<Tool>('pencil');
  const [color,   setColor]   = useState('#111827');
  const [width,   setWidth]   = useState(3);
  const [actions, setActions] = useState<DrawAction[]>([]);
  const [history, setHistory] = useState<DrawAction[][]>([]);

  const actionsRef = useRef<DrawAction[]>([]);

  const drawing  = useRef(false);
  const startXY  = useRef<[number, number]>([0, 0]);
  const pencilPts = useRef<[number, number][]>([]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redraw = useCallback((acts: DrawAction[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderActions(ctx, acts);
  }, []);

  const persistSnapshot = useCallback(async (acts: DrawAction[]) => {
    if (!isHost) return;
    const snapshot: Snapshot = { version: 1, actions: acts };
    try {
      await fetch(`${API}/api/meetings/${meetingId}/whiteboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken },
        credentials: 'include',
        body: JSON.stringify({ snapshot }),
      });
    } catch {}
  }, [meetingId, participantToken, isHost]);

  const scheduleSync = useCallback((acts: DrawAction[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistSnapshot(acts), SAVE_DEBOUNCE_MS);
  }, [persistSnapshot]);

  const applySnapshot = useCallback((snap: unknown) => {
    try {
      const s = snap as Snapshot;
      if (s?.version === 1 && Array.isArray(s.actions)) {
        actionsRef.current = s.actions;
        setActions(s.actions);
        redraw(s.actions);
      }
    } catch {}
  }, [redraw]);

  useEffect(() => {
    fetch(`${API}/api/meetings/${meetingId}/whiteboard`, {
      headers: { 'x-participant-token': participantToken },
      credentials: 'include',
    })
      .then(r => r.json())
      .then(d => { if (d.snapshot) applySnapshot(d.snapshot); })
      .catch(() => {});
  }, [meetingId, participantToken, applySnapshot]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || isHost) return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'whiteboard_update' && msg.snapshot) applySnapshot(msg.snapshot);
      } catch {}
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, isHost, applySnapshot]);

  useEffect(() => {
    redraw(actionsRef.current);
  }, [redraw]);

  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      const cont   = containerRef.current;
      if (!canvas || !cont) return;
      const { width: w, height: h } = cont.getBoundingClientRect();
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        if (overlayRef.current) {
          overlayRef.current.width  = w;
          overlayRef.current.height = h;
        }
        redraw(actionsRef.current);
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [redraw]);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  const getXY = (e: React.MouseEvent | React.TouchEvent): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return [e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top];
    }
    return [(e as React.MouseEvent).clientX - rect.left, (e as React.MouseEvent).clientY - rect.top];
  };

  const clearOverlay = () => {
    const oc = overlayRef.current;
    if (!oc) return;
    const ctx = oc.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, oc.width, oc.height);
  };

  const onPointerDown = (e: React.MouseEvent) => {
    if (!isHost) return;
    if (tool === 'text') return;
    drawing.current = true;
    const [x, y] = getXY(e);
    startXY.current = [x, y];
    pencilPts.current = [[x, y]];
  };

  const onPointerMove = (e: React.MouseEvent) => {
    if (!isHost || !drawing.current) return;
    const [x, y] = getXY(e);
    const [sx, sy] = startXY.current;
    const oc = overlayRef.current;
    if (!oc) return;
    const ctx = oc.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, oc.width, oc.height);

    if (tool === 'pencil' || tool === 'eraser') {
      pencilPts.current.push([x, y]);
      ctx.save();
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx.lineWidth   = tool === 'eraser' ? width * 4 : width;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(pencilPts.current[0][0], pencilPts.current[0][1]);
      for (let i = 1; i < pencilPts.current.length; i++) ctx.lineTo(pencilPts.current[i][0], pencilPts.current[i][1]);
      ctx.stroke();
      ctx.restore();
    } else if (tool === 'line') {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke();
      ctx.restore();
    } else if (tool === 'rect') {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.strokeRect(sx, sy, x - sx, y - sy);
      ctx.restore();
    } else if (tool === 'ellipse') {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath();
      ctx.ellipse(sx + (x - sx) / 2, sy + (y - sy) / 2, Math.abs((x - sx) / 2), Math.abs((y - sy) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  const onPointerUp = (e: React.MouseEvent) => {
    if (!isHost || !drawing.current) return;
    drawing.current = false;
    clearOverlay();

    const [x, y] = getXY(e);
    const [sx, sy] = startXY.current;

    let newAction: DrawAction | null = null;

    if (tool === 'pencil') {
      if (pencilPts.current.length < 2) return;
      newAction = { type: 'pencil', points: [...pencilPts.current], color, width };
    } else if (tool === 'eraser') {
      if (pencilPts.current.length < 2) return;
      newAction = { type: 'pencil', points: [...pencilPts.current], color: '#ffffff', width: width * 4 };
    } else if (tool === 'line') {
      newAction = { type: 'line', x1: sx, y1: sy, x2: x, y2: y, color, width };
    } else if (tool === 'rect') {
      if (Math.abs(x - sx) < 2 && Math.abs(y - sy) < 2) return;
      newAction = { type: 'rect', x: sx, y: sy, w: x - sx, h: y - sy, color, width };
    } else if (tool === 'ellipse') {
      if (Math.abs(x - sx) < 2 && Math.abs(y - sy) < 2) return;
      newAction = { type: 'ellipse', cx: sx + (x - sx) / 2, cy: sy + (y - sy) / 2, rx: (x - sx) / 2, ry: (y - sy) / 2, color, width };
    }

    if (!newAction) return;

    const next = [...actionsRef.current, newAction];
    setHistory(h => [...h, actionsRef.current]);
    actionsRef.current = next;
    setActions(next);
    redraw(next);
    scheduleSync(next);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!isHost || tool !== 'text') return;
    const [x, y] = getXY(e);
    const txt = window.prompt('Введите текст:');
    if (!txt) return;
    const newAction: DrawAction = { type: 'text', x, y, text: txt, color, size: Math.max(14, width * 5) };
    const next = [...actionsRef.current, newAction];
    setHistory(h => [...h, actionsRef.current]);
    actionsRef.current = next;
    setActions(next);
    redraw(next);
    scheduleSync(next);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    actionsRef.current = prev;
    setActions(prev);
    redraw(prev);
    scheduleSync(prev);
  };

  const clear = () => {
    setHistory(h => [...h, actionsRef.current]);
    actionsRef.current = [];
    setActions([]);
    redraw([]);
    scheduleSync([]);
  };

  const cursorStyle: React.CSSProperties['cursor'] =
    tool === 'eraser' ? 'cell' :
    tool === 'text'   ? 'text' : 'crosshair';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#f3f4f6', userSelect: 'none' }}>

      {isHost && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
          background: '#fff', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap',
          flexShrink: 0,
        }}>
          {TOOLS.map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.label}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 2, padding: '5px 8px', borderRadius: 8, border: 'none',
                cursor: 'pointer', fontSize: 18, lineHeight: 1,
                background: tool === t.id ? '#6366f1' : 'transparent',
                color:      tool === t.id ? '#fff'    : '#374151',
                transition: 'background 0.15s',
                minWidth: 52,
              }}
            >
              <span>{t.icon}</span>
              <span style={{ fontSize: 9, fontFamily: 'Montserrat, sans-serif', fontWeight: 600, letterSpacing: 0.2 }}>
                {t.label}
              </span>
            </button>
          ))}

          <div style={{ width: 1, height: 36, background: '#e5e7eb', margin: '0 4px', flexShrink: 0 }} />

          {PALETTE.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 24, height: 24, borderRadius: '50%', border: 'none',
                background: c, cursor: 'pointer', flexShrink: 0,
                boxShadow: color === c
                  ? `0 0 0 2px #fff, 0 0 0 4px #6366f1`
                  : c === '#ffffff' ? '0 0 0 1px #d1d5db' : 'none',
                transition: 'box-shadow 0.15s',
              }}
            />
          ))}

          <div style={{ width: 1, height: 36, background: '#e5e7eb', margin: '0 4px', flexShrink: 0 }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 56 }}>
            <span style={{ fontSize: 9, color: '#6b7280', fontFamily: 'Montserrat,sans-serif', fontWeight: 600 }}>РАЗМЕР</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {WIDTHS.map(w => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  style={{
                    width: w + 12, height: w + 12, borderRadius: '50%', border: 'none',
                    cursor: 'pointer', flexShrink: 0,
                    background: width === w ? '#6366f1' : '#9ca3af',
                    transition: 'background 0.15s',
                  }}
                  title={`Толщина ${w}`}
                />
              ))}
            </div>
          </div>

          <div style={{ width: 1, height: 36, background: '#e5e7eb', margin: '0 4px', flexShrink: 0 }} />

          <button
            onClick={undo}
            disabled={history.length === 0}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '5px 8px', borderRadius: 8, border: 'none', cursor: history.length === 0 ? 'default' : 'pointer',
              background: 'transparent', color: history.length === 0 ? '#d1d5db' : '#374151',
              fontSize: 18, minWidth: 44, transition: 'color 0.15s',
            }}
          >
            <span>↩</span>
            <span style={{ fontSize: 9, fontFamily: 'Montserrat, sans-serif', fontWeight: 600 }}>Отмена</span>
          </button>

          <button
            onClick={clear}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '5px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'transparent', color: '#ef4444',
              fontSize: 18, minWidth: 44,
            }}
          >
            <span>🗑</span>
            <span style={{ fontSize: 9, fontFamily: 'Montserrat, sans-serif', fontWeight: 600 }}>Очистить</span>
          </button>
        </div>
      )}

      {!isHost && (
        <div style={{
          flexShrink: 0, textAlign: 'center', padding: '6px 0',
          fontSize: 11, color: '#6b7280', background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          fontFamily: 'Montserrat, sans-serif',
        }}>
          Просмотр — только ведущий может рисовать
        </div>
      )}

      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute', inset: 0, background: '#ffffff',
            cursor: isHost ? cursorStyle : 'default',
          }}
          onMouseDown={isHost ? onPointerDown : undefined}
          onMouseMove={isHost ? onPointerMove : undefined}
          onMouseUp={isHost ? onPointerUp : undefined}
          onMouseLeave={isHost ? (e) => { if (drawing.current) onPointerUp(e); } : undefined}
          onClick={isHost && tool === 'text' ? onCanvasClick : undefined}
        />
        <canvas
          ref={overlayRef}
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
