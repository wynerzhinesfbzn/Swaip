import React, { useEffect, useRef, useCallback } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';

const API = window.location.origin;
const SAVE_DEBOUNCE_MS = 1500;

interface Props {
  meetingId: string;
  participantToken: string;
  isHost: boolean;
  wsRef: React.RefObject<WebSocket | null>;
}

function getEditorSnapshot(editor: Editor): unknown {
  try {
    if (typeof (editor as any).getSnapshot === 'function') return (editor as any).getSnapshot();
    if (typeof (editor as any).store?.getSnapshot === 'function') return (editor as any).store.getSnapshot();
    return null;
  } catch { return null; }
}

function loadEditorSnapshot(editor: Editor, snapshot: unknown): void {
  try {
    if (typeof (editor as any).loadSnapshot === 'function') {
      (editor as any).loadSnapshot(snapshot);
    } else if (typeof (editor as any).store?.loadSnapshot === 'function') {
      (editor as any).store.loadSnapshot(snapshot);
    }
  } catch {}
}

export default function MeetingWhiteboard({ meetingId, participantToken, isHost, wsRef }: Props) {
  const editorRef = useRef<Editor | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const saveSnapshot = useCallback(async (editor: Editor) => {
    if (!isHost) return;
    const snapshot = getEditorSnapshot(editor);
    if (!snapshot) return;
    try {
      await fetch(`${API}/api/meetings/${meetingId}/whiteboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-participant-token': participantToken },
        credentials: 'include',
        body: JSON.stringify({ snapshot }),
      });
    } catch {}
  }, [meetingId, participantToken, isHost]);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    if (!isHost) {
      try { editor.updateInstanceState({ isReadonly: true }); } catch {}
      fetch(`${API}/api/meetings/${meetingId}/whiteboard`, {
        headers: { 'x-participant-token': participantToken },
        credentials: 'include',
      })
        .then(r => r.json())
        .then(d => {
          if (d.snapshot && editorRef.current) {
            loadEditorSnapshot(editorRef.current, d.snapshot);
          }
        })
        .catch(() => {});
    } else {
      try {
        const unlisten = editor.store.listen(() => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => saveSnapshot(editor), SAVE_DEBOUNCE_MS);
        }, { source: 'user', scope: 'document' });
        unlistenRef.current = unlisten;
      } catch {}
    }
  }, [isHost, meetingId, participantToken, saveSnapshot]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || isHost) return;
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'whiteboard_update' && msg.snapshot && editorRef.current) {
          loadEditorSnapshot(editorRef.current, msg.snapshot);
        }
      } catch {}
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, isHost]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      unlistenRef.current?.();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {!isHost && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, background: 'rgba(0,0,0,0.65)', borderRadius: 8,
          padding: '4px 14px', fontSize: 11, color: 'rgba(255,255,255,0.45)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          Только ведущий может рисовать
        </div>
      )}
      <Tldraw onMount={onMount} style={{ height: '100%' }} />
    </div>
  );
}
