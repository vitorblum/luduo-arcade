"use strict";

const MINIGAMES = [
  {
    id: "duopong",
    title: "DuoPong",
    description: "Pong online para dois celulares, com velocidade aumentando durante a rodada.",
    tags: ["2 jogadores", "online", "toque"]
  }
];

const screens = {
  login: document.getElementById("loginScreen"),
  home: document.getElementById("homeScreen"),
  game: document.getElementById("gameScreen")
};

const loginForm = document.getElementById("loginForm");
const nameInput = document.getElementById("nameInput");
const loginMessage = document.getElementById("loginMessage");
const playerName = document.getElementById("playerName");
const connectionDot = document.getElementById("connectionDot");
const gameList = document.getElementById("gameList");
const onlineList = document.getElementById("onlineList");
const challengeForm = document.getElementById("challengeForm");
const targetInput = document.getElementById("targetInput");
const lobbyMessage = document.getElementById("lobbyMessage");
const inviteModal = document.getElementById("inviteModal");
const inviteText = document.getElementById("inviteText");
const acceptInviteButton = document.getElementById("acceptInviteButton");
const declineInviteButton = document.getElementById("declineInviteButton");
const leaveGameButton = document.getElementById("leaveGameButton");
const canvas = document.getElementById("duopongCanvas");
const controlZone = document.getElementById("controlZone");
const youLabel = document.getElementById("youLabel");
const opponentLabel = document.getElementById("opponentLabel");
const youScore = document.getElementById("youScore");
const opponentScore = document.getElementById("opponentScore");
const speedLabel = document.getElementById("speedLabel");
const countdownLabel = document.getElementById("countdownLabel");

const ctx = canvas.getContext("2d");

const state = {
  socket: null,
  playerName: "",
  selectedGame: "duopong",
  players: [],
  inviteFrom: "",
  game: null,
  reconnectTimer: null,
  renderStarted: false,
  lastPaddleSentAt: 0,
  localPaddleX: 0.5,
  visualGame: null,
  lastServerStateAt: 0,
  lastFrameAt: 0
};

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("is-active"));
  screens[name].classList.add("is-active");
}

function setMessage(element, message, good = false) {
  element.textContent = message || "";
  element.style.color = good ? "var(--green)" : "var(--amber)";
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}`);
  state.socket = socket;
  connectionDot.classList.remove("is-online");

  socket.addEventListener("open", () => {
    connectionDot.classList.add("is-online");
    if (state.playerName) {
      send({ type: "hello", name: state.playerName });
    }
  });

  socket.addEventListener("message", (event) => {
    try {
      handleServerMessage(JSON.parse(event.data));
    } catch (err) {
      setMessage(lobbyMessage, "Mensagem invalida do servidor.");
    }
  });

  socket.addEventListener("close", () => {
    connectionDot.classList.remove("is-online");
    if (state.playerName) {
      setMessage(lobbyMessage, "Conexao caiu. Tentando voltar...");
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connect, 1200);
    }
  });
}

function send(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify(message));
  return true;
}

function handleServerMessage(message) {
  if (message.type === "hello-ok") {
    state.playerName = message.name;
    playerName.textContent = message.name;
    setMessage(loginMessage, "");
    setMessage(lobbyMessage, "Voce entrou como " + message.name + ".", true);
    showScreen("home");
    return;
  }

  if (message.type === "players") {
    state.players = message.players || [];
    renderPlayers();
    return;
  }

  if (message.type === "invite") {
    state.inviteFrom = message.from;
    inviteText.textContent = `${message.from} chamou voce para jogar DuoPong.`;
    inviteModal.hidden = false;
    return;
  }

  if (message.type === "invite-sent") {
    setMessage(lobbyMessage, `Convite enviado para ${message.to}.`, true);
    return;
  }

  if (message.type === "invite-declined") {
    setMessage(lobbyMessage, `${message.by} recusou o convite.`);
    return;
  }

  if (message.type === "room-start") {
    inviteModal.hidden = true;
    startDuoPong(message);
    return;
  }

  if (message.type === "game-state") {
    state.lastServerStateAt = performance.now();
    state.game = message;
    if (!state.visualGame) {
      state.visualGame = createVisualGame(message);
    }
    updateHud(message);
    return;
  }

  if (message.type === "opponent-left") {
    setMessage(lobbyMessage, message.message || "O outro jogador saiu.");
    state.game = null;
    state.visualGame = null;
    showScreen("home");
    return;
  }

  if (message.type === "error") {
    const text = message.message || "Algo deu errado.";
    if (screens.login.classList.contains("is-active")) {
      setMessage(loginMessage, text);
    } else {
      setMessage(lobbyMessage, text);
    }
  }
}

function renderGames() {
  gameList.innerHTML = "";

  MINIGAMES.forEach((game) => {
    const card = document.createElement("article");
    card.className = "game-card";
    card.innerHTML = `
      <div class="game-art" aria-hidden="true"><span></span></div>
      <div>
        <h4>${game.title}</h4>
        <p>${game.description}</p>
        <div class="badge-row">
          ${game.tags.map((tag) => `<span class="badge">${tag}</span>`).join("")}
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      state.selectedGame = game.id;
      setMessage(lobbyMessage, `${game.title} selecionado.`, true);
    });
    gameList.appendChild(card);
  });
}

