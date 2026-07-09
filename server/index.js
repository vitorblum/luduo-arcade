"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const TICK_MS = 1000 / 30;
const STALE_SWEEP_MS = 3000;
const CLIENT_TIMEOUT_MS = 12000;
const PADDLE_WIDTH = 0.27;
const PADDLE_Y_BOTTOM = 0.92;
const PADDLE_Y_TOP = 0.08;
const BALL_RADIUS = 0.022;
const BASE_SPEED = 0.42;
const SPEED_STEP = 0.1;
const DUOJUMP_PLAYER_RADIUS = 0.035;
const DUOJUMP_PLATFORM_WIDTH = 0.22;
const DUOJUMP_PLATFORM_HEIGHT = 0.018;
const DUOJUMP_PLATFORM_COUNT = 9;
const DUOJUMP_BASE_PLATFORM_SPACING = 0.118;
const DUOJUMP_MAX_PLATFORM_SPACING = 0.146;
const DUOJUMP_GRAVITY = 2.35;
const DUOJUMP_JUMP_SPEED = 0.86;
const DUOJUMP_MOVE_SPEED = 0.72;
const DUOJUMP_BASE_SCROLL = 0.17;
const DUOJUMP_SCROLL_STEP = 0.05;

const clients = new Set();
const names = new Map();
const rooms = new Map();

const gameTitles = {
  duopong: "DuoPong",
  duojump: "DuoJump"
};

let nextClientId = 1;
let nextRoomId = 1;
let nextBotId = 1;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18)
    .toLowerCase();
}

function displayName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18);
}

function normalizeDeviceId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 64);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function send(client, message) {
  if (!client || client.isBot) return;
  if (!client.socket || client.socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(message));
  let header;

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  client.socket.write(Buffer.concat([header, payload]));
}

function sendError(client, code, message) {
  send(client, { type: "error", code, message });
}

function broadcastPlayers() {
  const players = Array.from(names.values())
    .map((client) => ({
      name: client.name,
      busy: Boolean(client.roomId)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const client of clients) {
    if (client.name) send(client, { type: "players", players });
  }
}

function safeStaticPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requestedPath = cleanPath === "/" ? "/index.html" : cleanPath;
  const absolutePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!absolutePath.startsWith(PUBLIC_DIR)) return null;
  return absolutePath;
}

function serveStatic(req, res) {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, app: "luduo-arcade" }));
    return;
  }

  const filePath = safeStaticPath(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackErr, fallback) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(filePath);
    const shouldRevalidate = [".html", ".js", ".css", ".webmanifest"].includes(ext);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": shouldRevalidate ? "no-cache" : "public, max-age=86400"
    });
    res.end(data);
  });
}

function makeWsAccept(key) {
  return crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

function parseFrames(client, data) {
  client.buffer = client.buffer.length ? Buffer.concat([client.buffer, data]) : data;

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) return;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) return;
      const bigLength = client.buffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(1024 * 1024)) {
        closeClient(client);
        return;
      }
      length = Number(bigLength);
      offset += 8;
    }

    let mask;
    if (masked) {
      if (client.buffer.length < offset + 4) return;
      mask = client.buffer.slice(offset, offset + 4);
      offset += 4;
    }

    if (client.buffer.length < offset + length) return;

    let payload = client.buffer.slice(offset, offset + length);
    client.buffer = client.buffer.slice(offset + length);

    if (masked) {
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i += 1) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    if (opcode === 0x8) {
      closeClient(client);
      return;
    }

    if (opcode === 0x9) {
      client.socket.write(Buffer.from([0x8a, 0x00]));
      continue;
    }

    if (opcode !== 0x1) continue;

    try {
      const message = JSON.parse(payload.toString("utf8"));
      handleMessage(client, message);
    } catch (err) {
      sendError(client, "bad-message", "Mensagem invalida.");
    }
  }
}

function closeClient(client) {
  if (client.closed) return;
  client.closed = true;

  clients.delete(client);

  if (client.nameKey) {
    names.delete(client.nameKey);
  }

  if (client.roomId) {
    leaveRoom(client, true);
  }

  for (const other of clients) {
    if (other.invites) other.invites.delete(client.nameKey);
  }

  try {
    client.socket.end();
  } catch (err) {
    // Socket may already be closed.
  }

  broadcastPlayers();
}

