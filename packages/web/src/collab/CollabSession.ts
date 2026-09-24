import { CrdtDoc, type Op } from '@collabmd/core';

export interface RemotePresence {
  userId: string;
  username: string;
  color: string;
  role: string;
  cursor: number;
  selStart: number;
  selEnd: number;
}

export interface AnchorState {
  id: string;
  quote: string;
  index: number;
  end: number;
  status: 'anchored' | 'lost';
  threadState: 'open' | 'resolved' | 'reopened';
}

export interface SessionYou {
  userId: string;
  username: string;
  color: string;
  role: string;
}

type Listener = () => void;

function wsUrl(docId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = localStorage.getItem('cmdtoken') ?? '';
  return `${proto}://${location.host}/ws/${docId}?token=${encodeURIComponent(token)}`;
}

/**
 * Client-side collaboration controller. Owns the local CRDT replica, turns
 * plain-textarea edits into CRDT ops, queues ops while offline, and flushes
 * the queue on reconnect. Remote ops integrate straight into the same replica;
 * the React layer re-reads text/ids after every change.
 */
export class CollabSession {
  readonly doc = new CrdtDoc();
  presence: RemotePresence[] = [];
  you: SessionYou | null = null;
  anchors: AnchorState[] = [];
  connected = false;
  error: string | null = null;

  private ws: WebSocket | null = null;
  private queue: Op[] = [];
  private listeners = new Set<Listener>();
  private clientId = crypto.randomUUID();
  private retryDelay = 300;
  private closedByUser = false;

  constructor(private docId: string) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  get text(): string {
    return this.doc.text();
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(): void {
    const ws = new WebSocket(wsUrl(this.docId));
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.error = null;
      this.retryDelay = 300;
      this.flushQueue();
      this.emit();
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'init') {
        for (const op of msg.ops as Op[]) this.doc.integrate(op);
        this.you = msg.you;
        this.presence = msg.presence;
        // Drop queued ops the server already has (dedup is server-side, but
        // avoid resending inserts now part of the snapshot).
        this.emit();
        this.flushQueue();
      } else if (msg.t === 'ops') {
        for (const op of msg.ops as Op[]) this.doc.integrate(op);
        this.emit();
      } else if (msg.t === 'presence') {
        this.presence = msg.users;
        this.emit();
      } else if (msg.t === 'anchors') {
        this.anchors = msg.comments;
        this.emit();
      } else if (msg.t === 'error') {
        this.error = msg.message;
        this.emit();
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.emit();
      if (!this.closedByUser) {
        setTimeout(() => this.openSocket(), this.retryDelay);
        this.retryDelay = Math.min(5000, this.retryDelay * 1.5);
      }
    };
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.queue.length === 0) return;
    const pending = this.queue;
    this.queue = [];
    this.ws.send(JSON.stringify({ t: 'ops', ops: pending }));
  }

  private sendOps(ops: Op[]): void {
    if (ops.length === 0) return;
    this.queue.push(...ops);
    this.flushQueue();
  }

  /**
   * Apply a local textarea replacement against the converged CRDT text.
   * Indices are plain visible-text offsets; the kernel maps them to char ids.
   */
  localEdit(index: number, delCount: number, inserted: string): void {
    const ops = this.doc.edit(this.clientId, index, delCount, inserted);
    this.emit();
    this.sendOps(ops);
  }

  sendCursor(cursor: number, selStart: number, selEnd: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'cursor', cursor, selStart, selEnd }));
    }
  }
}
