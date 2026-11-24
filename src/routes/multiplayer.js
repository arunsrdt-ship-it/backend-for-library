import { randomUUID } from 'node:crypto';
import { Router } from 'express';

const router = Router();
const MAX_PLAYERS = 64;
const PLAYER_TIMEOUT_MS = 45_000;
const players = new Map();
const streams = new Map();
const chatHistory = [];

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    zone: player.zone,
    pose: player.pose,
  };
}

function sendEvent(response, type, data) {
  if (response.destroyed || response.writableEnded) return false;
  try {
    response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function broadcast(type, data, exceptId = null) {
  for (const [id, playerStreams] of streams) {
    if (id === exceptId) continue;
    for (const response of playerStreams) {
      if (!sendEvent(response, type, data)) playerStreams.delete(response);
    }
    if (!playerStreams.size) streams.delete(id);
  }
}

function broadcastPresence() {
  broadcast('presence', [...players.values()].map(publicPlayer));
}

function parsePlayerId(value) {
  return typeof value === 'string' && /^[\w-]{12,64}$/.test(value) ? value : null;
}

function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24) || 'Reader';
}

function normalizePose(zone, value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const z = Number(value.z);
  const yaw = Number(value.yaw);
  const pitch = Number(value.pitch ?? 0);
  if (![x, z, yaw, pitch].every(Number.isFinite)) return null;
  const limit = zone === 'town' ? 44 : 8;
  return {
    x: Math.round(Math.max(-limit, Math.min(limit, x)) * 100) / 100,
    z: Math.round(Math.max(-limit, Math.min(limit, z)) * 100) / 100,
    yaw: Math.max(-Math.PI * 4, Math.min(Math.PI * 4, yaw)),
    pitch: Math.max(-1, Math.min(1, pitch)),
    moving: Boolean(value.moving),
  };
}

router.post('/join', (request, response) => {
  const id = parsePlayerId(request.body?.id);
  if (!id) return response.status(400).json({ error: 'A valid guest id is required.' });

  const existing = players.get(id);
  if (!existing && players.size >= MAX_PLAYERS) {
    return response.status(429).json({ error: 'The Athenaeum room is full right now.' });
  }

  const player = existing ?? {
    id,
    zone: 'library',
    pose: { x: 0, z: 0, yaw: 0, pitch: 0 },
  };
  player.name = cleanName(request.body?.name);
  player.lastSeen = Date.now();
  players.set(id, player);
  broadcastPresence();
  return response.json({ id, room: 'grand-athenaeum', players: [...players.values()].map(publicPlayer), messages: chatHistory });
});

router.get('/stream', (request, response) => {
  const id = parsePlayerId(request.query.id);
  const player = id && players.get(id);
  if (!player) return response.status(401).end();

  response.status(200);
  response.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();

  const playerStreams = streams.get(id) ?? new Set();
  playerStreams.add(response);
  streams.set(id, playerStreams);
  sendEvent(response, 'snapshot', {
    players: [...players.values()].map(publicPlayer),
    messages: chatHistory,
  });

  const heartbeat = setInterval(() => {
    if (response.destroyed || response.writableEnded) clearInterval(heartbeat);
    else response.write(': keep-alive\n\n');
  }, 20_000);
  heartbeat.unref?.();

  response.on('close', () => {
    clearInterval(heartbeat);
    const activeStreams = streams.get(id);
    activeStreams?.delete(response);
    if (activeStreams && !activeStreams.size) streams.delete(id);
  });
});

router.post('/state', (request, response) => {
  const id = parsePlayerId(request.body?.id);
  const player = id && players.get(id);
  const zone = request.body?.zone === 'town' ? 'town' : request.body?.zone === 'library' ? 'library' : null;
  const pose = zone && normalizePose(zone, request.body?.pose);
  if (!player || !zone || !pose) return response.status(400).json({ error: 'The player position is invalid.' });

  player.zone = zone;
  player.pose = pose;
  player.lastSeen = Date.now();
  broadcast('pose', publicPlayer(player), id);
  return response.status(204).end();
});

router.post('/chat', (request, response) => {
  const id = parsePlayerId(request.body?.id);
  const player = id && players.get(id);
  const text = String(request.body?.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180);
  if (!player || !text) return response.status(400).json({ error: 'Enter a message before sending.' });
  const now = Date.now();
  if (now - (player.lastChatAt ?? 0) < 350) return response.status(429).json({ error: 'Please wait a moment before sending another message.' });
  player.lastChatAt = now;
  player.lastSeen = now;
  const message = { id: randomUUID(), playerId: id, name: player.name, text, at: now };
  chatHistory.push(message);
  if (chatHistory.length > 40) chatHistory.shift();
  broadcast('chat', message);
  return response.status(204).end();
});

router.post('/action', (request, response) => {
  const id = parsePlayerId(request.body?.id);
  const player = id && players.get(id);
  const target = players.get(parsePlayerId(request.body?.targetId));
  if (!player || !target || target.zone !== player.zone || request.body?.action !== 'wave') {
    return response.status(400).json({ error: 'That player interaction is unavailable.' });
  }
  const now = Date.now();
  if (now - (player.lastActionAt ?? 0) < 700) return response.status(429).json({ error: 'Please wait before waving again.' });
  player.lastActionAt = now;
  player.lastSeen = now;
  broadcast('action', {
    id: randomUUID(),
    fromId: player.id,
    fromName: player.name,
    zone: player.zone,
    toId: target.id,
    toName: target.name,
    action: 'wave',
    at: now,
  });
  return response.status(204).end();
});

router.post('/leave', (request, response) => {
  const id = parsePlayerId(request.body?.id);
  if (id && players.delete(id)) {
    for (const playerStream of streams.get(id) ?? []) playerStream.end();
    streams.delete(id);
    broadcastPresence();
  }
  return response.status(204).end();
});

const cleanupTimer = setInterval(() => {
  let changed = false;
  const expiry = Date.now() - PLAYER_TIMEOUT_MS;
  for (const [id, player] of players) {
    if (player.lastSeen >= expiry) continue;
    players.delete(id);
    for (const playerStream of streams.get(id) ?? []) playerStream.end();
    streams.delete(id);
    changed = true;
  }
  if (changed) broadcastPresence();
}, 10_000);
cleanupTimer.unref?.();

export default router;