function handleMessage(client, message) {
  const type = String(message.type || "");
  client.lastSeen = Date.now();

  if (type === "goodbye") {
    closeClient(client);
    return;
  }

  if (type === "pong" || type === "ping") {
    send(client, { type: "pong", now: Date.now() });
    return;
  }

  if (type === "hello") {
    handleHello(client, message);
    return;
  }

  if (!client.name) {
    sendError(client, "not-logged", "Escolha um nome antes de continuar.");
    return;
  }

  if (type === "challenge") {
    handleChallenge(client, message);
  } else if (type === "bot-match") {
    handleBotMatch(client, message);
  } else if (type === "accept") {
    handleAccept(client, message);
  } else if (type === "decline") {
    handleDecline(client, message);
  } else if (type === "paddle") {
    handlePaddle(client, message);
  } else if (type === "move") {
    handleMove(client, message);
  } else if (type === "leave-room") {
    leaveRoom(client, false);
  } else {
    sendError(client, "unknown-type", "Comando desconhecido.");
  }
}

function handleHello(client, message) {
  if (client.name) {
    sendError(client, "already-logged", "Voce ja escolheu um nome.");
    return;
  }

  const rawName = displayName(message.name);
  const key = normalizeName(rawName);
  const deviceId = normalizeDeviceId(message.deviceId);

  if (!key || rawName.length < 2) {
    sendError(client, "invalid-name", "Use um nome com pelo menos 2 letras.");
    return;
  }

  if (!/^[a-z0-9 _.-]+$/i.test(rawName)) {
    sendError(client, "invalid-name", "Use letras, numeros, espaco, ponto, traco ou underline.");
    return;
  }

  const existing = names.get(key);
  if (existing && (!deviceId || existing.deviceId !== deviceId)) {
    sendError(client, "name-taken", "Esse nome ja esta em uso.");
    return;
  }

  if (existing && existing !== client) {
    closeClient(existing);
  }

  client.name = rawName;
  client.nameKey = key;
  client.deviceId = deviceId;
  client.invites = new Map();
  names.set(key, client);

  send(client, {
    type: "hello-ok",
    id: client.id,
    name: client.name,
    app: "Luduo Arcade"
  });
  broadcastPlayers();
}

function handleChallenge(client, message) {
  const targetKey = normalizeName(message.target);
  const game = String(message.game || "duopong");
  const target = names.get(targetKey);

  if (!gameTitles[game]) {
    sendError(client, "game-unavailable", "Esse minijogo ainda nao esta disponivel.");
    return;
  }

  if (!target) {
    sendError(client, "not-found", "Jogador nao encontrado.");
    return;
  }

  if (target === client) {
    sendError(client, "self-challenge", "Escolha outro jogador.");
    return;
  }

  if (client.roomId || target.roomId) {
    sendError(client, "busy", "Um dos jogadores ja esta em uma partida.");
    return;
  }

  target.invites.set(client.nameKey, {
    from: client.name,
    game,
    createdAt: Date.now()
  });

  send(target, { type: "invite", from: client.name, game });
  send(client, { type: "invite-sent", to: target.name, game });
}

function createBotPlayer(game) {
  return {
    id: `bot-${nextBotId++}`,
    name: game === "duojump" ? "Maquina Jump" : "Maquina Pong",
    isBot: true,
    roomId: null
  };
}

function handleBotMatch(client, message) {
  const game = String(message.game || "duopong");

  if (!gameTitles[game]) {
    sendError(client, "game-unavailable", "Esse minijogo ainda nao esta disponivel.");
    return;
  }

  if (client.roomId) {
    sendError(client, "busy", "Voce ja esta em uma partida.");
    return;
  }

  createRoom(client, createBotPlayer(game), game);
}

function handleAccept(client, message) {
  const fromKey = normalizeName(message.from);
  const invite = client.invites.get(fromKey);
  const challenger = names.get(fromKey);

  if (!invite || !challenger) {
    sendError(client, "invite-missing", "Convite nao encontrado.");
    return;
  }

  if (client.roomId || challenger.roomId) {
    sendError(client, "busy", "Um dos jogadores ja esta em uma partida.");
    return;
  }

  client.invites.delete(fromKey);
  createRoom(challenger, client, invite.game);
}

