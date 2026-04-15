import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';

const API = window.location.origin;
const SAVE_DEBOUNCE_MS = 2000;
const HANDLE = 8;
const HIT = 7;

/* ── Types ──────────────────────────────────────────────── */
type Tool = 'select' | 'pencil' | 'line' | 'rect' | 'ellipse' | 'text' | 'eraser';

interface StrokeObj { id: string; kind: 'stroke'; pts: [number,number][]; color: string; lw: number }
interface LineObj   { id: string; kind: 'line';   x1:number; y1:number; x2:number; y2:number; color:string; lw:number }
interface RectObj   { id: string; kind: 'rect';   x:number; y:number; w:number; h:number; color:string; lw:number }
interface EllObj    { id: string; kind: 'ell';    cx:number; cy:number; rx:number; ry:number; color:string; lw:number }
interface TextObj   { id: string; kind: 'text';   x:number; y:number; text:string; color:string; size:number }
type SceneObj = StrokeObj | LineObj | RectObj | EllObj | TextObj;

interface Snapshot { v: 2; objs: SceneObj[] }

interface BB { x:number; y:number; w:number; h:number }

interface Props {
  meetingId: string;
  participantToken: string;
  isHost: boolean;
  wsRef: React.RefObject<WebSocket | null>;
}

/* ── Helpers ────────────────────────────────────────────── */
function uid(): string { return Math.random().toString(36).slice(2,10); }

function getBB(o: SceneObj, ctx: CanvasRenderingContext2D | null): BB {
  switch (o.kind) {
    case 'stroke': {
      if (!o.pts.length) return { x:0,y:0,w:0,h:0 };
      let x0=o.pts[0][0], y0=o.pts[0][1], x1=x0, y1=y0;
      for (const [x,y] of o.pts) { x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y); }
      const p = o.lw;
      return { x:x0-p, y:y0-p, w:x1-x0+p*2, h:y1-y0+p*2 };
    }
    case 'line': {
      const x0=Math.min(o.x1,o.x2), y0=Math.min(o.y1,o.y2);
      return { x:x0-o.lw, y:y0-o.lw, w:Math.abs(o.x2-o.x1)+o.lw*2, h:Math.abs(o.y2-o.y1)+o.lw*2 };
    }
    case 'rect':
      return { x:Math.min(o.x,o.x+o.w), y:Math.min(o.y,o.y+o.h), w:Math.abs(o.w), h:Math.abs(o.h) };
    case 'ell':
      return { x:o.cx-Math.abs(o.rx), y:o.cy-Math.abs(o.ry), w:Math.abs(o.rx)*2, h:Math.abs(o.ry)*2 };
    case 'text': {
      let tw: number;
      if (ctx) {
        ctx.save();
        ctx.font = `${o.size}px Montserrat, Arial, sans-serif`;
        tw = ctx.measureText(o.text).width;
        ctx.restore();
      } else {
        tw = o.text.length * o.size * 0.6;
      }
      return { x:o.x, y:o.y-o.size, w:tw+8, h:o.size*1.5 };
    }
  }
}

function drawObj(ctx: CanvasRenderingContext2D, o: SceneObj) {
  ctx.save();
  if (o.kind !== 'text') {
    ctx.strokeStyle = o.color; ctx.lineWidth = o.lw;
    ctx.lineCap='round'; ctx.lineJoin='round';
  }
  switch (o.kind) {
    case 'stroke':
      if (o.pts.length < 2) break;
      ctx.beginPath(); ctx.moveTo(o.pts[0][0], o.pts[0][1]);
      for (let i=1;i<o.pts.length;i++) ctx.lineTo(o.pts[i][0],o.pts[i][1]);
      ctx.stroke(); break;
    case 'line':
      ctx.beginPath(); ctx.moveTo(o.x1,o.y1); ctx.lineTo(o.x2,o.y2); ctx.stroke(); break;
    case 'rect':
      ctx.strokeRect(o.x,o.y,o.w,o.h); break;
    case 'ell':
      ctx.beginPath();
      ctx.ellipse(o.cx,o.cy,Math.max(1,Math.abs(o.rx)),Math.max(1,Math.abs(o.ry)),0,0,Math.PI*2);
      ctx.stroke(); break;
    case 'text':
      ctx.font = `${o.size}px Montserrat, Arial, sans-serif`;
      ctx.fillStyle = o.color;
      ctx.fillText(o.text, o.x, o.y); break;
  }
  ctx.restore();
}

