/** Ephemeral project presence: live cursors, selections, and node-drag previews. */

import type { ServerWebSocket } from 'bun';
import type { WsData } from '../routes/websockets.ts';

interface SocketLike {
  send(data: string): void;
}

export interface CollabUser {
  id: string;
  username: string;
  displayName: string | null;
}

export interface CollabSelection {
  nodes: string[];
  links: string[];
  drawings: string[];
}

export interface CollabParticipant {
  id: string;
  userId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selection: CollabSelection;
  nodeMove: { nodeId: string; x: number; y: number } | null;
}

interface Member {
  socket: SocketLike;
  participant: CollabParticipant;
}

const COLORS = [
  '#d19155',
  '#7bc9c4',
  '#b48cc9',
  '#7ba7d1',
  '#79c98a',
  '#e0b45c',
  '#d9705f',
  '#c9a27b',
];

function colorFor(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index++)
    hash = (hash * 31 + userId.charCodeAt(index)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length] ?? COLORS[0]!;
}

const rooms = new Map<string, Map<string, Member>>();
const bySocket = new WeakMap<SocketLike, { projectId: string; id: string }>();

function send(socket: SocketLike, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // The socket may have closed between a room snapshot and the broadcast.
  }
}

function broadcast(projectId: string, payload: unknown, except?: string): void {
  for (const member of rooms.get(projectId)?.values() ?? []) {
    if (member.participant.id !== except) send(member.socket, payload);
  }
}

function publicParticipant(participant: CollabParticipant): CollabParticipant {
  return {
    ...participant,
    selection: {
      nodes: [...participant.selection.nodes],
      links: [...participant.selection.links],
      drawings: [...participant.selection.drawings],
    },
    cursor: participant.cursor ? { ...participant.cursor } : null,
    nodeMove: participant.nodeMove ? { ...participant.nodeMove } : null,
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function strings(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, limit)
    : [];
}

export function joinCollab(ws: ServerWebSocket<WsData>, projectId: string, user: CollabUser): void {
  const id = crypto.randomUUID();
  const participant: CollabParticipant = {
    id,
    userId: user.id,
    name: user.displayName || user.username,
    color: colorFor(user.id),
    cursor: null,
    selection: { nodes: [], links: [], drawings: [] },
    nodeMove: null,
  };
  let room = rooms.get(projectId);
  if (!room) {
    room = new Map();
    rooms.set(projectId, room);
  }
  const existing = [...room.values()].map((member) => publicParticipant(member.participant));
  const member: Member = { socket: ws, participant };
  room.set(id, member);
  bySocket.set(ws, { projectId, id });
  send(ws, {
    type: 'presence.init',
    selfId: id,
    participants: [...existing, publicParticipant(participant)],
  });
  broadcast(projectId, { type: 'presence.join', participant: publicParticipant(participant) }, id);
}

export function updateCollab(ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
  const location = bySocket.get(ws);
  if (!location) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as Record<string, unknown>;
  } catch {
    return;
  }
  const member = rooms.get(location.projectId)?.get(location.id);
  if (!member) return;
  const participant = member.participant;
  switch (payload.type) {
    case 'cursor': {
      const cursor = payload.cursor;
      if (!cursor || typeof cursor !== 'object') return;
      const point = cursor as Record<string, unknown>;
      if (!finite(point.x) || !finite(point.y)) return;
      participant.cursor = { x: point.x, y: point.y };
      broadcast(
        location.projectId,
        { type: 'presence.cursor', id: participant.id, cursor: participant.cursor },
        participant.id,
      );
      return;
    }
    case 'selection': {
      const selection = payload.selection;
      if (!selection || typeof selection !== 'object') return;
      const value = selection as Record<string, unknown>;
      participant.selection = {
        nodes: strings(value.nodes, 1000),
        links: strings(value.links, 1000),
        drawings: strings(value.drawings, 1000),
      };
      broadcast(
        location.projectId,
        { type: 'presence.selection', id: participant.id, selection: participant.selection },
        participant.id,
      );
      return;
    }
    case 'node.move': {
      const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : null;
      if (!nodeId || !finite(payload.x) || !finite(payload.y)) return;
      participant.nodeMove = { nodeId, x: payload.x, y: payload.y };
      broadcast(
        location.projectId,
        { type: 'node.move', id: participant.id, nodeId, x: payload.x, y: payload.y },
        participant.id,
      );
      return;
    }
    case 'node.move.end': {
      const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : null;
      if (!nodeId) return;
      if (participant.nodeMove?.nodeId === nodeId) participant.nodeMove = null;
      broadcast(
        location.projectId,
        { type: 'node.move.end', id: participant.id, nodeId },
        participant.id,
      );
      return;
    }
    default:
      return;
  }
}

export function leaveCollab(ws: ServerWebSocket<WsData>): void {
  const location = bySocket.get(ws);
  if (!location) return;
  bySocket.delete(ws);
  const room = rooms.get(location.projectId);
  room?.delete(location.id);
  broadcast(location.projectId, { type: 'presence.leave', id: location.id }, location.id);
  if (room?.size === 0) rooms.delete(location.projectId);
}