function handleDecline(client, message) {
  const fromKey = normalizeName(message.from);
  const invite = client.invites.get(fromKey);
  const challenger = names.get(fromKey);

  if (invite) client.invites.delete(fromKey);
  if (challenger) {
    send(challenger, { type: "invite-declined", by: client.name });
  }
}

function handlePaddle(client, message) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  if (!room || room.game !== "duopong") return;

  room.paddles[client.id] = clamp(Number(message.x || 0.5), PADDLE_WIDTH / 2, 1 - PADDLE_WIDTH / 2);
}

function handleMove(client, message) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  if (!room || room.game !== "duojump" || !room.runners[client.id]) return;

  room.runners[client.id].direction = clamp(Number(message.direction || 0), -1, 1);
}

function createRoom(playerA, playerB, game) {
  if (game === "duojump") {
    createDuoJumpRoom(playerA, playerB);
    return;
  }

  createDuoPongRoom(playerA, playerB);
}

function createDuoPongRoom(playerA, playerB) {
  const roomId = `room-${nextRoomId++}`;
  const now = Date.now();
  const room = {
    id: roomId,
    game: "duopong",
    players: [playerA, playerB],
    paddles: {
      [playerA.id]: 0.5,
      [playerB.id]: 0.5
    },
    scores: {
      [playerA.id]: 0,
      [playerB.id]: 0
    },
    ball: {
      x: 0.5,
      y: 0.5,
      vx: Math.random() > 0.5 ? 0.22 : -0.22,
      vy: Math.random() > 0.5 ? BASE_SPEED : -BASE_SPEED
    },
    rallyStartedAt: now + 1200,
    pausedUntil: now + 1200,
    lastTick: now,
    lastScoredBy: null
  };

  rooms.set(roomId, room);
  playerA.roomId = roomId;
  playerB.roomId = roomId;

  send(playerA, { type: "room-start", roomId, game: "duopong", opponent: playerB.name });
  send(playerB, { type: "room-start", roomId, game: "duopong", opponent: playerA.name });
  broadcastPlayers();
}

function createDuoJumpRoom(playerA, playerB) {
  const roomId = `room-${nextRoomId++}`;
  const now = Date.now();
  const room = {
    id: roomId,
    game: "duojump",
    players: [playerA, playerB],
    scores: {
      [playerA.id]: 0,
      [playerB.id]: 0
    },
    runners: {
      [playerA.id]: createDuoJumpRunner(0.38, "#24d6ff"),
      [playerB.id]: createDuoJumpRunner(0.62, "#ff4f91")
    },
    platforms: createDuoJumpPlatforms(),
    runStartedAt: now + 1200,
    pausedUntil: now + 1200,
    lastTick: now,
    lastScoredBy: null
  };

  rooms.set(roomId, room);
  playerA.roomId = roomId;
  playerB.roomId = roomId;

  send(playerA, { type: "room-start", roomId, game: "duojump", opponent: playerB.name });
  send(playerB, { type: "room-start", roomId, game: "duojump", opponent: playerA.name });
  broadcastPlayers();
}

function createDuoJumpRunner(x, color) {
  return {
    x,
    y: 0.68,
    vy: -DUOJUMP_JUMP_SPEED,
    direction: 0,
    color
  };
}

function nextDuoJumpPlatformX(previousX) {
  const minX = 0.14;
  const maxX = 0.86;
  const spacing = DUOJUMP_BASE_PLATFORM_SPACING;
  const maxStep = duoJumpMaxPlatformStep(spacing, DUOJUMP_BASE_SCROLL, 0.35);
  const minStep = maxStep * 0.48;
  const distance = minStep + Math.random() * (maxStep - minStep);
  const step = (Math.random() > 0.5 ? 1 : -1) * distance;
  let x = previousX + step;

  if (x < minX) x = minX + (minX - x);
  if (x > maxX) x = maxX - (x - maxX);
  return clamp(x, minX, maxX);
}

function duoJumpDifficulty(room, now) {
  return Math.min(1, (duoJumpSpeedLevel(room, now) - 1) / 8);
}

function duoJumpPlatformSpacing(room, now) {
  return DUOJUMP_BASE_PLATFORM_SPACING + (DUOJUMP_MAX_PLATFORM_SPACING - DUOJUMP_BASE_PLATFORM_SPACING) * duoJumpDifficulty(room, now);
}