function renderPlayers() {
  const players = state.players.filter((player) => player.name !== state.playerName);
  onlineList.innerHTML = "";

  if (!players.length) {
    const empty = document.createElement("p");
    empty.className = "message";
    empty.textContent = "Nenhum outro jogador online agora.";
    onlineList.appendChild(empty);
    return;
  }

  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <strong>${player.name}</strong>
      <span class="status-pill ${player.busy ? "busy" : ""}">${player.busy ? "jogando" : "livre"}</span>
    `;
    row.addEventListener("click", () => {
      targetInput.value = player.name;
      targetInput.focus();
    });
    onlineList.appendChild(row);
  });
}

function startDuoPong(message) {
  state.game = {
    type: "game-state",
    game: "duopong",
    you: state.playerName,
    opponent: message.opponent,
    ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    paddles: { you: 0.5, opponent: 0.5 },
    scores: { you: 0, opponent: 0 },
    speed: 1,
    pausedMs: 1200
  };
  state.localPaddleX = 0.5;
  state.visualGame = createVisualGame(state.game);
  state.lastFrameAt = performance.now();
  state.lastServerStateAt = state.lastFrameAt;
  youLabel.textContent = state.playerName || "Voce";
  opponentLabel.textContent = message.opponent || "Rival";
  showScreen("game");
  resizeCanvas();
  sendPaddle(0.5, true);

  if (!state.renderStarted) {
    state.renderStarted = true;
    requestAnimationFrame(renderFrame);
  }
}

function updateHud(game) {
  youLabel.textContent = game.you || "Voce";
  opponentLabel.textContent = game.opponent || "Rival";
  youScore.textContent = String(game.scores.you);
  opponentScore.textContent = String(game.scores.opponent);
  speedLabel.textContent = `Velocidade ${game.speed}`;
  countdownLabel.textContent = game.pausedMs > 0 ? Math.ceil(game.pausedMs / 1000) : "";
}

function createVisualGame(game) {
  return {
    ball: {
      x: game.ball.x,
      y: game.ball.y
    },
    paddles: {
      you: game.paddles.you,
      opponent: game.paddles.opponent
    }
  };
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function canPredictBall(game) {
  return (
    game.pausedMs <= 0 &&
    Number.isFinite(game.ball.vx) &&
    Number.isFinite(game.ball.vy)
  );
}

function reflectPosition(value, min, max) {
  const size = max - min;
  if (size <= 0) return min;

  let offset = (value - min) % (size * 2);
  if (offset < 0) offset += size * 2;
  if (offset > size) offset = size * 2 - offset;
  return min + offset;
}

function projectBall(game, seconds) {
  if (!canPredictBall(game)) {
    return {
      x: game.ball.x,
      y: game.ball.y
    };
  }

  return {
    x: reflectPosition(game.ball.x + game.ball.vx * seconds, 0.022, 0.978),
    y: reflectPosition(game.ball.y + game.ball.vy * seconds, 0.022, 0.978)
  };
}

function predictedBall(game, now) {
  const age = Math.min(0.25, Math.max(0, (now - state.lastServerStateAt) / 1000));
  return projectBall(game, age);
}

function updateVisualGame(now) {
  const game = state.game;
  if (!game) return null;
  if (!state.visualGame) {
    state.visualGame = createVisualGame(game);
  }

  const dt = Math.min(0.04, Math.max(0, (now - (state.lastFrameAt || now)) / 1000));
  state.lastFrameAt = now;

  const visual = state.visualGame;
  if (canPredictBall(game)) {
    const nextBall = projectBall(
      {
        pausedMs: 0,
        ball: {
          x: visual.ball.x,
          y: visual.ball.y,
          vx: game.ball.vx,
          vy: game.ball.vy
        }
      },
      dt
    );
    visual.ball.x = nextBall.x;
    visual.ball.y = nextBall.y;
  }

  const targetBall = predictedBall(game, now);
  const drift = Math.hypot(visual.ball.x - targetBall.x, visual.ball.y - targetBall.y);
  const serverAge = now - state.lastServerStateAt;
  const ballFollow =
    game.pausedMs > 0 || drift > 0.22
      ? 1
      : serverAge > 260
        ? 0
        : 1 - Math.exp(-dt * 7);
  const paddleFollow = 1 - Math.exp(-dt * 14);

  visual.ball.x = lerp(visual.ball.x, targetBall.x, ballFollow);
  visual.ball.y = lerp(visual.ball.y, targetBall.y, ballFollow);
  visual.paddles.opponent = lerp(visual.paddles.opponent, game.paddles.opponent, paddleFollow);
  visual.paddles.you = state.localPaddleX;

  return visual;
}

function resizeCanvas() {
  const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5));
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function renderFrame() {
  drawDuoPong();
  requestAnimationFrame(renderFrame);
}

function drawDuoPong() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const game = state.game;
  const visual = updateVisualGame(performance.now());

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090b10";
  ctx.fillRect(0, 0, width, height);

  const courtLeft = 16;
  const courtRight = width - 16;
  const courtTop = 86;
  const courtBottom = height - Math.min(height * 0.22, 190);
  const courtWidth = courtRight - courtLeft;
  const courtHeight = courtBottom - courtTop;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 2;
  roundRect(ctx, courtLeft, courtTop, courtWidth, courtHeight, 8);
  ctx.stroke();

  ctx.setLineDash([8, 12]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.beginPath();
  ctx.moveTo(courtLeft + 14, courtTop + courtHeight / 2);
  ctx.lineTo(courtRight - 14, courtTop + courtHeight / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  drawGlowNet(courtLeft, courtTop, courtWidth, courtHeight);

  if (game && visual) {
    const ballX = courtLeft + visual.ball.x * courtWidth;
    const ballY = courtTop + visual.ball.y * courtHeight;
    const paddleWidth = Math.max(84, courtWidth * 0.27);
    const paddleHeight = 12;

    drawPaddle(courtLeft + visual.paddles.opponent * courtWidth, courtTop + 20, paddleWidth, paddleHeight, "#ff4f91");
    drawPaddle(courtLeft + visual.paddles.you * courtWidth, courtBottom - 32, paddleWidth, paddleHeight, "#24d6ff");

    const ballRadius = Math.max(8, Math.min(width, height) * 0.018);
    ctx.fillStyle = "#f6f8ff";
    ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function drawGlowNet(left, top, width, height) {
  const gradient = ctx.createLinearGradient(left, top, left + width, top + height);
  gradient.addColorStop(0, "rgba(36, 214, 255, 0.08)");
  gradient.addColorStop(0.45, "rgba(110, 243, 165, 0.05)");
  gradient.addColorStop(1, "rgba(255, 79, 145, 0.07)");
  ctx.fillStyle = gradient;
  roundRect(ctx, left + 2, top + 2, width - 4, height - 4, 8);
  ctx.fill();
}

function drawPaddle(centerX, y, width, height, color) {
  const x = centerX - width / 2;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  roundRect(ctx, x, y, width, height, 999);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function pointerToPaddleX(event) {
  const rect = canvas.getBoundingClientRect();
  return Math.max(0.135, Math.min(0.865, (event.clientX - rect.left) / rect.width));
}

function sendPaddle(x, force = false) {
  state.localPaddleX = x;
  const now = performance.now();
  if (!force && now - state.lastPaddleSentAt < 33) return;
  state.lastPaddleSentAt = now;
  send({ type: "paddle", x });
}

function handlePointer(event) {
  if (!screens.game.classList.contains("is-active")) return;
  event.preventDefault();
  sendPaddle(pointerToPaddleX(event));
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = normalizeName(nameInput.value);

  if (name.length < 2) {
    setMessage(loginMessage, "Use um nome com pelo menos 2 letras.");
    return;
  }

  state.playerName = name;
  playerName.textContent = name;
  setMessage(loginMessage, "Entrando...");

  if (!state.socket || state.socket.readyState === WebSocket.CLOSED) {
    connect();
  } else {
    send({ type: "hello", name });
  }
});

challengeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const target = normalizeName(targetInput.value);

  if (!target) {
    setMessage(lobbyMessage, "Digite o nome de quem voce quer desafiar.");
    return;
  }

  send({ type: "challenge", target, game: state.selectedGame });
});

acceptInviteButton.addEventListener("click", () => {
  if (state.inviteFrom) {
    send({ type: "accept", from: state.inviteFrom });
  }
  inviteModal.hidden = true;
});

declineInviteButton.addEventListener("click", () => {
  if (state.inviteFrom) {
    send({ type: "decline", from: state.inviteFrom });
  }
  state.inviteFrom = "";
  inviteModal.hidden = true;
});

leaveGameButton.addEventListener("click", () => {
  send({ type: "leave-room" });
  state.game = null;
  state.visualGame = null;
  showScreen("home");
});

controlZone.addEventListener("pointerdown", handlePointer);
controlZone.addEventListener("pointermove", handlePointer);
canvas.addEventListener("pointerdown", handlePointer);
canvas.addEventListener("pointermove", handlePointer);
window.addEventListener("resize", resizeCanvas);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

renderGames();
connect();