function hitTest(o: SceneObj, mx: number, my: number, ctx: CanvasRenderingContext2D): boolean {
  const bb = getBB(o, ctx);
  if (mx < bb.x-HIT || mx > bb.x+bb.w+HIT || my < bb.y-HIT || my > bb.y+bb.h+HIT) return false;
  switch (o.kind) {
    case 'stroke': {
      for (const [x,y] of o.pts) if (Math.hypot(mx-x,my-y) < o.lw+HIT) return true;
      return false;
    }
    case 'line': {
      const dx=o.x2-o.x1, dy=o.y2-o.y1;
      const len2=dx*dx+dy*dy;
      if (len2===0) return Math.hypot(mx-o.x1,my-o.y1)<HIT;
      const t=Math.max(0,Math.min(1,((mx-o.x1)*dx+(my-o.y1)*dy)/len2));
      return Math.hypot(mx-(o.x1+t*dx),my-(o.y1+t*dy)) < o.lw+HIT;
    }
    default: return true;
  }
}

/* handle positions (8): TL,TC,TR, ML,MR, BL,BC,BR */
function getHandles(bb: BB): [number,number][] {
  const {x,y,w,h}=bb;
  return [
    [x,y],[x+w/2,y],[x+w,y],
    [x,y+h/2],[x+w,y+h/2],
    [x,y+h],[x+w/2,y+h],[x+w,y+h],
  ];
}
const CURSORS = ['nw-resize','n-resize','ne-resize','w-resize','e-resize','sw-resize','s-resize','se-resize'];

function handleAt(bb: BB, mx: number, my: number): number {
  const handles = getHandles(bb);
  for (let i=0;i<handles.length;i++) {
    const [hx,hy]=handles[i];
    if (Math.abs(mx-hx)<=HANDLE && Math.abs(my-hy)<=HANDLE) return i;
  }
  return -1;
}

function applyResize(o: SceneObj, hi: number, dx: number, dy: number): SceneObj {
  if (o.kind==='stroke') return o;
  if (o.kind==='text') {
    const ns = Math.max(10, o.size + (hi >= 5 ? dy : -dy) * 0.5);
    return {...o, size: ns};
  }
  if (o.kind==='line') {
    if (hi===0) return {...o, x1:o.x1+dx, y1:o.y1+dy};
    if (hi===7) return {...o, x2:o.x2+dx, y2:o.y2+dy};
    return o;
  }
  if (o.kind==='rect') {
    let {x,y,w,h}=o;
    if (hi===0||hi===3||hi===5) { x+=dx; w-=dx; }
    if (hi===2||hi===4||hi===7) { w+=dx; }
    if (hi===0||hi===1||hi===2) { y+=dy; h-=dy; }
    if (hi===5||hi===6||hi===7) { h+=dy; }
    return {...o,x,y,w,h};
  }
  if (o.kind==='ell') {
    let {cx,cy,rx,ry}=o;
    if (hi===0||hi===3||hi===5) { cx+=dx/2; rx-=dx/2; }
    if (hi===2||hi===4||hi===7) { cx+=dx/2; rx+=dx/2; }
    if (hi===0||hi===1||hi===2) { cy+=dy/2; ry-=dy/2; }
    if (hi===5||hi===6||hi===7) { cy+=dy/2; ry+=dy/2; }
    return {...o,cx,cy,rx,ry};
  }
  return o;
}

/* ── Render scene ───────────────────────────────────────── */
function renderScene(ctx: CanvasRenderingContext2D, objs: SceneObj[]) {
  ctx.fillStyle='#ffffff';
  ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);
  for (const o of objs) drawObj(ctx,o);
}

/* ── Toolbar config ─────────────────────────────────────── */
const TOOLS: {id:Tool;icon:string;label:string}[] = [
  {id:'select',  icon:'↖',  label:'Выделение'},
  {id:'pencil',  icon:'✏️', label:'Карандаш'},
  {id:'eraser',  icon:'◻',  label:'Ластик'},
  {id:'line',    icon:'╱',  label:'Линия'},
  {id:'rect',    icon:'▭',  label:'Прямоугольник'},
  {id:'ellipse', icon:'⬭',  label:'Эллипс'},
  {id:'text',    icon:'T',  label:'Текст'},
];

