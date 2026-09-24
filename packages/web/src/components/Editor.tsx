import { useEffect, useMemo, useRef } from 'react';
import type { CollabSession } from '../collab/CollabSession';
import type { Comment } from '../api/client';
import { diffTextChange } from '../collab/textChange';

interface Props {
  session: CollabSession;
  text: string;
  comments: Comment[];
  canEdit: boolean;
  previewScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  onSelect: (quote: string, index: number) => void;
}

interface Mark {
  id: string;
  start: number;
  end: number;
  cls: string;
}

const PAD_Y = 16;
const PAD_X = 20;
const LINE = 23.1; // 14px font * 1.65 line-height
const CHAR_W = 7.82; // monospace average advance

function coords(text: string, offset: number): { top: number; left: number } {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  const row = lines.length - 1;
  const col = lines[lines.length - 1].length;
  return { top: PAD_Y + row * LINE, left: PAD_X + col * CHAR_W };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function Editor({ session, text, comments, canEdit, previewScrollRef, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastTextRef = useRef(text);

  const marks: Mark[] = useMemo(() => {
    const out: Mark[] = [];
    for (const c of comments) {
      if (c.status === 'lost') {
        const start = Math.min(c.index, text.length);
        out.push({ id: c.id, start, end: start + 1, cls: `cmt-mark lost ${c.thread_state}` });
        continue;
      }
      const start = Math.max(0, Math.min(c.index, text.length));
      const end = Math.max(start, Math.min(c.end ?? start, text.length));
      if (end > start) out.push({ id: c.id, start, end, cls: `cmt-mark ${c.thread_state}` });
    }
    return out.sort((a, b) => a.start - b.start || b.end - a.end);
  }, [comments, text]);

  const overlayHtml = useMemo(() => {
    const pieces: string[] = [];
    let cursor = 0;
    for (const m of marks) {
      if (m.start < cursor) continue;
      pieces.push(escapeHtml(text.slice(cursor, m.start)));
      const inner = escapeHtml(text.slice(m.start, Math.min(m.end, text.length)));
      pieces.push(`<span class="${m.cls}" data-id="${m.id}">${inner || '​'}</span>`);
      cursor = m.end;
    }
    pieces.push(escapeHtml(text.slice(cursor)));
    return pieces.join('');
  }, [marks, text]);

  // Sync textarea content after remote CRDT changes while fixing up selection.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (ta.value === text) {
      lastTextRef.current = text;
      return;
    }
    const old = lastTextRef.current;
    const change = diffTextChange(old, text);
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    ta.value = text;
    if (selStart < change.index) {
      ta.setSelectionRange(selStart, selEnd);
    } else if (selStart > change.index + change.delCount) {
      const delta = change.inserted.length - change.delCount;
      ta.setSelectionRange(selStart + delta, selEnd + delta);
    } else {
      const pos = change.index + change.inserted.length;
      ta.setSelectionRange(pos, pos);
    }
    lastTextRef.current = text;
  }, [text]);

  const handleInput = (): void => {
    const ta = taRef.current;
    if (!ta) return;
    const next = ta.value;
    if (next === lastTextRef.current) return;
    const change = diffTextChange(lastTextRef.current, next);
    session.localEdit(change.index, change.delCount, change.inserted);
    lastTextRef.current = session.text;
  };

  const emitCursor = (): void => {
    const ta = taRef.current;
    if (ta) session.sendCursor(ta.selectionStart, ta.selectionStart, ta.selectionEnd);
  };

  const handleSelect = (): void => {
    emitCursor();
    const ta = taRef.current;
    if (!ta || ta.selectionStart === ta.selectionEnd) return;
    onSelect(text.slice(ta.selectionStart, ta.selectionEnd), ta.selectionStart);
  };

  // Rough bidirectional scroll correspondence between source and preview.
  let syncing = false;
  const syncToPreview = (): void => {
    const src = scrollRef.current;
    const preview = previewScrollRef.current;
    if (syncing || !src || !preview) return;
    syncing = true;
    const maxSrc = src.scrollHeight - src.clientHeight;
    const maxPrev = preview.scrollHeight - preview.clientHeight;
    if (maxSrc > 0 && maxPrev > 0) preview.scrollTop = (src.scrollTop / maxSrc) * maxPrev;
    requestAnimationFrame(() => (syncing = false));
  };
  const syncFromPreview = (): void => {
    const src = scrollRef.current;
    const preview = previewScrollRef.current;
    if (syncing || !src || !preview) return;
    syncing = true;
    const maxSrc = src.scrollHeight - src.clientHeight;
    const maxPrev = preview.scrollHeight - preview.clientHeight;
    if (maxSrc > 0 && maxPrev > 0) src.scrollTop = (preview.scrollTop / maxPrev) * maxSrc;
    requestAnimationFrame(() => (syncing = false));
  };

  useEffect(() => {
    const preview = previewScrollRef.current;
    preview?.addEventListener('scroll', syncFromPreview);
    return () => preview?.removeEventListener('scroll', syncFromPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remotes = session.presence.filter((p) => p.userId !== session.you?.userId);
  const remoteLayer = useMemo(() => {
    return remotes.flatMap((p) => {
      const els: JSX.Element[] = [];
      const s = Math.min(p.selStart, p.selEnd);
      const e = Math.max(p.selStart, p.selEnd);
      if (e > s) {
        const a = coords(text, Math.min(s, text.length));
        const b = coords(text, Math.min(e, text.length));
        els.push(
          <div
            key={`sel-${p.userId}`}
            className="remote-selection"
            style={{
              background: p.color,
              top: Math.min(a.top, b.top) - 2,
              height: Math.max(LINE - 4, b.top - a.top + LINE - 4),
              left: 4,
              right: 4,
            }}
          />,
        );
      }
      const c = coords(text, Math.min(p.cursor, text.length));
      els.push(
        <div
          key={`cur-${p.userId}`}
          className="remote-cursor"
          style={{ top: c.top - 2, left: c.left - 1, background: p.color, height: LINE - 4 }}
        >
          <span className="flag" style={{ background: p.color }}>{p.username}</span>
        </div>,
      );
      return els;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.presence, text]);

  return (
    <div
      className="scroll"
      ref={(el) => {
        scrollRef.current = el;
      }}
      onScroll={() => {
        if (layerRef.current && scrollRef.current) layerRef.current.style.transform = `translateY(${-scrollRef.current.scrollTop}px)`;
        syncToPreview();
      }}
    >
      <div style={{ position: 'relative', minHeight: '100%' }}>
        <div className="mark-layer" ref={layerRef} dangerouslySetInnerHTML={{ __html: overlayHtml + '\n' }} />
        <textarea
          ref={taRef}
          className={`editor-ta ${canEdit ? '' : 'readonly'}`}
          defaultValue={text}
          readOnly={!canEdit}
          spellCheck={false}
          onInput={handleInput}
          onKeyUp={emitCursor}
          onMouseUp={handleSelect}
          onClick={handleSelect}
        />
        {remoteLayer}
      </div>
    </div>
  );
}