function duoJumpFlightTimeForSpacing(spacing, scrollSpeed) {
  const upwardSpeed = DUOJUMP_JUMP_SPEED + scrollSpeed;
  const discriminant = upwardSpeed * upwardSpeed - 2 * DUOJUMP_GRAVITY * spacing;

  if (discriminant <= 0) return 0;
  return (upwardSpeed + Math.sqrt(discriminant)) / DUOJUMP_GRAVITY;
}

function duoJumpMaxPlatformStep(spacing, scrollSpeed, difficulty) {
  const flightTime = duoJumpFlightTimeForSpacing(spacing, scrollSpeed);
  const reach = DUOJUMP_MOVE_SPEED * flightTime + DUOJUMP_PLATFORM_WIDTH / 2 + DUOJUMP_PLAYER_RADIUS * 0.65;
  return clamp(reach * (0.46 + difficulty * 0.18), 0.28, 0.44);
}

function nextDuoJumpPlatformXForRoom(room, now, previousX, spacing) {
  const minX = 0.12;
  const maxX = 0.88;
  const difficulty = duoJumpDifficulty(room, now);
  const maxStep = duoJumpMaxPlatformStep(spacing, duoJumpScrollSpeed(room, now), difficulty);
  const minStep = maxStep * (0.55 + difficulty * 0.15);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const distance = minStep + Math.random() * (maxStep - minStep);
    const x = previousX + (Math.random() > 0.5 ? distance : -distance);

    if (x >= minX && x <= maxX) return x;
  }

  const fallback = previousX + (previousX < 0.5 ? maxStep : -maxStep);
  return clamp(fallback, minX, maxX);
}

function wrappedDistance(a, b) {
  const normalize = (value) => {
    const wrapped = value % 1;
    return wrapped < 0 ? wrapped + 1 : wrapped;
  };
  const diff = Math.abs(normalize(a) - normalize(b));
  return Math.min(diff, 1 - diff);
}

function createDuoJumpPlatforms() {
  const platforms = [];
  let x = 0.5;
  const bottomY = 0.72;

  for (let i = 0; i < DUOJUMP_PLATFORM_COUNT; i += 1) {
    const indexFromBottom = DUOJUMP_PLATFORM_COUNT - 1 - i;
    const y = bottomY - indexFromBottom * DUOJUMP_BASE_PLATFORM_SPACING;

    if (i > 0) x = nextDuoJumpPlatformX(x);
    platforms.unshift({
      x,
      y,
      w: DUOJUMP_PLATFORM_WIDTH
    });
  }

  return platforms;
}

function leaveRoom(client, disconnected) {
  const room = rooms.get(client.roomId);
  client.roomId = null;

  if (!room) {
    broadcastPlayers();
    return;
  }

  for (const player of room.players) {
    if (player !== client) {
      player.roomId = null;
      send(player, {
        type: "opponent-left",
        message: disconnected ? "O outro jogador saiu." : `${client.name} saiu da partida.`
      });
    }
  }

  rooms.delete(room.id);
  broadcastPlayers();
}

function speedLevel(room, now) {
  if (now < room.rallyStartedAt) return 1;
  return Math.floor((now - room.rallyStartedAt) / 5000) + 1;
}

function currentSpeed(room, now) {
  return BASE_SPEED + (speedLevel(room, now) - 1) * SPEED_STEP;
}

function resetBall(room, scorer, now) {
  room.lastScoredBy = scorer.id;
  room.pausedUntil = now + 1300;
  room.rallyStartedAt = room.pausedUntil;
  room.ball.x = 0.5;
  room.ball.y = 0.5;
  room.ball.vx = Math.random() > 0.5 ? 0.24 : -0.24;

  const loser = room.players.find((player) => player !== scorer);
  const loserIsTop = loser === room.players[1];
  room.ball.vy = loserIsTop ? -BASE_SPEED : BASE_SPEED;
}

