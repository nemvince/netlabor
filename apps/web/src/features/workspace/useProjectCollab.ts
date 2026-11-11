import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

export interface RemoteNodeMove {
  x: number;
  y: number;
  color: string;
  name: string;
}

export type CollabStatus = 'connecting' | 'live' | 'offline';

function socketUrl(projectId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/collab/${projectId}`;
}

/** Live project presence: participants, cursors, selections, and node drags. */
export function useProjectCollab(projectId: string) {
  const [participants, setParticipants] = useState<Record<string, CollabParticipant>>({});
  const [selfId, setSelfId] = useState<string | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const lastCursor = useRef(0);
  const lastMove = useRef(0);

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? 'connecting' : 'offline');
      const socket = new WebSocket(socketUrl(projectId));
      socketRef.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setStatus('live');
      };
      socket.onmessage = (event) => {
        if (disposed || typeof event.data !== 'string') return;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (payload.type === 'presence.init') {
          const list = Array.isArray(payload.participants) ? payload.participants : [];
          const next: Record<string, CollabParticipant> = {};
          for (const item of list) {
            const participant = item as CollabParticipant;
            if (participant && typeof participant.id === 'string') next[participant.id] = participant;
          }
          setParticipants(next);
          setSelfId(typeof payload.selfId === 'string' ? payload.selfId : null);
          return;
        }
        if (payload.type === 'presence.join') {
          const participant = payload.participant as CollabParticipant | undefined;
          if (!participant?.id) return;
          setParticipants((current) => ({ ...current, [participant.id]: participant }));
          return;
        }
        if (payload.type === 'presence.leave') {
          const id = typeof payload.id === 'string' ? payload.id : null;
          if (!id) return;
          setParticipants((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
          return;
        }
        if (payload.type === 'presence.cursor') {
          const id = typeof payload.id === 'string' ? payload.id : null;
          const cursor = payload.cursor as { x: number; y: number } | null;
          if (!id || !cursor) return;
          setParticipants((current) => {
            const existing = current[id];
            return existing ? { ...current, [id]: { ...existing, cursor } } : current;
          });
          return;
        }
        if (payload.type === 'presence.selection') {
          const id = typeof payload.id === 'string' ? payload.id : null;
          const selection = payload.selection as CollabSelection | undefined;
          if (!id || !selection) return;
          setParticipants((current) => {
            const existing = current[id];
            return existing ? { ...current, [id]: { ...existing, selection } } : current;
          });
          return;
        }
        if (payload.type === 'node.move') {
          const id = typeof payload.id === 'string' ? payload.id : null;
          const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : null;
          const x = typeof payload.x === 'number' ? payload.x : Number.NaN;
          const y = typeof payload.y === 'number' ? payload.y : Number.NaN;
          if (!id || !nodeId || !Number.isFinite(x) || !Number.isFinite(y)) return;
          setParticipants((current) => {
            const existing = current[id];
            return existing ? { ...current, [id]: { ...existing, nodeMove: { nodeId, x, y } } } : current;
          });
          return;
        }
        if (payload.type === 'node.move.end') {
          const id = typeof payload.id === 'string' ? payload.id : null;
          const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId : null;
          if (!id || !nodeId) return;
          setParticipants((current) => {
            const existing = current[id];
            if (!existing || existing.nodeMove?.nodeId !== nodeId) return current;
            return { ...current, [id]: { ...existing, nodeMove: null } };
          });
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        socketRef.current = null;
        setStatus('offline');
        const delay = Math.min(800 * 2 ** attempt, 10_000);
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [projectId]);

  const sendCursor = useCallback(
    (point: { x: number; y: number }) => {
      const now = performance.now();
      if (now - lastCursor.current < 40) return;
      lastCursor.current = now;
      send({ type: 'cursor', cursor: point });
    },
    [send],
  );

  const sendSelection = useCallback(
    (selection: CollabSelection) => {
      send({ type: 'selection', selection });
    },
    [send],
  );

  const sendNodeMove = useCallback(
    (nodeId: string, x: number, y: number) => {
      const now = performance.now();
      if (now - lastMove.current < 40) return;
      lastMove.current = now;
      send({ type: 'node.move', nodeId, x, y });
    },
    [send],
  );

  const sendNodeMoveEnd = useCallback(
    (nodeId: string) => send({ type: 'node.move.end', nodeId }),
    [send],
  );

  const remoteNodeMoves = useMemo(() => {
    const moves: Record<string, RemoteNodeMove> = {};
    for (const participant of Object.values(participants)) {
      if (!participant.nodeMove) continue;
      moves[participant.nodeMove.nodeId] = {
        x: participant.nodeMove.x,
        y: participant.nodeMove.y,
        color: participant.color,
        name: participant.name,
      };
    }
    return moves;
  }, [participants]);

  const others = useMemo(
    () => Object.values(participants).filter((participant) => participant.id !== selfId),
    [participants, selfId],
  );

  return {
    status,
    selfId,
    participants: Object.values(participants),
    others,
    remoteNodeMoves,
    sendCursor,
    sendSelection,
    sendNodeMove,
    sendNodeMoveEnd,
  };
}
