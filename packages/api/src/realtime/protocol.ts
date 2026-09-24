/**
 * Shared message protocol between the realtime gateway and the web client.
 */
import type { Op } from '@collabmd/core';
import type { Role } from '../config.js';

export interface PresenceUser {
  userId: string;
  username: string;
  color: string;
  role: Role;
  cursor: number;
  selStart: number;
  selEnd: number;
}

export type ClientMsg =
  | { t: 'join'; token: string }
  | { t: 'ops'; ops: Op[] }
  | { t: 'cursor'; cursor: number; selStart: number; selEnd: number }
  | { t: 'ping' };

export type ServerMsg =
  | {
      t: 'init';
      ops: Op[];
      you: { userId: string; username: string; color: string; role: Role };
      presence: PresenceUser[];
      autoVersionMs: number;
    }
  | { t: 'ops'; ops: Op[]; author: string; fromVersion: number }
  | { t: 'presence'; users: PresenceUser[] }
  | { t: 'anchors'; comments: AnchorWire[] }
  | { t: 'error'; message: string }
  | { t: 'pong' };

export interface AnchorWire {
  id: string;
  quote: string;
  index: number;
  end: number;
  status: 'anchored' | 'lost';
  threadState: 'open' | 'resolved' | 'reopened';
}