function signedWrappedDelta(from, to) {
  let delta = to - from;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function moveToward(current, target, amount) {
  const delta = target - current;
  if (Math.abs(delta) <= amount) return target;
  return current + Math.sign(delta) * amount;
}

function updateDuoPongBots(room, dt) {
  const botSpeed = 2.8;

  for (const player of room.players) {
    if (!player.isBot) continue;

    const predictedX = clamp(room.ball.x + room.ball.vx * 0.18, PADDLE_WIDTH / 2, 1 - PADDLE_WIDTH / 2);
    const current = room.paddles[player.id] || 0.5;
    room.paddles[player.id] = clamp(
      moveToward(current, predictedX, botSpeed * dt),
      PADDLE_WIDTH / 2,
      1 - PADDLE_WIDTH / 2
    );
  }
}

function bounceDuoPongBall(ball, paddleX, y, verticalDirection, targetSpeed) {
  const offset = clamp((ball.x - paddleX) / (PADDLE_WIDTH / 2), -1, 1);
  const edgePush = Math.sign(offset) * Math.pow(Math.abs(offset), 1.12) * targetSpeed * 0.88;
  const carry = ball.vx * 0.74;
  const lateralLimit = targetSpeed * 0.9;

  ball.y = y;
  ball.vx = clamp(carry + edgePush, -lateralLimit, lateralLimit);
  ball.vy = verticalDirection * Math.sqrt(Math.max(targetSpeed * targetSpeed - ball.vx * ball.vx, targetSpeed * targetSpeed * 0.16));
}

function duoPongContactX(ball, previousX, previousY, contactY) {
  const movementY = ball.y - previousY;
  if (movementY === 0) return ball.x;

  const progress = clamp((contactY - previousY) / movementY, 0, 1);
  return previousX + (ball.x - previousX) * progress;
}

function tickDuoPong(room, now) {
  const dt = Math.min(0.05, (now - room.lastTick) / 1000);
  room.lastTick = now;
  updateDuoPongBots(room, dt);

  if (now < room.pausedUntil) return;

  const ball = room.ball;
  const targetSpeed = currentSpeed(room, now);
  const direction = Math.sign(ball.vy) || 1;
  const lateral = clamp(ball.vx, -targetSpeed * 0.8, targetSpeed * 0.8);
  ball.vx = lateral;
  ball.vy = direction * Math.sqrt(Math.max(targetSpeed * targetSpeed - lateral * lateral, 0.01));

  const previousX = ball.x;
  const previousY = ball.y;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x - BALL_RADIUS <= 0) {
    ball.x = BALL_RADIUS;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x + BALL_RADIUS >= 1) {
    ball.x = 1 - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx);
  }

  const bottomPlayer = room.players[0];
  const topPlayer = room.players[1];
  const bottomPaddle = room.paddles[bottomPlayer.id];
  const topPaddle = room.paddles[topPlayer.id];

  if (ball.vy > 0 && ball.y + BALL_RADIUS >= PADDLE_Y_BOTTOM) {
    const contactY = PADDLE_Y_BOTTOM - BALL_RADIUS;
    const contactX = duoPongContactX(ball, previousX, previousY, contactY);
    if (Math.abs(contactX - bottomPaddle) <= PADDLE_WIDTH / 2 + BALL_RADIUS * 0.35) {
      ball.x = contactX;
      bounceDuoPongBall(ball, bottomPaddle, PADDLE_Y_BOTTOM - BALL_RADIUS, -1, targetSpeed);
    } else if (ball.y > 1 + BALL_RADIUS) {
      room.scores[topPlayer.id] += 1;
      resetBall(room, topPlayer, now);
    }
  }

  if (ball.vy < 0 && ball.y - BALL_RADIUS <= PADDLE_Y_TOP) {
    const contactY = PADDLE_Y_TOP + BALL_RADIUS;
    const contactX = duoPongContactX(ball, previousX, previousY, contactY);
    if (Math.abs(contactX - topPaddle) <= PADDLE_WIDTH / 2 + BALL_RADIUS * 0.35) {
      ball.x = contactX;
      bounceDuoPongBall(ball, topPaddle, PADDLE_Y_TOP + BALL_RADIUS, 1, targetSpeed);
    } else if (ball.y < -BALL_RADIUS) {
      room.scores[bottomPlayer.id] += 1;
      resetBall(room, bottomPlayer, now);
    }
  }
}

function duoJumpSpeedLevel(room, now) {
  if (now < room.runStartedAt) return 1;
  return Math.floor((now - room.runStartedAt) / 15000) + 1;
}

