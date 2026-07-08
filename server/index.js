"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const TICK_MS = 1000 / 30;
const STATE_SEND_MS = 1000 / 20;
const PADDLE_WIDTH = 0.27;
const PADDLE_Y_BOTTOM = 0.92;
const PADDLE_Y_TOP = 0.08;
const BALL_RADIUS = 0.022;
const BASE_SPEED = 0.42;
const SPEED_STEP = 0.1;

const clients = new Set();
const names = new Map();
const rooms = new Map();

let nextClientId = 1;
let nextRoomId = 1;

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function send(client, message) {
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
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400"
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
  } else if (type === "accept") {
    handleAccept(client, message);
  } else if (type === "decline") {
    handleDecline(client, message);
  } else if (type === "paddle") {
    handlePaddle(client, message);
  } else if (type === "leave-room") {
    leaveRoom(client, false);
  } else if (type === "pong" || type === "ping") {
    send(client, { type: "pong", now: Date.now() });
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

  if (!key || rawName.length < 2) {
    sendError(client, "invalid-name", "Use um nome com pelo menos 2 letras.");
    return;
  }

  if (!/^[a-z0-9 _.-]+$/i.test(rawName)) {
    sendError(client, "invalid-name", "Use letras, numeros, espaco, ponto, traco ou underline.");
    return;
  }

  if (names.has(key)) {
    sendError(client, "name-taken", "Esse nome ja esta em uso.");
    return;
  }

  client.name = rawName;
  client.nameKey = key;
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

  if (game !== "duopong") {
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
  createDuoPongRoom(challenger, client);
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
    lastStateSent: 0,
    lastScoredBy: null
  };

  rooms.set(roomId, room);
  playerA.roomId = roomId;
  playerB.roomId = roomId;

  send(playerA, { type: "room-start", roomId, game: "duopong", opponent: playerB.name });
  send(playerB, { type: "room-start", roomId, game: "duopong", opponent: playerA.name });
  broadcastPlayers();
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

function tickDuoPong(room, now) {
  const dt = Math.min(0.05, (now - room.lastTick) / 1000);
  room.lastTick = now;

  if (now < room.pausedUntil) return;

  const ball = room.ball;
  const targetSpeed = currentSpeed(room, now);
  const direction = Math.sign(ball.vy) || 1;
  const lateral = clamp(ball.vx, -targetSpeed * 0.8, targetSpeed * 0.8);
  ball.vx = lateral;
  ball.vy = direction * Math.sqrt(Math.max(targetSpeed * targetSpeed - lateral * lateral, 0.01));

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
    if (Math.abs(ball.x - bottomPaddle) <= PADDLE_WIDTH / 2) {
      const offset = (ball.x - bottomPaddle) / (PADDLE_WIDTH / 2);
      ball.y = PADDLE_Y_BOTTOM - BALL_RADIUS;
      ball.vy = -Math.abs(ball.vy);
      ball.vx += offset * 0.18;
    } else if (ball.y > 1 + BALL_RADIUS) {
      room.scores[topPlayer.id] += 1;
      resetBall(room, topPlayer, now);
    }
  }

  if (ball.vy < 0 && ball.y - BALL_RADIUS <= PADDLE_Y_TOP) {
    if (Math.abs(ball.x - topPaddle) <= PADDLE_WIDTH / 2) {
      const offset = (ball.x - topPaddle) / (PADDLE_WIDTH / 2);
      ball.y = PADDLE_Y_TOP + BALL_RADIUS;
      ball.vy = Math.abs(ball.vy);
      ball.vx += offset * 0.18;
    } else if (ball.y < -BALL_RADIUS) {
      room.scores[bottomPlayer.id] += 1;
      resetBall(room, bottomPlayer, now);
    }
  }
}

function stateFor(room, viewer, now) {
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

function gameLoop() {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (room.game !== "duopong") continue;
    tickDuoPong(room, now);

    if (now - room.lastStateSent < STATE_SEND_MS) continue;
    room.lastStateSent = now;

    for (const player of room.players) {
      send(player, stateFor(room, player, now));
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
    roomId: null,
    invites: new Map(),
    closed: false
  };

  clients.add(client);
  socket.on("data", (data) => parseFrames(client, data));
  socket.on("close", () => closeClient(client));
  socket.on("error", () => closeClient(client));
});

setInterval(gameLoop, TICK_MS);

server.listen(PORT, () => {
  console.log(`Luduo Arcade online em http://localhost:${PORT}`);
});