const PALETTE=['#111827','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280','#ffffff'];
const WIDTHS=[2,4,8,14];

/* ── Component ──────────────────────────────────────────── */
export default function MeetingWhiteboard({meetingId,participantToken,isHost,wsRef}: Props) {
  const mainRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const contRef    = useRef<HTMLDivElement>(null);
  const objsRef    = useRef<SceneObj[]>([]);

  const [tool,   setTool]   = useState<Tool>('pencil');
  const [color,  setColor]  = useState('#111827');
  const [lw,     setLw]     = useState(3);
  const [selId,  setSelId]  = useState<string|null>(null);
  const [, forceRender]     = useState(0);

  /* text editing overlay */
  const [textEdit, setTextEdit] = useState<{id:string;x:number;y:number;size:number;color:string;initText:string}|null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const histRef  = useRef<SceneObj[][]>([]);
  const saveRef  = useRef<ReturnType<typeof setTimeout>|null>(null);

  /* drag state */
  const dragRef = useRef<{
    type: 'draw'|'move'|'handle';
    tool?: Tool;
    startX:number; startY:number;
    curX:number; curY:number;
    pts?: [number,number][];
    id?: string;
    hi?: number;
    origObj?: SceneObj;
  }|null>(null);

  /* ── Canvas helpers ──────────────────────── */
  const getCtx = () => mainRef.current?.getContext('2d') ?? null;
  const getOCtx = () => overlayRef.current?.getContext('2d') ?? null;

  const redrawMain = useCallback((objs: SceneObj[]) => {
    const ctx = getCtx(); if (!ctx) return;
    renderScene(ctx, objs);
  }, []);

  const clearOverlay = useCallback(() => {
    const oc = overlayRef.current; if (!oc) return;
    const ctx = oc.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0,0,oc.width,oc.height);
  }, []);

  const drawSelectionBox = useCallback((objs: SceneObj[], id: string|null) => {
    const oc = overlayRef.current; if (!oc) return;
    const ctx = oc.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0,0,oc.width,oc.height);
    if (!id) return;
    const o = objs.find(x=>x.id===id); if (!o) return;
    const mCtx = getCtx();
    const bb = getBB(o, mCtx);
    const pad=6;
    const bx=bb.x-pad, by=bb.y-pad, bw=bb.w+pad*2, bh=bb.h+pad*2;
    ctx.save();
    ctx.strokeStyle='#6366f1'; ctx.lineWidth=1.5;
    ctx.setLineDash([5,3]);
    ctx.strokeRect(bx,by,bw,bh);
    ctx.setLineDash([]);
    const handles = getHandles({x:bx,y:by,w:bw,h:bh});
    ctx.fillStyle='#ffffff'; ctx.strokeStyle='#6366f1'; ctx.lineWidth=1.5;
    for (const [hx,hy] of handles) {
      ctx.fillRect(hx-HANDLE/2,hy-HANDLE/2,HANDLE,HANDLE);
      ctx.strokeRect(hx-HANDLE/2,hy-HANDLE/2,HANDLE,HANDLE);
    }
    ctx.restore();
  }, []);

  /* ── Sync ──────────────────────────────── */
  const scheduleSync = useCallback((objs: SceneObj[]) => {
    if (!isHost) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(async () => {
      const snap: Snapshot = { v:2, objs };
      try {
        await fetch(`${API}/api/meetings/${meetingId}/whiteboard`, {
          method:'POST',
          headers:{'Content-Type':'application/json','x-participant-token':participantToken},
          credentials:'include',
          body: JSON.stringify({snapshot:snap}),
        });
      } catch {}
    }, SAVE_DEBOUNCE_MS);
  }, [meetingId, participantToken, isHost]);

  const applySnapshot = useCallback((snap: unknown) => {
    try {
      const s = snap as Snapshot;
      let objs: SceneObj[] = [];
      if (s?.v===2 && Array.isArray(s.objs)) objs = s.objs;
      else if ((s as any)?.version===1 && Array.isArray((s as any).actions)) {
        objs = (s as any).actions.map((a:any,i:number): SceneObj|null => {
          if (a.type==='pencil') return {id:String(i),kind:'stroke',pts:a.points,color:a.color,lw:a.width};
          if (a.type==='line')   return {id:String(i),kind:'line',x1:a.x1,y1:a.y1,x2:a.x2,y2:a.y2,color:a.color,lw:a.width};
          if (a.type==='rect')   return {id:String(i),kind:'rect',x:a.x,y:a.y,w:a.w,h:a.h,color:a.color,lw:a.width};
          if (a.type==='ellipse')return {id:String(i),kind:'ell',cx:a.cx,cy:a.cy,rx:a.rx,ry:a.ry,color:a.color,lw:a.width};
          if (a.type==='text')   return {id:String(i),kind:'text',x:a.x,y:a.y,text:a.text,color:a.color,size:a.size};
          return null;
        }).filter(Boolean) as SceneObj[];
      }
      objsRef.current = objs;
      forceRender(n=>n+1);
      redrawMain(objs);
    } catch {}
  }, [redrawMain]);

  /* load initial */
  useEffect(() => {
    fetch(`${API}/api/meetings/${meetingId}/whiteboard`, {
      headers:{'x-participant-token':participantToken}, credentials:'include',
    }).then(r=>r.json()).then(d=>{ if(d.snapshot) applySnapshot(d.snapshot); }).catch(()=>{});
  }, [meetingId,participantToken,applySnapshot]);

  /* ws updates for non-host */
  useEffect(() => {
    const ws=wsRef.current; if(!ws||isHost) return;
    const h=(e:MessageEvent)=>{
      try {
        const msg=JSON.parse(e.data);
        if(msg.type==='whiteboard_update'&&msg.snapshot) applySnapshot(msg.snapshot);
      } catch {}
    };
    ws.addEventListener('message',h);
    return ()=>ws.removeEventListener('message',h);
  },[wsRef,isHost,applySnapshot]);

  /* resize observer */
  useEffect(()=>{
    const obs=new ResizeObserver(()=>{
      const c=mainRef.current; const o=overlayRef.current; const cont=contRef.current;
      if(!c||!o||!cont) return;
      const {width:w,height:h}=cont.getBoundingClientRect();
      if(c.width!==w||c.height!==h){
        c.width=w; c.height=h; o.width=w; o.height=h;
        redrawMain(objsRef.current);
        drawSelectionBox(objsRef.current,selId);
      }
    });
    if(contRef.current) obs.observe(contRef.current);
    return ()=>obs.disconnect();
  },[redrawMain,drawSelectionBox,selId]);

  /* focus textarea when text edit starts */
  useEffect(()=>{ if(textEdit) setTimeout(()=>textareaRef.current?.focus(),30); },[textEdit]);

  /* ── Mouse helpers ─────────────────────── */
  const getXY = (e:React.MouseEvent):[number,number] => {
    const r=mainRef.current!.getBoundingClientRect();
    return [e.clientX-r.left, e.clientY-r.top];
  };

  const getCursor = (): string => {
    if (!isHost) return 'default';
    if (tool==='text') return 'text';
    if (tool==='eraser') return 'cell';
    if (tool==='select') return 'default';
    return 'crosshair';
  };

  const commitObj = (o:SceneObj) => {
    histRef.current=[...histRef.current, objsRef.current];
    const next=[...objsRef.current, o];
    objsRef.current=next;
    redrawMain(next);
    setSelId(null); clearOverlay();
    scheduleSync(next);
  };

  const updateObj = (id:string, patch:Partial<SceneObj>) => {
    const next=objsRef.current.map(o=>o.id===id?{...o,...patch} as SceneObj:o);
    objsRef.current=next;
    redrawMain(next);
    scheduleSync(next);
  };

  /* ── Pointer events ────────────────────── */
  const onMouseDown = (e:React.MouseEvent) => {
    if(!isHost) return;
    const [mx,my]=getXY(e);

    if(tool==='text') {
      /* if clicking on an existing text object → select it */
      const ctx=getCtx();
      const hit=[...objsRef.current].reverse().find(o=>ctx&&hitTest(o,mx,my,ctx)&&o.kind==='text');
      if(hit && hit.kind==='text') {
        setSelId(hit.id);
        setTool('select');
        drawSelectionBox(objsRef.current, hit.id);
        return;
      }
      /* start inline text input */
      const newId=uid();
      setTextEdit({id:newId, x:mx, y:my+lw*5, size:Math.max(14,lw*5), color, initText:''});
      return;
    }

    if(tool==='select') {
      const ctx=getCtx();
      /* check handle first */
      if(selId) {
        const selObj=objsRef.current.find(o=>o.id===selId);
        if(selObj&&ctx) {
          const bb=getBB(selObj,ctx);
          const pad=6;
          const pbb={x:bb.x-pad,y:bb.y-pad,w:bb.w+pad*2,h:bb.h+pad*2};
          const hi=handleAt(pbb,mx,my);
          if(hi>=0){
            dragRef.current={type:'handle',startX:mx,startY:my,curX:mx,curY:my,id:selId,hi,origObj:selObj};
            return;
          }
        }
      }
      /* hit test objects (top→bottom) */
      const ctx2=getCtx();
      const hit=[...objsRef.current].reverse().find(o=>ctx2&&hitTest(o,mx,my,ctx2));
      if(hit){
        setSelId(hit.id);
        drawSelectionBox(objsRef.current,hit.id);
        dragRef.current={type:'move',startX:mx,startY:my,curX:mx,curY:my,id:hit.id,origObj:hit};
      } else {
        setSelId(null);
        clearOverlay();
      }
      return;
    }

    /* drawing tools */
    dragRef.current={type:'draw',tool,startX:mx,startY:my,curX:mx,curY:my,pts:[[mx,my]]};
  };

  const onMouseMove = (e:React.MouseEvent) => {
    if(!isHost) return;
    const [mx,my]=getXY(e);
    const d=dragRef.current; if(!d) return;
    d.curX=mx; d.curY=my;

    if(d.type==='move'&&d.id) {
      const dx=mx-d.startX, dy=my-d.startY;
      const orig=d.origObj!;
      let patched:SceneObj;
      switch(orig.kind) {
        case 'stroke': patched={...orig,pts:orig.pts.map(([x,y])=>[x+dx,y+dy] as [number,number])}; break;
        case 'line':   patched={...orig,x1:orig.x1+dx,y1:orig.y1+dy,x2:orig.x2+dx,y2:orig.y2+dy}; break;
        case 'rect':   patched={...orig,x:orig.x+dx,y:orig.y+dy}; break;
        case 'ell':    patched={...orig,cx:orig.cx+dx,cy:orig.cy+dy}; break;
        case 'text':   patched={...orig,x:orig.x+dx,y:orig.y+dy}; break;
      }
      const next=objsRef.current.map(o=>o.id===d.id?patched:o);
      objsRef.current=next;
      redrawMain(next);
      drawSelectionBox(next,d.id);
      return;
    }

    if(d.type==='handle'&&d.id!=null&&d.hi!=null) {
      const dx=mx-d.curX, dy=my-d.curY;
      d.curX=mx; d.curY=my;
      const orig=objsRef.current.find(o=>o.id===d.id)!;
      const patched=applyResize(orig,d.hi,dx,dy);
      const next=objsRef.current.map(o=>o.id===d.id?patched:o);
      objsRef.current=next;
      redrawMain(next);
      drawSelectionBox(next,d.id);
      return;
    }

    if(d.type==='draw') {
      const {tool:t,startX:sx,startY:sy}=d;
      const oc=overlayRef.current; if(!oc) return;
      const ctx=oc.getContext('2d')!;
      ctx.clearRect(0,0,oc.width,oc.height);

      if(t==='pencil'||t==='eraser') {
        d.pts!.push([mx,my]);
        ctx.save();
        ctx.strokeStyle=t==='eraser'?'#ffffff':color;
        ctx.lineWidth=t==='eraser'?lw*4:lw;
        ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.beginPath(); ctx.moveTo(d.pts![0][0],d.pts![0][1]);
        for(let i=1;i<d.pts!.length;i++) ctx.lineTo(d.pts![i][0],d.pts![i][1]);
        ctx.stroke(); ctx.restore();
      } else {
        ctx.save();
        ctx.strokeStyle=color; ctx.lineWidth=lw; ctx.lineCap='round'; ctx.lineJoin='round';
        if(t==='line') {
          ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(mx,my); ctx.stroke();
        } else if(t==='rect') {
          ctx.strokeRect(sx,sy,mx-sx,my-sy);
        } else if(t==='ellipse') {
          const rxt=Math.abs((mx-sx)/2), ryt=Math.abs((my-sy)/2);
          ctx.beginPath();
          ctx.ellipse(sx+(mx-sx)/2,sy+(my-sy)/2,Math.max(1,rxt),Math.max(1,ryt),0,0,Math.PI*2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  };

  const onMouseUp = (e:React.MouseEvent) => {
    if(!isHost) return;
    const [mx,my]=getXY(e);
    const d=dragRef.current; if(!d) return;

    if(d.type==='move'&&d.id) {
      dragRef.current=null;
      histRef.current=[...histRef.current, d.origObj ? objsRef.current.map(o=>o.id===d.id?d.origObj!:o) : objsRef.current];
      scheduleSync(objsRef.current);
      return;
    }
    if(d.type==='handle') {
      dragRef.current=null;
      scheduleSync(objsRef.current);
      return;
    }
    if(d.type==='draw') {
      clearOverlay();
      const {tool:t,startX:sx,startY:sy}=d;
      let o:SceneObj|null=null;
      if(t==='pencil') { if(d.pts!.length>=2) o={id:uid(),kind:'stroke',pts:d.pts!,color,lw}; }
      else if(t==='eraser') { if(d.pts!.length>=2) o={id:uid(),kind:'stroke',pts:d.pts!,color:'#ffffff',lw:lw*4}; }
      else if(t==='line') {
        if(Math.hypot(mx-sx,my-sy)>3) o={id:uid(),kind:'line',x1:sx,y1:sy,x2:mx,y2:my,color,lw};
      } else if(t==='rect') {
        if(Math.abs(mx-sx)>3&&Math.abs(my-sy)>3) o={id:uid(),kind:'rect',x:sx,y:sy,w:mx-sx,h:my-sy,color,lw};
      } else if(t==='ellipse') {
        if(Math.abs(mx-sx)>3&&Math.abs(my-sy)>3) o={id:uid(),kind:'ell',cx:sx+(mx-sx)/2,cy:sy+(my-sy)/2,rx:(mx-sx)/2,ry:(my-sy)/2,color,lw};
      }
      if(o) commitObj(o);
    }
    dragRef.current=null;
  };

  /* cursor on overlay when hovering handles */
  const onMouseMoveForCursor = (e:React.MouseEvent) => {
    if(!isHost||tool!=='select'||!selId) return;
    const [mx,my]=getXY(e);
    const ctx=getCtx();
    const selObj=objsRef.current.find(o=>o.id===selId);
    if(!selObj||!ctx) return;
    const bb=getBB(selObj,ctx);
    const pad=6;
    const pbb={x:bb.x-pad,y:bb.y-pad,w:bb.w+pad*2,h:bb.h+pad*2};
    const hi=handleAt(pbb,mx,my);
    if(mainRef.current) mainRef.current.style.cursor = hi>=0 ? CURSORS[hi] : 'default';
  };

  /* ── Text commit ────────────────────────── */
  const commitText = useCallback((te: typeof textEdit, val: string) => {
    if(!te) return;
    setTextEdit(null);
    const trimmed=val.trim();
    if(!trimmed) return;
    const existing=objsRef.current.find(o=>o.id===te.id);
    if(existing && existing.kind==='text') {
      updateObj(te.id,{text:trimmed} as any);
    } else {
      commitObj({id:te.id,kind:'text',x:te.x,y:te.y,text:trimmed,color:te.color,size:te.size});
    }
  }, []);

  /* ── Keyboard ───────────────────────────── */
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if(!isHost) return;
      if(textEdit) return;
      if(e.key==='Delete'||e.key==='Backspace') {
        if(selId&&document.activeElement===document.body){
          histRef.current=[...histRef.current,objsRef.current];
          const next=objsRef.current.filter(o=>o.id!==selId);
          objsRef.current=next; setSelId(null); clearOverlay(); redrawMain(next); scheduleSync(next);
        }
      }
      if(e.ctrlKey&&e.key==='z') {
        if(histRef.current.length>0){
          const prev=histRef.current[histRef.current.length-1];
          histRef.current=histRef.current.slice(0,-1);
          objsRef.current=prev; redrawMain(prev);
          drawSelectionBox(prev,selId); scheduleSync(prev);
        }
      }
    };
    window.addEventListener('keydown',h);
    return ()=>window.removeEventListener('keydown',h);
  },[isHost,selId,textEdit,clearOverlay,redrawMain,drawSelectionBox,scheduleSync]);

  /* ── Undo / Clear ───────────────────────── */
  const undo=()=>{
    if(!histRef.current.length) return;
    const prev=histRef.current[histRef.current.length-1];
    histRef.current=histRef.current.slice(0,-1);
    objsRef.current=prev; setSelId(null); clearOverlay(); redrawMain(prev); scheduleSync(prev);
  };
  const clearAll=()=>{
    histRef.current=[...histRef.current,objsRef.current];
    objsRef.current=[]; setSelId(null); clearOverlay(); redrawMain([]); scheduleSync([]);
  };

  /* ── Snap & delete selected ─────────────── */
  const deleteSelected=()=>{
    if(!selId) return;
    histRef.current=[...histRef.current,objsRef.current];
    const next=objsRef.current.filter(o=>o.id!==selId);
    objsRef.current=next; setSelId(null); clearOverlay(); redrawMain(next); scheduleSync(next);
  };

  /* ── Text area position ─────────────────── */
  const textAreaStyle = useMemo(():React.CSSProperties => {
    if(!textEdit) return {display:'none'};
    const canvasRect=mainRef.current?.getBoundingClientRect();
    const contRect=contRef.current?.getBoundingClientRect();
    if(!canvasRect||!contRect) return {display:'none'};
    return {
      position:'absolute',
      left: textEdit.x - (canvasRect.left - contRect.left),
      top:  textEdit.y - textEdit.size - (canvasRect.top - contRect.top),
      minWidth:120, maxWidth:400,
      font:`${textEdit.size}px Montserrat, Arial, sans-serif`,
      color: textEdit.color,
      background:'rgba(99,102,241,0.06)',
      border:'1.5px dashed #6366f1',
      borderRadius:4,
      padding:'2px 6px',
      outline:'none',
      resize:'none',
      overflow:'hidden',
      lineHeight:1.3,
      zIndex:20,
    };
  },[textEdit]);

  return (
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',background:'#f3f4f6',userSelect:'none'}}>

      {/* ── Toolbar ── */}
      {isHost && (
        <div style={{
          display:'flex',alignItems:'center',gap:4,padding:'6px 10px',
          background:'#fff',borderBottom:'1px solid #e5e7eb',flexWrap:'wrap',flexShrink:0,
          boxShadow:'0 1px 4px rgba(0,0,0,0.07)',
        }}>
          {TOOLS.map(t=>(
            <button key={t.id} onClick={()=>setTool(t.id)} title={t.label} style={{
              display:'flex',flexDirection:'column',alignItems:'center',gap:2,
              padding:'5px 8px',borderRadius:8,border:'none',cursor:'pointer',
              fontSize:t.id==='text'?18:16, lineHeight:1,
              background:tool===t.id?'#6366f1':'transparent',
              color:tool===t.id?'#fff':'#374151',
              transition:'background 0.15s', minWidth:50,
            }}>
              <span style={{fontStyle:t.id==='text'?'normal':'normal',fontWeight:t.id==='text'?700:'normal'}}>{t.icon}</span>
              <span style={{fontSize:9,fontFamily:'Montserrat,sans-serif',fontWeight:600,letterSpacing:0.2}}>{t.label}</span>
            </button>
          ))}

          <div style={{width:1,height:36,background:'#e5e7eb',margin:'0 4px',flexShrink:0}}/>

          {PALETTE.map(c=>(
            <button key={c} onClick={()=>setColor(c)} title={c} style={{
              width:22,height:22,borderRadius:'50%',border:'none',background:c,cursor:'pointer',flexShrink:0,
              boxShadow:color===c?`0 0 0 2px #fff,0 0 0 4px #6366f1`:c==='#ffffff'?'0 0 0 1px #d1d5db':'none',
              transition:'box-shadow 0.15s',
            }}/>
          ))}

          <div style={{width:1,height:36,background:'#e5e7eb',margin:'0 4px',flexShrink:0}}/>

          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
            <span style={{fontSize:9,color:'#6b7280',fontFamily:'Montserrat,sans-serif',fontWeight:600}}>РАЗМЕР</span>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              {WIDTHS.map(w=>(
                <button key={w} onClick={()=>setLw(w)} title={`Размер ${w}`} style={{
                  width:w+10,height:w+10,borderRadius:'50%',border:'none',cursor:'pointer',flexShrink:0,
                  background:lw===w?'#6366f1':'#9ca3af',transition:'background 0.15s',
                }}/>
              ))}
            </div>
          </div>

          <div style={{width:1,height:36,background:'#e5e7eb',margin:'0 4px',flexShrink:0}}/>

          {selId && (
            <button onClick={deleteSelected} style={{
              display:'flex',flexDirection:'column',alignItems:'center',gap:2,
              padding:'5px 8px',borderRadius:8,border:'none',cursor:'pointer',
              background:'transparent',color:'#ef4444',fontSize:16,minWidth:44,
            }}>
              <span>✕</span>
              <span style={{fontSize:9,fontFamily:'Montserrat,sans-serif',fontWeight:600}}>Удалить</span>
            </button>
          )}

          <button onClick={undo} disabled={!histRef.current.length} style={{
            display:'flex',flexDirection:'column',alignItems:'center',gap:2,
            padding:'5px 8px',borderRadius:8,border:'none',
            cursor:histRef.current.length?'pointer':'default',
            background:'transparent',color:histRef.current.length?'#374151':'#d1d5db',
            fontSize:16,minWidth:44,transition:'color 0.15s',
          }}>
            <span>↩</span>
            <span style={{fontSize:9,fontFamily:'Montserrat,sans-serif',fontWeight:600}}>Отмена</span>
          </button>

          <button onClick={clearAll} style={{
            display:'flex',flexDirection:'column',alignItems:'center',gap:2,
            padding:'5px 8px',borderRadius:8,border:'none',cursor:'pointer',
            background:'transparent',color:'#ef4444',fontSize:16,minWidth:44,
          }}>
            <span>🗑</span>
            <span style={{fontSize:9,fontFamily:'Montserrat,sans-serif',fontWeight:600}}>Очистить</span>
          </button>
        </div>
      )}

      {!isHost && (
        <div style={{
          flexShrink:0,textAlign:'center',padding:'6px',fontSize:11,color:'#6b7280',
          background:'#fff',borderBottom:'1px solid #e5e7eb',fontFamily:'Montserrat,sans-serif',
        }}>
          Просмотр · только ведущий может рисовать
        </div>
      )}

      {/* ── Canvas area ── */}
      <div ref={contRef} style={{flex:1,position:'relative',overflow:'hidden'}}>
        <canvas ref={mainRef} style={{
          position:'absolute',inset:0,background:'#ffffff',
          cursor:isHost?getCursor():'default',
          touchAction:'none',
        }}
          onMouseDown={onMouseDown}
          onMouseMove={(e)=>{onMouseMove(e);onMouseMoveForCursor(e);}}
          onMouseUp={onMouseUp}
          onMouseLeave={(e)=>{ if(dragRef.current?.type==='draw') onMouseUp(e); }}
        />
        <canvas ref={overlayRef} style={{position:'absolute',inset:0,pointerEvents:'none'}}/>

        {/* inline text editing */}
        {textEdit && (
          <textarea
            ref={textareaRef}
            defaultValue={textEdit.initText}
            rows={1}
            style={textAreaStyle}
            placeholder="Введите текст..."
            onChange={e=>{
              const ta=e.currentTarget;
              ta.style.height='auto';
              ta.style.height=ta.scrollHeight+'px';
            }}
            onBlur={e=>commitText(textEdit,e.currentTarget.value)}
            onKeyDown={e=>{
              if(e.key==='Escape') { setTextEdit(null); }
              if(e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); commitText(textEdit,e.currentTarget.value); }
            }}
          />
        )}
      </div>
    </div>
  );
}