function duoJumpScrollSpeed(room, now) {
  return DUOJUMP_BASE_SCROLL + (duoJumpSpeedLevel(room, now) - 1) * DUOJUMP_SCROLL_STEP;
}

function findDuoJumpRespawnPlatform(room) {
  const candidates = room.platforms
    .filter((platform) => platform.y > 0.52 && platform.y < 0.86)
    .sort((a, b) => b.y - a.y);
  return candidates[0] || room.platforms[room.platforms.length - 1] || { x: 0.5, y: 0.72, w: DUOJUMP_PLATFORM_WIDTH };
}

function respawnDuoJumpRunner(room, player) {
  const runner = room.runners[player.id];
  const platform = findDuoJumpRespawnPlatform(room);

  runner.x = platform.x;
  runner.y = platform.y - DUOJUMP_PLAYER_RADIUS;
  runner.vy = -DUOJUMP_JUMP_SPEED;
  runner.direction = 0;
}

function scoreDuoJumpFall(room, fallenPlayer, now) {
  const scorer = room.players.find((candidate) => candidate !== fallenPlayer);
  if (!scorer) return;

  room.lastScoredBy = scorer.id;
  room.scores[scorer.id] += 1;
  room.lastScoreAt = now;
  respawnDuoJumpRunner(room, fallenPlayer);
}

function refillDuoJumpPlatforms(room, now) {
  room.platforms = room.platforms.filter((platform) => platform.y < 1.08);

  while (room.platforms.length < DUOJUMP_PLATFORM_COUNT) {
    const spacing = duoJumpPlatformSpacing(room, now);
    const topPlatform = room.platforms.reduce(
      (top, platform) => (platform.y < top.y ? platform : top),
      room.platforms[0] || { x: 0.5, y: 0.22 }
    );
    room.platforms.push({
      x: nextDuoJumpPlatformXForRoom(room, now, topPlatform.x, spacing),
      y: Math.min(topPlatform.y - spacing, -0.06),
      w: DUOJUMP_PLATFORM_WIDTH
    });
  }
}

function findDuoJumpBotTarget(room, runner) {
  const candidates = room.platforms
    .filter((platform) => platform.y > runner.y + DUOJUMP_PLAYER_RADIUS && platform.y < 1)
    .sort((a, b) => a.y - b.y);
  return candidates[0] || findDuoJumpRespawnPlatform(room);
}

function updateDuoJumpBots(room) {
  for (const player of room.players) {
    if (!player.isBot) continue;

    const runner = room.runners[player.id];
    const target = findDuoJumpBotTarget(room, runner);
    const delta = signedWrappedDelta(runner.x, target.x);
    runner.direction = Math.abs(delta) < 0.02 ? 0 : clamp(delta / 0.16, -1, 1);
  }
}

function tickDuoJump(room, now) {
  const dt = Math.min(0.05, (now - room.lastTick) / 1000);
  room.lastTick = now;

  if (now < room.pausedUntil) return;

  const scroll = duoJumpScrollSpeed(room, now);
  for (const platform of room.platforms) {
    platform.y += scroll * dt;
  }
  refillDuoJumpPlatforms(room, now);
  updateDuoJumpBots(room);

  for (const player of room.players) {
    const runner = room.runners[player.id];
    const previousY = runner.y;

    runner.x += runner.direction * DUOJUMP_MOVE_SPEED * dt;
    if (runner.x < -DUOJUMP_PLAYER_RADIUS) runner.x = 1 + DUOJUMP_PLAYER_RADIUS;
    if (runner.x > 1 + DUOJUMP_PLAYER_RADIUS) runner.x = -DUOJUMP_PLAYER_RADIUS;

    runner.vy += DUOJUMP_GRAVITY * dt;
    runner.y += runner.vy * dt;

    if (runner.y < DUOJUMP_PLAYER_RADIUS) {
      runner.y = DUOJUMP_PLAYER_RADIUS;
      runner.vy = Math.max(0, runner.vy);
    }

    if (runner.vy > 0) {
      const previousBottom = previousY + DUOJUMP_PLAYER_RADIUS;
      const currentBottom = runner.y + DUOJUMP_PLAYER_RADIUS;

      for (const platform of room.platforms) {
        const isCrossing = previousBottom <= platform.y && currentBottom >= platform.y;
        const isInside = wrappedDistance(runner.x, platform.x) <= platform.w / 2 + DUOJUMP_PLAYER_RADIUS * 0.8;

        if (isCrossing && isInside) {
          runner.y = platform.y - DUOJUMP_PLAYER_RADIUS;
          runner.vy = -DUOJUMP_JUMP_SPEED;
          break;
        }
      }
    }

    if (runner.y - DUOJUMP_PLAYER_RADIUS > 1.08) {
      scoreDuoJumpFall(room, player, now);
    }
  }
}

