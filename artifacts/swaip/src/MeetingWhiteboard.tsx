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

interface SlideItem { id: string; url: string; name: string; }

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
  if (o.kind==='text') { return {...o, size: Math.max(10, o.size + (hi >= 5 ? dy : -dy) * 0.5)}; }
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

/* ── Render scene (drawing objects on top of slide) ──── */
function renderScene(
  ctx: CanvasRenderingContext2D,
  objs: SceneObj[],
  slideImg: HTMLImageElement | null,
) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  if (slideImg && slideImg.complete && slideImg.naturalWidth > 0) {
    /* dark letterbox background */
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, cw, ch);
    /* draw slide image centered/contain */
    const iw = slideImg.naturalWidth, ih = slideImg.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.drawImage(slideImg, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
  }
  for (const o of objs) drawObj(ctx, o);
}

/* ── PDF helper ────────────────────────────────────────── */
async function pdfToJpegBlobs(file: File): Promise<{ blob: Blob; name: string }[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
  }
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const results: { blob: Blob; name: string }[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: c, viewport: vp }).promise;
    const blob = await new Promise<Blob>((ok, fail) =>
      canvas.toBlob(b => b ? ok(b) : fail(new Error('toBlob failed')), 'image/jpeg', 0.93),
    );
    results.push({ blob, name: `${file.name.replace(/\.pdf$/i, '')} — стр. ${p}` });
  }
  return results;
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
  const slideImgRef = useRef<HTMLImageElement | null>(null);

  /* draw state refs (always current values for event handlers) */
  const toolRef  = useRef<Tool>('pencil');
  const colorRef = useRef('#111827');
  const lwRef    = useRef(3);
  const selIdRef = useRef<string|null>(null);

  const [tool,   setToolState]  = useState<Tool>('pencil');
  const [color,  setColorState] = useState('#111827');
  const [lw,     setLwState]    = useState(3);
  const [selId,  setSelIdState] = useState<string|null>(null);
  const [, forceRender]         = useState(0);

  const setTool  = (t: Tool)       => { toolRef.current=t;  setToolState(t); };
  const setColor = (c: string)     => { colorRef.current=c; setColorState(c); };
  const setLw    = (w: number)     => { lwRef.current=w;    setLwState(w); };
  const setSelId = (id:string|null)=> { selIdRef.current=id; setSelIdState(id); };

  /* text edit */
  const [textEdit, setTextEdit] = useState<{id:string;x:number;y:number;size:number;color:string;initText:string}|null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* history / drag */
  const histRef = useRef<SceneObj[][]>([]);
  const saveRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const dragRef = useRef<{
    type: 'draw'|'move'|'handle';
    tool?: Tool;
    startX:number; startY:number; curX:number; curY:number;
    pts?: [number,number][]; id?: string; hi?: number; origObj?: SceneObj;
  }|null>(null);

  /* ── Slides state ──────────────────────────────────── */
  const [slides,       setSlides]       = useState<SlideItem[]>([]);
  const [currentSlide, setCurrentSlide] = useState<number>(0);
  const [showSlides,   setShowSlides]   = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [uploadMsg,    setUploadMsg]    = useState('');
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const thumbsRef      = useRef<HTMLDivElement>(null);

  /* ── Canvas helpers ──────────────────────── */
  const getCtx = () => mainRef.current?.getContext('2d') ?? null;

  const redrawMain = useCallback((objs: SceneObj[]) => {
    const ctx = getCtx(); if (!ctx) return;
    renderScene(ctx, objs, slideImgRef.current);
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
    const bb = getBB(o, getCtx());
    const pad=6;
    const bx=bb.x-pad, by=bb.y-pad, bw=bb.w+pad*2, bh=bb.h+pad*2;
    ctx.save();
    ctx.strokeStyle='#6366f1'; ctx.lineWidth=1.5;
    ctx.setLineDash([5,3]); ctx.strokeRect(bx,by,bw,bh); ctx.setLineDash([]);
    ctx.fillStyle='#ffffff'; ctx.strokeStyle='#6366f1'; ctx.lineWidth=1.5;
    for (const [hx,hy] of getHandles({x:bx,y:by,w:bw,h:bh})) {
      ctx.fillRect(hx-HANDLE/2,hy-HANDLE/2,HANDLE,HANDLE);
      ctx.strokeRect(hx-HANDLE/2,hy-HANDLE/2,HANDLE,HANDLE);
    }
    ctx.restore();
  }, []);

  /* ── Whiteboard sync ──────────────────── */
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

  /* ── Slides helpers ──────────────────────────────────── */
  const loadSlideImage = useCallback((url: string | null) => {
    if (!url) { slideImgRef.current = null; redrawMain(objsRef.current); return; }
    const fullUrl = url.startsWith('http') ? url : `${API}${url}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { slideImgRef.current = img; redrawMain(objsRef.current); };
    img.onerror = () => { slideImgRef.current = null; redrawMain(objsRef.current); };
    img.src = fullUrl;
  }, [redrawMain]);

  const navigateTo = useCallback(async (idx: number, broadcast = true) => {
    setCurrentSlide(idx);
    if (broadcast && isHost) {
      try {
        await fetch(`${API}/api/meetings/${meetingId}/slides/current`, {
          method: 'PATCH',
          headers: {'Content-Type':'application/json','x-participant-token':participantToken},
          credentials: 'include',
          body: JSON.stringify({ current: idx }),
        });
      } catch {}
    }
  }, [meetingId, participantToken, isHost]);

  /* when currentSlide or slides list changes, load the image */
  useEffect(() => {
    const slide = slides[currentSlide];
    loadSlideImage(slide ? slide.url : null);
    /* scroll thumbnail into view */
    if (thumbsRef.current) {
      const btn = thumbsRef.current.querySelector(`[data-idx="${currentSlide}"]`) as HTMLElement | null;
      btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentSlide, slides, loadSlideImage]);

  /* upload a single image blob as a slide */
  const uploadSlideBlobAsSlide = useCallback(async (blob: Blob, name: string) => {
    const fd = new FormData();
    const ext = blob.type.includes('jpeg') ? 'jpg' : 'png';
    fd.append('file', blob, `slide.${ext}`);
    fd.append('name', name);
    const res = await fetch(`${API}/api/meetings/${meetingId}/slides/upload`, {
      method: 'POST',
      headers: { 'x-participant-token': participantToken },
      credentials: 'include',
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    setSlides(data.slides);
    setCurrentSlide(data.current);
    return data;
  }, [meetingId, participantToken]);

  /* upload image file directly */
  const uploadImageFile = useCallback(async (file: File, index: number, total: number) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const name = total > 1
      ? `${file.name.replace(/\.[^.]+$/, '')} (${index+1}/${total})`
      : file.name.replace(/\.[^.]+$/, '');
    fd.append('name', name);
    const res = await fetch(`${API}/api/meetings/${meetingId}/slides/upload`, {
      method: 'POST',
      headers: { 'x-participant-token': participantToken },
      credentials: 'include',
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    setSlides(data.slides);
    return data;
  }, [meetingId, participantToken]);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    /* check for PPTX */
    const pptxFiles = files.filter(f => f.name.toLowerCase().endsWith('.pptx') || f.name.toLowerCase().endsWith('.ppt'));
    if (pptxFiles.length > 0) {
      setUploadMsg('PowerPoint не поддерживается напрямую. Откройте файл в Google Slides или LibreOffice и экспортируйте как PDF, затем загрузите PDF.');
      setTimeout(() => setUploadMsg(''), 8000);
      return;
    }

    setUploading(true);
    setUploadMsg('');
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        /* PDF → render each page to JPEG */
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          setUploadMsg(`Рендерю PDF: ${file.name}...`);
          const pages = await pdfToJpegBlobs(file);
          for (let p = 0; p < pages.length; p++) {
            setUploadMsg(`Загружаю страницу ${p+1}/${pages.length}...`);
            await uploadSlideBlobAsSlide(pages[p].blob, pages[p].name);
          }
        } else {
          /* image file */
          setUploadMsg(`Загружаю ${i+1}/${files.length}: ${file.name}`);
          await uploadImageFile(file, i, files.length);
        }
      }
      setUploadMsg('');
      setShowSlides(true);
    } catch (err: any) {
      setUploadMsg(`Ошибка: ${err.message || 'неизвестная ошибка'}`);
      setTimeout(() => setUploadMsg(''), 5000);
    } finally {
      setUploading(false);
    }
  }, [uploadSlideBlobAsSlide, uploadImageFile]);

  const deleteSlide = useCallback(async (slideId: string) => {
    try {
      const res = await fetch(`${API}/api/meetings/${meetingId}/slides/${slideId}`, {
        method: 'DELETE',
        headers: { 'x-participant-token': participantToken },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSlides(data.slides);
        setCurrentSlide(data.current);
      }
    } catch {}
  }, [meetingId, participantToken]);

  /* ── load initial slides ──────────────────────────────── */
  useEffect(() => {
    fetch(`${API}/api/meetings/${meetingId}/slides`, {
      headers: {'x-participant-token':participantToken}, credentials:'include',
    }).then(r=>r.json()).then(d=>{
      if (Array.isArray(d.slides)) {
        setSlides(d.slides);
        setCurrentSlide(d.current ?? 0);
        if (d.slides.length > 0) setShowSlides(true);
      }
    }).catch(()=>{});
  }, [meetingId, participantToken]);

  /* ── load initial whiteboard ──────────────────────────── */
  useEffect(() => {
    fetch(`${API}/api/meetings/${meetingId}/whiteboard`, {
      headers:{'x-participant-token':participantToken}, credentials:'include',
    }).then(r=>r.json()).then(d=>{ if(d.snapshot) applySnapshot(d.snapshot); }).catch(()=>{});
  }, [meetingId,participantToken,applySnapshot]);

  /* ── WS updates ───────────────────────────────────────── */
  useEffect(() => {
    const ws = wsRef.current; if (!ws) return;
    const h = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'whiteboard_update' && msg.snapshot && !isHost) applySnapshot(msg.snapshot);
        if (msg.type === 'slides_updated') {
          setSlides(msg.slides ?? []);
          if (typeof msg.current === 'number') setCurrentSlide(msg.current);
          if ((msg.slides ?? []).length > 0) setShowSlides(true);
        }
        if (msg.type === 'slide_navigate' && !isHost && typeof msg.current === 'number') {
          setCurrentSlide(msg.current);
        }
      } catch {}
    };
    ws.addEventListener('message', h);
    return () => ws.removeEventListener('message', h);
  }, [wsRef, isHost, applySnapshot]);

  /* ── Resize observer ─────────────────────────────────── */
  useEffect(()=>{
    const obs=new ResizeObserver(()=>{
      const c=mainRef.current; const o=overlayRef.current; const cont=contRef.current;
      if(!c||!o||!cont) return;
      const {width:w,height:h}=cont.getBoundingClientRect();
      const rw=Math.round(w), rh=Math.round(h);
      if(c.width!==rw||c.height!==rh){
        c.width=rw; c.height=rh; o.width=rw; o.height=rh;
        redrawMain(objsRef.current);
        drawSelectionBox(objsRef.current,selIdRef.current);
      }
    });
    if(contRef.current) obs.observe(contRef.current);
    return ()=>obs.disconnect();
  },[redrawMain,drawSelectionBox]);

  /* ── focus textarea ──────────────────────────────────── */
  useEffect(()=>{ if(textEdit) setTimeout(()=>textareaRef.current?.focus(),30); },[textEdit]);

  /* ── Canvas coordinate helper ─────────────────────────── */
  const toCanvasXY = (clientX: number, clientY: number): [number,number] => {
    const r = mainRef.current!.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  };

  const commitObj = useCallback((o:SceneObj) => {
    histRef.current=[...histRef.current, objsRef.current];
    const next=[...objsRef.current, o];
    objsRef.current=next;
    redrawMain(next);
    setSelId(null); clearOverlay();
    scheduleSync(next);
  }, [redrawMain, clearOverlay, scheduleSync]);

  const updateObj = useCallback((id:string, patch:Partial<SceneObj>) => {
    const next=objsRef.current.map(o=>o.id===id?{...o,...patch} as SceneObj:o);
    objsRef.current=next; redrawMain(next); scheduleSync(next);
  }, [redrawMain, scheduleSync]);

  /* ── Core pointer logic ───────────────────────────────── */
  const handleDown = useCallback((mx: number, my: number) => {
    if (!isHost) return;
    const t = toolRef.current, c = colorRef.current, w = lwRef.current;

    if (t === 'text') {
      const ctx = getCtx();
      const hit = [...objsRef.current].reverse().find(o => ctx && hitTest(o,mx,my,ctx) && o.kind==='text');
      if (hit && hit.kind==='text') { setSelId(hit.id); setTool('select'); drawSelectionBox(objsRef.current,hit.id); return; }
      setTextEdit({id:uid(), x:mx, y:my+w*5, size:Math.max(14,w*5), color:c, initText:''});
      return;
    }

    if (t === 'select') {
      const ctx = getCtx(); const sid = selIdRef.current;
      if (sid) {
        const selObj = objsRef.current.find(o=>o.id===sid);
        if (selObj && ctx) {
          const bb = getBB(selObj,ctx); const pad=6;
          const hi = handleAt({x:bb.x-pad,y:bb.y-pad,w:bb.w+pad*2,h:bb.h+pad*2},mx,my);
          if (hi >= 0) { dragRef.current={type:'handle',startX:mx,startY:my,curX:mx,curY:my,id:sid,hi,origObj:selObj}; return; }
        }
      }
      const hit = [...objsRef.current].reverse().find(o => { const c2=getCtx(); return c2&&hitTest(o,mx,my,c2); });
      if (hit) { setSelId(hit.id); drawSelectionBox(objsRef.current,hit.id); dragRef.current={type:'move',startX:mx,startY:my,curX:mx,curY:my,id:hit.id,origObj:hit}; }
      else { setSelId(null); clearOverlay(); }
      return;
    }

    dragRef.current = {type:'draw',tool:t,startX:mx,startY:my,curX:mx,curY:my,pts:[[mx,my]]};
  }, [isHost, drawSelectionBox, clearOverlay]);

  const handleMove = useCallback((mx: number, my: number) => {
    if (!isHost) return;
    const d = dragRef.current; if (!d) return;
    const c = colorRef.current, w = lwRef.current;

    if (d.type==='move' && d.id) {
      const dx=mx-d.startX, dy=my-d.startY, orig=d.origObj!;
      let patched: SceneObj;
      switch(orig.kind){
        case 'stroke': patched={...orig,pts:orig.pts.map(([x,y])=>[x+dx,y+dy] as [number,number])}; break;
        case 'line':   patched={...orig,x1:orig.x1+dx,y1:orig.y1+dy,x2:orig.x2+dx,y2:orig.y2+dy}; break;
        case 'rect':   patched={...orig,x:orig.x+dx,y:orig.y+dy}; break;
        case 'ell':    patched={...orig,cx:orig.cx+dx,cy:orig.cy+dy}; break;
        case 'text':   patched={...orig,x:orig.x+dx,y:orig.y+dy}; break;
      }
      const next=objsRef.current.map(o=>o.id===d.id?patched:o);
      objsRef.current=next; redrawMain(next); drawSelectionBox(next,d.id); return;
    }

    if (d.type==='handle' && d.id!=null && d.hi!=null) {
      const dx=mx-d.curX, dy=my-d.curY; d.curX=mx; d.curY=my;
      const orig=objsRef.current.find(o=>o.id===d.id)!;
      const patched=applyResize(orig,d.hi,dx,dy);
      const next=objsRef.current.map(o=>o.id===d.id?patched:o);
      objsRef.current=next; redrawMain(next); drawSelectionBox(next,d.id); return;
    }

    if (d.type==='draw') {
      const {tool:t2,startX:sx,startY:sy}=d;
      const oc=overlayRef.current; if(!oc) return;
      const ctx=oc.getContext('2d')!;
      ctx.clearRect(0,0,oc.width,oc.height);
      if (t2==='pencil'||t2==='eraser') {
        d.pts!.push([mx,my]);
        ctx.save(); ctx.strokeStyle=t2==='eraser'?'#ffffff':c; ctx.lineWidth=t2==='eraser'?w*4:w;
        ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.beginPath(); ctx.moveTo(d.pts![0][0],d.pts![0][1]);
        for(let i=1;i<d.pts!.length;i++) ctx.lineTo(d.pts![i][0],d.pts![i][1]);
        ctx.stroke(); ctx.restore();
      } else {
        ctx.save(); ctx.strokeStyle=c; ctx.lineWidth=w; ctx.lineCap='round'; ctx.lineJoin='round';
        if (t2==='line') { ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(mx,my); ctx.stroke(); }
        else if (t2==='rect') { ctx.strokeRect(sx,sy,mx-sx,my-sy); }
        else if (t2==='ellipse') {
          const rxt=Math.abs((mx-sx)/2), ryt=Math.abs((my-sy)/2);
          ctx.beginPath(); ctx.ellipse(sx+(mx-sx)/2,sy+(my-sy)/2,Math.max(1,rxt),Math.max(1,ryt),0,0,Math.PI*2); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }, [isHost, redrawMain, drawSelectionBox]);

  const handleUp = useCallback((mx: number, my: number) => {
    if (!isHost) return;
    const d = dragRef.current; if (!d) return;
    const c = colorRef.current, w = lwRef.current;

    if (d.type==='move' && d.id) {
      dragRef.current=null;
      histRef.current=[...histRef.current, d.origObj ? objsRef.current.map(o=>o.id===d.id?d.origObj!:o) : objsRef.current];
      scheduleSync(objsRef.current); return;
    }
    if (d.type==='handle') { dragRef.current=null; scheduleSync(objsRef.current); return; }
    if (d.type==='draw') {
      clearOverlay();
      const {tool:t2,startX:sx,startY:sy}=d;
      let o: SceneObj|null=null;
      if (t2==='pencil') {
        const pts=d.pts!; if (!pts.some(([x,y])=>x===mx&&y===my)) pts.push([mx,my]);
        if (pts.length>=2) o={id:uid(),kind:'stroke',pts,color:c,lw:w};
      } else if (t2==='eraser') {
        const pts=d.pts!; if (!pts.some(([x,y])=>x===mx&&y===my)) pts.push([mx,my]);
        if (pts.length>=2) o={id:uid(),kind:'stroke',pts,color:'#ffffff',lw:w*4};
      } else if (t2==='line') {
        if (Math.hypot(mx-sx,my-sy)>3) o={id:uid(),kind:'line',x1:sx,y1:sy,x2:mx,y2:my,color:c,lw:w};
      } else if (t2==='rect') {
        if (Math.abs(mx-sx)>3&&Math.abs(my-sy)>3) o={id:uid(),kind:'rect',x:sx,y:sy,w:mx-sx,h:my-sy,color:c,lw:w};
      } else if (t2==='ellipse') {
        if (Math.abs(mx-sx)>3&&Math.abs(my-sy)>3)
          o={id:uid(),kind:'ell',cx:sx+(mx-sx)/2,cy:sy+(my-sy)/2,rx:(mx-sx)/2,ry:(my-sy)/2,color:c,lw:w};
      }
      if (o) commitObj(o);
    }
    dragRef.current=null;
  }, [isHost, clearOverlay, commitObj, scheduleSync]);

  /* ── Mouse events ────────────────────────────────────── */
  const onMouseDown = (e: React.MouseEvent) => { e.preventDefault(); const [mx,my]=toCanvasXY(e.clientX,e.clientY); handleDown(mx,my); };
  const onMouseMove = (e: React.MouseEvent) => {
    const [mx,my]=toCanvasXY(e.clientX,e.clientY); handleMove(mx,my);
    if (isHost && toolRef.current==='select' && selIdRef.current) {
      const ctx=getCtx(); const so=objsRef.current.find(o=>o.id===selIdRef.current);
      if (so&&ctx){ const bb=getBB(so,ctx); const pad=6; const hi=handleAt({x:bb.x-pad,y:bb.y-pad,w:bb.w+pad*2,h:bb.h+pad*2},mx,my);
        if (mainRef.current) mainRef.current.style.cursor = hi>=0 ? CURSORS[hi] : 'default'; }
    }
  };
  const onMouseUp   = (e: React.MouseEvent) => { const [mx,my]=toCanvasXY(e.clientX,e.clientY); handleUp(mx,my); };
  const onMouseLeave= (e: React.MouseEvent) => { if(dragRef.current?.type==='draw'){const [mx,my]=toCanvasXY(e.clientX,e.clientY);handleUp(mx,my);} };

  /* ── Touch events ────────────────────────────────────── */
  const onTouchStart = (e: React.TouchEvent) => { e.preventDefault(); const t=e.touches[0]; if(!t) return; const [mx,my]=toCanvasXY(t.clientX,t.clientY); handleDown(mx,my); };
  const onTouchMove  = (e: React.TouchEvent) => { e.preventDefault(); const t=e.touches[0]; if(!t) return; const [mx,my]=toCanvasXY(t.clientX,t.clientY); handleMove(mx,my); };
  const onTouchEnd   = (e: React.TouchEvent) => { e.preventDefault(); const t=e.changedTouches[0]; if(!t) return; const [mx,my]=toCanvasXY(t.clientX,t.clientY); handleUp(mx,my); };

  /* ── Text commit ─────────────────────────────────────── */
  const commitText = useCallback((te: typeof textEdit, val: string) => {
    if(!te) return; setTextEdit(null);
    const trimmed=val.trim(); if(!trimmed) return;
    const existing=objsRef.current.find(o=>o.id===te.id);
    if(existing&&existing.kind==='text') updateObj(te.id,{text:trimmed} as any);
    else commitObj({id:te.id,kind:'text',x:te.x,y:te.y,text:trimmed,color:te.color,size:te.size});
  }, [updateObj, commitObj]);

  /* ── Keyboard ────────────────────────────────────────── */
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if(!isHost||textEdit) return;
      if((e.key==='Delete'||e.key==='Backspace')&&selIdRef.current&&document.activeElement===document.body){
        histRef.current=[...histRef.current,objsRef.current];
        const next=objsRef.current.filter(o=>o.id!==selIdRef.current);
        objsRef.current=next; setSelId(null); clearOverlay(); redrawMain(next); scheduleSync(next);
      }
      if(e.ctrlKey&&e.key==='z'&&histRef.current.length>0){
        const prev=histRef.current[histRef.current.length-1];
        histRef.current=histRef.current.slice(0,-1);
        objsRef.current=prev; redrawMain(prev); drawSelectionBox(prev,selIdRef.current); scheduleSync(prev);
      }
      /* arrow keys for slide navigation */
      if(e.key==='ArrowRight'&&slides.length>0) navigateTo(Math.min(currentSlide+1,slides.length-1));
      if(e.key==='ArrowLeft'&&slides.length>0)  navigateTo(Math.max(currentSlide-1,0));
    };
    window.addEventListener('keydown',h);
    return ()=>window.removeEventListener('keydown',h);
  },[isHost,textEdit,clearOverlay,redrawMain,drawSelectionBox,scheduleSync,slides,currentSlide,navigateTo]);

  /* ── Undo / Clear / Delete ───────────────────────────── */
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
  const deleteSelected=()=>{
    const sid=selIdRef.current; if(!sid) return;
    histRef.current=[...histRef.current,objsRef.current];
    const next=objsRef.current.filter(o=>o.id!==sid);
    objsRef.current=next; setSelId(null); clearOverlay(); redrawMain(next); scheduleSync(next);
  };

  /* ── Text area style ─────────────────────────────────── */
  const textAreaStyle = useMemo(():React.CSSProperties => {
    if(!textEdit) return {display:'none'};
    return {
      position:'absolute', left:textEdit.x, top:textEdit.y-textEdit.size,
      minWidth:120, maxWidth:400, font:`${textEdit.size}px Montserrat, Arial, sans-serif`,
      color:textEdit.color, background:'rgba(99,102,241,0.06)', border:'1.5px dashed #6366f1',
      borderRadius:4, padding:'2px 6px', outline:'none', resize:'none', overflow:'hidden',
      lineHeight:1.3, zIndex:20,
    };
  },[textEdit]);

  const getCursor=():string=>{
    if(!isHost) return 'default';
    if(tool==='text') return 'text';
    if(tool==='eraser') return 'cell';
    if(tool==='select') return 'default';
    return 'crosshair';
  };

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',background:'#f3f4f6',userSelect:'none'}}>

      {/* ── Main Toolbar ── */}
      {isHost && (
        <div style={{
          display:'flex',alignItems:'center',gap:4,padding:'6px 10px',
          background:'#fff',borderBottom:'1px solid #e5e7eb',flexWrap:'wrap',flexShrink:0,
          boxShadow:'0 1px 4px rgba(0,0,0,0.07)',
        }}>
          {/* Drawing tools */}
          {TOOLS.map(t=>(
            <button key={t.id} onClick={()=>setTool(t.id)} title={t.label} style={{
              display:'flex',flexDirection:'column',alignItems:'center',gap:2,
              padding:'5px 8px',borderRadius:8,border:'none',cursor:'pointer',
              fontSize:16,lineHeight:1,
              background:tool===t.id?'#6366f1':'transparent',
              color:tool===t.id?'#fff':'#374151',
              transition:'background 0.15s',minWidth:50,
            }}>
              <span style={{fontWeight:t.id==='text'?700:'normal'}}>{t.icon}</span>
              <span style={{fontSize:9,fontFamily:'Montserrat,sans-serif',fontWeight:600,letterSpacing:0.2}}>{t.label}</span>
            </button>
          ))}

          <div style={{width:1,height:36,background:'#e5e7eb',margin:'0 2px',flexShrink:0}}/>

          {/* Colors */}
          {PALETTE.map(c=>(
            <button key={c} onClick={()=>setColor(c)} title={c} style={{
              width:22,height:22,borderRadius:'50%',border:'none',background:c,cursor:'pointer',flexShrink:0,
              boxShadow:color===c?`0 0 0 2px #fff,0 0 0 4px #6366f1`:c==='#ffffff'?'0 0 0 1px #d1d5db':'none',
              transition:'box-shadow 0.15s',
            }}/>
          ))}

          <div style={{width:1,height:36,background:'#e5e7eb',margin:'0 2px',flexShrink:0}}/>

          {/* Size */}
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
            <span style={{fontSize:9,color:'#6b7280',fontFamily:'Montserrat,sans-serif',fontWeight:600}}>РАЗМЕР</span>
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              {WIDTHS.map(w=>(
                <button key={w} onClick={()=>setLw(w)} style={{
                  width:w+10,height:w+10,borderRadius:'50%',border:'none',cursor:'pointer',flexShrink:0,
                  background:lw===w?'#6366f1':'#9ca3af',transition:'background 0.15s',
                }}/>
              ))}
            </div>
          </div>

          <div style={{width:1,height:36,background:'#e5e7eb',margin:'0 2px',flexShrink:0}}/>

          {/* Undo / Clear / Delete */}
          {selId && (
            <button onClick={deleteSelected} title="Удалить" style={{
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
            fontSize:16,minWidth:44,
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

          <div style={{width:1,height:36,background:'#e5e7eb',margin:'0 2px',flexShrink:0}}/>

          {/* Slides toggle */}
          <button onClick={()=>setShowSlides(v=>!v)} style={{
            display:'flex',flexDirection:'column',alignItems:'center',gap:2,
            padding:'5px 8px',borderRadius:8,border:'none',cursor:'pointer',
            background:showSlides?'#6366f1':'transparent',
            color:showSlides?'#fff':'#374151',fontSize:16,minWidth:50,
            transition:'background 0.15s',
          }}>
            <span>🖼</span>
            <span style={{fontSize:9,fontFamily:'Montserrat,sans-serif',fontWeight:600}}>
              {showSlides ? '▲ Слайды' : '▼ Слайды'}{slides.length>0?` (${slides.length})`:''}
            </span>
          </button>

          {/* Slide nav (visible when slides exist) */}
          {slides.length > 0 && (
            <>
              <button onClick={()=>navigateTo(Math.max(0,currentSlide-1))} disabled={currentSlide===0} style={{
                padding:'4px 10px',borderRadius:8,border:'none',cursor:currentSlide>0?'pointer':'default',
                background:'transparent',color:currentSlide>0?'#374151':'#d1d5db',fontSize:20,fontWeight:700,
              }}>‹</button>
              <span style={{
                fontSize:12,fontFamily:'Montserrat,sans-serif',fontWeight:700,
                color:'#6366f1',minWidth:44,textAlign:'center',
              }}>{currentSlide+1} / {slides.length}</span>
              <button onClick={()=>navigateTo(Math.min(slides.length-1,currentSlide+1))} disabled={currentSlide===slides.length-1} style={{
                padding:'4px 10px',borderRadius:8,border:'none',
                cursor:currentSlide<slides.length-1?'pointer':'default',
                background:'transparent',color:currentSlide<slides.length-1?'#374151':'#d1d5db',fontSize:20,fontWeight:700,
              }}>›</button>
            </>
          )}
        </div>
      )}

      {!isHost && (
        <div style={{
          flexShrink:0,padding:'5px 10px',
          background:'#fff',borderBottom:'1px solid #e5e7eb',
          display:'flex',alignItems:'center',justifyContent:'space-between',
          fontFamily:'Montserrat,sans-serif',
        }}>
          <span style={{fontSize:11,color:'#6b7280'}}>Просмотр · только ведущий может рисовать</span>
          {slides.length > 0 && (
            <span style={{fontSize:12,fontWeight:700,color:'#6366f1'}}>{currentSlide+1} / {slides.length}</span>
          )}
        </div>
      )}

      {/* ── Slides Panel ── */}
      {showSlides && (
        <div style={{
          flexShrink:0,background:'#fff',borderBottom:'1px solid #e5e7eb',
          padding:'8px 10px',display:'flex',flexDirection:'column',gap:6,
        }}>
          {/* Header row with collapse button */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:11,fontWeight:700,color:'#6b7280',fontFamily:'Montserrat,sans-serif',letterSpacing:'0.04em'}}>
              СЛАЙДЫ{slides.length>0?` · ${currentSlide+1} / ${slides.length}`:''}
            </span>
            <button
              onClick={()=>setShowSlides(false)}
              style={{
                display:'flex',alignItems:'center',gap:3,padding:'3px 10px',
                borderRadius:6,border:'1px solid #e5e7eb',background:'#f9fafb',
                cursor:'pointer',fontFamily:'Montserrat,sans-serif',fontSize:11,
                fontWeight:600,color:'#6b7280',
              }}
            >
              ▲ Свернуть
            </button>
          </div>

          {/* Upload row (host only) */}
          {isHost && (
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.pptx,.ppt"
                multiple
                style={{display:'none'}}
                onChange={handleFileInput}
              />
              <button
                onClick={()=>fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  padding:'6px 14px',borderRadius:8,border:'none',cursor:uploading?'wait':'pointer',
                  background:'#6366f1',color:'#fff',fontFamily:'Montserrat,sans-serif',
                  fontWeight:700,fontSize:12,display:'flex',alignItems:'center',gap:6,
                  opacity:uploading?0.7:1,
                }}
              >
                <span>+</span>
                {uploading ? 'Загружаю...' : 'Добавить слайды'}
              </button>
              <span style={{fontSize:11,color:'#6b7280',fontFamily:'Montserrat,sans-serif'}}>
                PNG · JPG · WEBP · PDF (страницы → слайды) · GIF
              </span>
              {uploadMsg && (
                <span style={{
                  fontSize:11,fontFamily:'Montserrat,sans-serif',
                  color:uploadMsg.startsWith('Ошибка')||uploadMsg.startsWith('PowerPoint')?'#ef4444':'#6366f1',
                  maxWidth:400,
                }}>{uploadMsg}</span>
              )}
            </div>
          )}

          {/* Thumbnails strip */}
          {slides.length > 0 ? (
            <div ref={thumbsRef} style={{
              display:'flex',gap:6,overflowX:'auto',paddingBottom:4,
              scrollbarWidth:'thin',
            }}>
              {slides.map((slide, idx) => (
                <div key={slide.id} data-idx={idx} style={{
                  flexShrink:0, position:'relative',
                  border:`2.5px solid ${idx===currentSlide?'#6366f1':'#e5e7eb'}`,
                  borderRadius:8,overflow:'hidden',cursor:'pointer',
                  boxShadow:idx===currentSlide?'0 0 0 2px rgba(99,102,241,0.3)':'none',
                  transition:'border-color 0.15s,box-shadow 0.15s',
                  background:'#f3f4f6',
                }}>
                  <img
                    src={`${API}${slide.url}`}
                    alt={slide.name}
                    onClick={()=>navigateTo(idx)}
                    style={{
                      width:96,height:72,objectFit:'contain',display:'block',
                      background:'#fff',
                    }}
                    loading="lazy"
                  />
                  {/* Slide number badge */}
                  <div style={{
                    position:'absolute',bottom:2,left:2,
                    background:'rgba(0,0,0,0.55)',color:'#fff',
                    fontSize:9,fontFamily:'Montserrat,sans-serif',fontWeight:700,
                    padding:'1px 4px',borderRadius:4,
                  }}>{idx+1}</div>
                  {/* Delete button (host only) */}
                  {isHost && (
                    <button
                      onClick={e=>{e.stopPropagation(); deleteSlide(slide.id);}}
                      style={{
                        position:'absolute',top:2,right:2,
                        width:18,height:18,borderRadius:'50%',border:'none',
                        background:'rgba(239,68,68,0.9)',color:'#fff',
                        fontSize:10,fontWeight:700,cursor:'pointer',
                        display:'flex',alignItems:'center',justifyContent:'center',
                        lineHeight:1,padding:0,
                      }}
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              fontSize:12,color:'#9ca3af',fontFamily:'Montserrat,sans-serif',
              padding:'4px 0',
            }}>
              {isHost ? 'Нажмите «Добавить слайды» чтобы загрузить изображения или PDF' : 'Слайды ещё не загружены'}
            </div>
          )}
        </div>
      )}

      {/* ── Canvas area ── */}
      <div ref={contRef} style={{flex:1,position:'relative',overflow:'hidden'}}>
        <canvas ref={mainRef}
          style={{
            position:'absolute',inset:0,
            background: slides.length > 0 ? '#1e1e2e' : '#ffffff',
            cursor:isHost?getCursor():'default',
            touchAction:'none',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
        <canvas ref={overlayRef} style={{position:'absolute',inset:0,pointerEvents:'none'}}/>

        {/* Slide counter overlay on canvas (non-host) */}
        {!isHost && slides.length > 0 && (
          <div style={{
            position:'absolute',bottom:12,right:12,
            background:'rgba(0,0,0,0.5)',color:'#fff',
            fontFamily:'Montserrat,sans-serif',fontWeight:700,fontSize:13,
            padding:'4px 10px',borderRadius:20,pointerEvents:'none',
          }}>{currentSlide+1} / {slides.length}</div>
        )}

        {/* inline text editing */}
        {textEdit && (
          <textarea
            ref={textareaRef}
            defaultValue={textEdit.initText}
            rows={1}
            style={textAreaStyle}
            placeholder="Введите текст..."
            onChange={e=>{const ta=e.currentTarget;ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';}}
            onBlur={e=>commitText(textEdit,e.currentTarget.value)}
            onKeyDown={e=>{
              if(e.key==='Escape'){setTextEdit(null);}
              if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();commitText(textEdit,e.currentTarget.value);}
            }}
          />
        )}
      </div>
    </div>
  );
}