function stateForDuoPong(room, viewer, now) {
  const opponent = room.players.find((player) => player !== viewer);
  const viewerIsBottom = viewer === room.players[0];
  const ball = room.ball;

  return {
    type: "game-state",
    game: "duopong",
    roomId: room.id,
    you: viewer.name,
    opponent: opponent.name,
    sentAt: now,
    ball: {
      x: ball.x,
      y: viewerIsBottom ? ball.y : 1 - ball.y,
      vx: ball.vx,
      vy: viewerIsBottom ? ball.vy : -ball.vy
    },
    paddles: {
      you: room.paddles[viewer.id],
      opponent: room.paddles[opponent.id]
    },
    scores: {
      you: room.scores[viewer.id],
      opponent: room.scores[opponent.id]
    },
    speed: speedLevel(room, now),
    pausedMs: Math.max(0, room.pausedUntil - now),
    lastScoredBy:
      room.lastScoredBy === viewer.id
        ? "you"
        : room.lastScoredBy === opponent.id
          ? "opponent"
          : null
  };
}

function stateForDuoJump(room, viewer, now) {
  const opponent = room.players.find((player) => player !== viewer);
  const you = room.runners[viewer.id];
  const rival = room.runners[opponent.id];

  return {
    type: "game-state",
    game: "duojump",
    roomId: room.id,
    you: viewer.name,
    opponent: opponent.name,
    sentAt: now,
    runners: {
      you: {
        x: you.x,
        y: you.y,
        vy: you.vy,
        direction: you.direction,
        color: you.color
      },
      opponent: {
        x: rival.x,
        y: rival.y,
        vy: rival.vy,
        direction: rival.direction,
        color: rival.color
      }
    },
    platforms: room.platforms.map((platform) => ({
      x: platform.x,
      y: platform.y,
      w: platform.w,
      h: DUOJUMP_PLATFORM_HEIGHT
    })),
    scores: {
      you: room.scores[viewer.id],
      opponent: room.scores[opponent.id]
    },
    speed: duoJumpSpeedLevel(room, now),
    pausedMs: Math.max(0, room.pausedUntil - now),
    lastScoredBy:
      room.lastScoredBy === viewer.id
        ? "you"
        : room.lastScoredBy === opponent.id
          ? "opponent"
          : null
  };
}

function gameLoop() {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (room.game === "duopong") {
      tickDuoPong(room, now);
    } else if (room.game === "duojump") {
      tickDuoJump(room, now);
    } else {
      continue;
    }

    for (const player of room.players) {
      send(player, room.game === "duojump" ? stateForDuoJump(room, player, now) : stateForDuoPong(room, player, now));
    }
  }
}

function sweepStaleClients() {
  const now = Date.now();

  for (const client of Array.from(clients)) {
    if (client.closed) continue;
    if (now - client.lastSeen > CLIENT_TIMEOUT_MS) {
      closeClient(client);
    }
  }
}

const server = http.createServer(serveStatic);

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];

  if (!key) {
    socket.destroy();
    return;
  }

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${makeWsAccept(key)}`,
      "",
      ""
    ].join("\r\n")
  );

  const client = {
    id: `p${nextClientId++}`,
    socket,
    buffer: Buffer.alloc(0),
    name: "",
    nameKey: "",
    deviceId: "",
    roomId: null,
    invites: new Map(),
    lastSeen: Date.now(),
    closed: false
  };

  clients.add(client);
  socket.setKeepAlive(true, 5000);
  socket.on("data", (data) => parseFrames(client, data));
  socket.on("close", () => closeClient(client));
  socket.on("error", () => closeClient(client));
});

setInterval(gameLoop, TICK_MS);
setInterval(sweepStaleClients, STALE_SWEEP_MS);

server.listen(PORT, () => {
  console.log(`Luduo Arcade online em http://localhost:${PORT}`);
});
