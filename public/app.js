"use strict";

const MINIGAMES = [
  {
    id: "duopong",
    title: "DuoPong",
    description: "Pong online para dois celulares, com velocidade aumentando durante a rodada.",
    tags: ["2 jogadores", "online", "toque"]
  },
  {
    id: "duojump",
    title: "DuoJump",
    description: "Bolinhas pulando em plataformas que descem cada vez mais rapido.",
    tags: ["2 jogadores", "online", "toque"]
  },
  {
    id: "pontinhos",
    title: "Pontinhos",
    description: "Dots and Boxes local para dois jogadores no mesmo celular.",
    tags: ["2 locais", "portrait", "toque"]
  }
];

const STORAGE_NAME_KEY = "luduo-player-name";
const STORAGE_DEVICE_KEY = "luduo-device-id";
const HEARTBEAT_MS = 4000;
const DUOJUMP_GRAVITY = 2.35;
const DUOJUMP_MOVE_SPEED = 0.72;
const DUOJUMP_BASE_SCROLL = 0.17;
const DUOJUMP_SCROLL_STEP = 0.05;
const DUOJUMP_RADIUS = 0.035;

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
const botMatchButton = document.getElementById("botMatchButton");
const localMatchButton = document.getElementById("localMatchButton");
const targetInput = document.getElementById("targetInput");
const lobbyMessage = document.getElementById("lobbyMessage");
const inviteModal = document.getElementById("inviteModal");
const inviteTitle = document.getElementById("inviteTitle");
const inviteText = document.getElementById("inviteText");
const acceptInviteButton = document.getElementById("acceptInviteButton");
const declineInviteButton = document.getElementById("declineInviteButton");
const leaveGameButton = document.getElementById("leaveGameButton");
const gameTitle = document.getElementById("gameTitle");
const canvas = document.getElementById("duopongCanvas");
const controlZone = document.getElementById("controlZone");
const youLabel = document.getElementById("youLabel");
const opponentLabel = document.getElementById("opponentLabel");
const youScore = document.getElementById("youScore");
const opponentScore = document.getElementById("opponentScore");
const speedLabel = document.getElementById("speedLabel");
const countdownLabel = document.getElementById("countdownLabel");
const resultModal = document.getElementById("resultModal");
const resultTitle = document.getElementById("resultTitle");
const resultText = document.getElementById("resultText");
const nextPhaseButton = document.getElementById("nextPhaseButton");
const replayButton = document.getElementById("replayButton");
const resultMenuButton = document.getElementById("resultMenuButton");

const ctx = canvas.getContext("2d");

const state = {
  socket: null,
  playerName: "",
  deviceId: "",
  selectedGame: "duopong",
  inviteGame: "duopong",
  players: [],
  inviteFrom: "",
  game: null,
  reconnectTimer: null,
  pingTimer: null,
  leavingApp: false,
  renderStarted: false,
  lastPaddleSentAt: 0,
  lastMoveSentAt: 0,
  localPaddleX: 0.5,
  moveDirection: 0,
  jumpPointerId: null,
  pontinhosGame: null,
  pontinhosPhase: 1,
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

function gameById(id) {
  return MINIGAMES.find((game) => game.id === id) || MINIGAMES[0];
}

function updateMatchActions() {
  const isPontinhos = state.selectedGame === "pontinhos";
  const challengeButton = challengeForm.querySelector("button");

  targetInput.disabled = isPontinhos;
  challengeButton.disabled = isPontinhos;
  botMatchButton.disabled = isPontinhos;
  localMatchButton.disabled = !isPontinhos;
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (err) {
    return "";
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Some Android WebViews can block storage in unusual modes.
  }
}

function makeDeviceId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureDeviceId() {
  const saved = readStoredValue(STORAGE_DEVICE_KEY);
  if (saved) return saved;

  const created = makeDeviceId();
  writeStoredValue(STORAGE_DEVICE_KEY, created);
  return created;
}

function sendHello() {
  if (!state.playerName) return false;
  return send({
    type: "hello",
    name: state.playerName,
    deviceId: state.deviceId
  });
}

function startHeartbeat() {
  clearInterval(state.pingTimer);
  state.pingTimer = setInterval(() => {
    send({ type: "ping" });
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  clearInterval(state.pingTimer);
  state.pingTimer = null;
}

function loadSavedIdentity() {
  state.deviceId = ensureDeviceId();

  const savedName = normalizeName(readStoredValue(STORAGE_NAME_KEY));
  if (!savedName || savedName.length < 2) return;

  state.playerName = savedName;
  nameInput.value = savedName;
  playerName.textContent = savedName;
  setMessage(loginMessage, `Entrando como ${savedName}...`);
}

function savePlayerName(name) {
  writeStoredValue(STORAGE_NAME_KEY, name);
}

function connect() {
  if (
    state.socket &&
    (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  state.leavingApp = false;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}`);
  state.socket = socket;
  connectionDot.classList.remove("is-online");

  socket.addEventListener("open", () => {
    connectionDot.classList.add("is-online");
    sendHello();
  });

  socket.addEventListener("message", (event) => {
    try {
      handleServerMessage(JSON.parse(event.data));
    } catch (err) {
      setMessage(lobbyMessage, "Mensagem invalida do servidor.");
    }
  });

  socket.addEventListener("close", () => {
    stopHeartbeat();
    connectionDot.classList.remove("is-online");
    if (state.playerName && !state.leavingApp) {
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
  if (message.type === "pong") {
    return;
  }

  if (message.type === "hello-ok") {
    state.playerName = message.name;
    playerName.textContent = message.name;
    savePlayerName(message.name);
    startHeartbeat();
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
    const game = gameById(message.game || "duopong");
    state.inviteFrom = message.from;
    state.inviteGame = game.id;
    inviteTitle.textContent = game.title;
    inviteText.textContent = `${message.from} chamou voce para jogar ${game.title}.`;
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
    startGame(message);
    return;
  }

  if (message.type === "game-state") {
    state.lastServerStateAt = performance.now();
    state.game = message;
    if (message.game === "duopong" && !state.visualGame) {
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
    if (["name-taken", "invalid-name", "already-logged"].includes(message.code)) {
      stopHeartbeat();
      state.playerName = "";
      playerName.textContent = "";
      showScreen("login");
      setMessage(loginMessage, text);
      return;
    }

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
    card.className = `game-card ${state.selectedGame === game.id ? "is-selected" : ""}`;
    card.innerHTML = `
      <div class="game-art ${game.id}" aria-hidden="true"><span></span></div>
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
      renderGames();
    });
    gameList.appendChild(card);
  });

  updateMatchActions();
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

function startGame(message) {
  if (message.game === "duojump") {
    startDuoJump(message);
    return;
  }

  startDuoPong(message);
}

function startPontinhos(phase = state.pontinhosPhase) {
  const top = 96;
  const bottom = 26;
  state.pontinhosPhase = Math.max(1, Math.min(window.PontinhosGame.MAX_PHASE, Number(phase) || 1));
  state.pontinhosGame = new window.PontinhosGame({
    phase: state.pontinhosPhase,
    width: window.innerWidth,
    height: window.innerHeight,
    top,
    bottom
  });
  state.game = {
    type: "local-state",
    game: "pontinhos",
    you: "Jogador 1",
    opponent: "Jogador 2"
  };
  state.visualGame = null;
  resultModal.hidden = true;
  gameTitle.textContent = "Pontinhos";
  youLabel.textContent = "Jogador 1";
  opponentLabel.textContent = "Jogador 2";
  controlZone.classList.remove("is-pong", "is-jump");
  controlZone.classList.add("is-dots");
  showScreen("game");
  resizeCanvas();
  updatePontinhosHud();

  if (!state.renderStarted) {
    state.renderStarted = true;
    requestAnimationFrame(renderFrame);
  }
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
  state.moveDirection = 0;
  state.visualGame = createVisualGame(state.game);
  state.lastFrameAt = performance.now();
  state.lastServerStateAt = state.lastFrameAt;
  gameTitle.textContent = "DuoPong";
  youLabel.textContent = state.playerName || "Voce";
  opponentLabel.textContent = message.opponent || "Rival";
  controlZone.classList.add("is-pong");
  controlZone.classList.remove("is-jump", "is-dots");
  showScreen("game");
  resizeCanvas();
  sendPaddle(0.5, true);
  sendMove(0, true);

  if (!state.renderStarted) {
    state.renderStarted = true;
    requestAnimationFrame(renderFrame);
  }
}

function startDuoJump(message) {
  state.game = {
    type: "game-state",
    game: "duojump",
    you: state.playerName,
    opponent: message.opponent,
    runners: {
      you: { x: 0.38, y: 0.68, vy: -0.86, direction: 0, color: "#24d6ff" },
      opponent: { x: 0.62, y: 0.68, vy: -0.86, direction: 0, color: "#ff4f91" }
    },
    platforms: [],
    scores: { you: 0, opponent: 0 },
    speed: 1,
    pausedMs: 1200
  };
  state.visualGame = null;
  state.moveDirection = 0;
  state.lastFrameAt = performance.now();
  state.lastServerStateAt = state.lastFrameAt;
  gameTitle.textContent = "DuoJump";
  youLabel.textContent = state.playerName || "Voce";
  opponentLabel.textContent = message.opponent || "Rival";
  controlZone.classList.remove("is-pong", "is-dots");
  controlZone.classList.add("is-jump");
  showScreen("game");
  resizeCanvas();
  sendMove(0, true);

  if (!state.renderStarted) {
    state.renderStarted = true;
    requestAnimationFrame(renderFrame);
  }
}

function updateHud(game) {
  if (game.game === "pontinhos") {
    updatePontinhosHud();
    return;
  }

  youLabel.textContent = game.you || "Voce";
  opponentLabel.textContent = game.opponent || "Rival";
  youScore.textContent = String(game.scores.you);
  opponentScore.textContent = String(game.scores.opponent);
  speedLabel.textContent = game.game === "duojump" ? `Plataformas ${game.speed}` : `Velocidade ${game.speed}`;
  countdownLabel.textContent = game.pausedMs > 0 ? Math.ceil(game.pausedMs / 1000) : "";
  countdownLabel.style.color = "";
}

function updatePontinhosHud() {
  const game = state.pontinhosGame;
  if (!game) return;

  youLabel.textContent = "Jogador 1";
  opponentLabel.textContent = "Jogador 2";
  youScore.textContent = String(game.scores[1]);
  opponentScore.textContent = String(game.scores[2]);
  speedLabel.textContent = `Fase ${game.phase}`;
  countdownLabel.textContent = game.currentPlayer === 1 ? "Azul" : "Vermelho";
  countdownLabel.style.color = game.currentPlayer === 1 ? "var(--cyan)" : "var(--rose)";
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

  if (state.pontinhosGame) {
    state.pontinhosGame.resize(window.innerWidth, window.innerHeight, 96, 26);
  }
}

function renderFrame() {
  if (state.game && state.game.game === "pontinhos") {
    drawPontinhos();
  } else if (state.game && state.game.game === "duojump") {
    drawDuoJump();
  } else {
    drawDuoPong();
  }
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

function duoJumpScrollSpeed(game) {
  return DUOJUMP_BASE_SCROLL + (Math.max(1, Number(game.speed || 1)) - 1) * DUOJUMP_SCROLL_STEP;
}

function projectedRunner(runner, age) {
  const direction = Number(runner.direction || 0);
  let x = runner.x + direction * DUOJUMP_MOVE_SPEED * age;
  if (x < -DUOJUMP_RADIUS) x = 1 + DUOJUMP_RADIUS;
  if (x > 1 + DUOJUMP_RADIUS) x = -DUOJUMP_RADIUS;

  return {
    x,
    y: runner.y + runner.vy * age + 0.5 * DUOJUMP_GRAVITY * age * age,
    color: runner.color
  };
}

function drawDuoJump() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const game = state.game;
  const age = game && game.pausedMs <= 0 ? Math.min(0.12, (performance.now() - state.lastServerStateAt) / 1000) : 0;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090b10";
  ctx.fillRect(0, 0, width, height);

  const courtLeft = 16;
  const courtRight = width - 16;
  const courtTop = 86;
  const courtBottom = height - Math.min(height * 0.24, 210);
  const courtWidth = courtRight - courtLeft;
  const courtHeight = courtBottom - courtTop;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 2;
  roundRect(ctx, courtLeft, courtTop, courtWidth, courtHeight, 8);
  ctx.stroke();
  drawGlowNet(courtLeft, courtTop, courtWidth, courtHeight);

  if (game) {
    const scroll = duoJumpScrollSpeed(game);
    for (const platform of game.platforms || []) {
      const x = courtLeft + (platform.x - platform.w / 2) * courtWidth;
      const y = courtTop + (platform.y + scroll * age) * courtHeight;
      const platformWidth = platform.w * courtWidth;
      const platformHeight = Math.max(8, platform.h * courtHeight);
      drawPlatform(x, y, platformWidth, platformHeight);
    }

    if (game.runners) {
      drawJumpRunner(projectedRunner(game.runners.opponent, age), courtLeft, courtTop, courtWidth, courtHeight, false);
      drawJumpRunner(projectedRunner(game.runners.you, age), courtLeft, courtTop, courtWidth, courtHeight, true);
    }

  }

  ctx.restore();
}

function drawPontinhos() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const game = state.pontinhosGame;
  const now = performance.now();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090b10";
  ctx.fillRect(0, 0, width, height);

  if (!game) return;

  const layout = game.layout;
  const accent = game.currentPlayer === 1 ? "rgba(36, 214, 255, 0.42)" : "rgba(255, 79, 145, 0.42)";

  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(
    ctx,
    layout.left - 14,
    layout.top - 14,
    layout.right - layout.left + 28,
    layout.bottom - layout.top + 28,
    8
  );
  ctx.stroke();
  drawGlowNet(layout.left - 10, layout.top - 10, layout.right - layout.left + 20, layout.bottom - layout.top + 20);

  drawPontinhosBoxes(game);
  drawPontinhosLines(game, now);
  drawPontinhosDots(game);

  ctx.restore();
}

function playerColor(player, alpha = 1) {
  if (player === 1) return `rgba(36, 214, 255, ${alpha})`;
  return `rgba(255, 79, 145, ${alpha})`;
}

function drawPontinhosBoxes(game) {
  for (let row = 0; row < game.layout.rows - 1; row += 1) {
    for (let column = 0; column < game.layout.columns - 1; column += 1) {
      const owner = game.boxes[row][column];
      if (!owner) continue;
      const a = game.point(row, column);
      const b = game.point(row + 1, column + 1);
      ctx.fillStyle = playerColor(owner, 0.16);
      ctx.fillRect(a.x + 4, a.y + 4, b.x - a.x - 8, b.y - a.y - 8);
    }
  }
}

function drawPontinhosLines(game, now) {
  const drawLine = (line, a, b) => {
    const progress = Math.min(1, Math.max(0, (now - line.start) / 160));
    const x = a.x + (b.x - a.x) * progress;
    const y = a.y + (b.y - a.y) * progress;
    ctx.strokeStyle = playerColor(line.owner, 0.96);
    ctx.lineWidth = Math.max(4, Math.min(7, game.layout.spacing * 0.1));
    ctx.lineCap = "round";
    ctx.shadowColor = playerColor(line.owner, 0.32);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  for (let row = 0; row < game.layout.rows; row += 1) {
    for (let column = 0; column < game.layout.columns - 1; column += 1) {
      const line = game.horizontal[row][column];
      if (line) drawLine(line, game.point(row, column), game.point(row, column + 1));
    }
  }

  for (let row = 0; row < game.layout.rows - 1; row += 1) {
    for (let column = 0; column < game.layout.columns; column += 1) {
      const line = game.vertical[row][column];
      if (line) drawLine(line, game.point(row, column), game.point(row + 1, column));
    }
  }
}

function drawPontinhosDots(game) {
  const radius = Math.max(4, Math.min(7, game.layout.spacing * 0.09));
  ctx.fillStyle = "#f6f8ff";
  ctx.shadowColor = "rgba(246, 248, 255, 0.52)";
  ctx.shadowBlur = 10;

  for (let row = 0; row < game.layout.rows; row += 1) {
    for (let column = 0; column < game.layout.columns; column += 1) {
      const point = game.point(row, column);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.shadowBlur = 0;
}

function drawPlatform(x, y, width, height) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, "rgba(110, 243, 165, 0.95)");
  gradient.addColorStop(1, "rgba(36, 214, 255, 0.9)");
  ctx.fillStyle = gradient;
  ctx.shadowColor = "rgba(36, 214, 255, 0.28)";
  ctx.shadowBlur = 8;
  roundRect(ctx, x, y, width, height, 999);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawJumpRunner(runner, left, top, width, height, isYou) {
  const x = left + runner.x * width;
  const y = top + runner.y * height;
  const radius = Math.max(12, Math.min(width, height) * 0.035);
  ctx.fillStyle = runner.color || (isYou ? "#24d6ff" : "#ff4f91");
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = isYou ? 14 : 8;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(9, 11, 16, 0.7)";
  ctx.beginPath();
  ctx.arc(x + radius * 0.32, y - radius * 0.22, radius * 0.18, 0, Math.PI * 2);
  ctx.fill();
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

function sendMove(direction, force = false) {
  state.moveDirection = Math.max(-1, Math.min(1, direction));
  const now = performance.now();
  if (!force && now - state.lastMoveSentAt < 33) return;
  state.lastMoveSentAt = now;
  send({ type: "move", direction: state.moveDirection });
}

function handlePointer(event) {
  if (!screens.game.classList.contains("is-active")) return;
  if (!state.game) return;

  if (state.game.game === "pontinhos") {
    handlePontinhosPointer(event);
    return;
  }

  if (state.game.game === "duojump") {
    handleJumpTouch(event);
    return;
  }

  if (state.game.game !== "duopong") return;
  event.preventDefault();
  sendPaddle(pointerToPaddleX(event));
}

function handlePontinhosPointer(event) {
  if (event.type !== "pointerdown" || !state.pontinhosGame) return;
  event.preventDefault();
  const result = state.pontinhosGame.playAt(event.clientX, event.clientY, performance.now());
  if (!result.played) return;

  updatePontinhosHud();
  if (result.finished) {
    showPontinhosResult();
  }
}

function showPontinhosResult() {
  const game = state.pontinhosGame;
  if (!game) return;

  const result = game.result();
  resultTitle.textContent =
    result.winner === 0 ? "Empate" : result.winner === 1 ? "Jogador 1 venceu" : "Jogador 2 venceu";
  resultText.textContent = `Fase ${result.phase}: Jogador 1 fez ${result.scores[1]} quadrados, Jogador 2 fez ${result.scores[2]}.`;
  nextPhaseButton.hidden = result.phase >= game.maxPhase;
  resultModal.hidden = false;
}

function exitLocalGame() {
  resultModal.hidden = true;
  state.game = null;
  state.pontinhosGame = null;
  controlZone.classList.remove("is-pong", "is-jump", "is-dots");
  showScreen("home");
}

function jumpTouchDirection(event) {
  return event.clientX >= window.innerWidth / 2 ? 1 : -1;
}

function handleJumpTouch(event) {
  event.preventDefault();

  if (event.type === "pointerdown") {
    state.jumpPointerId = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (err) {
      // Pointer capture is not essential; the window handlers still stop movement.
    }
    sendMove(jumpTouchDirection(event), true);
    return;
  }

  if (state.jumpPointerId !== event.pointerId) return;

  if (event.type === "pointermove") {
    sendMove(jumpTouchDirection(event));
    return;
  }

  if (event.type === "pointerup" || event.type === "pointercancel") {
    state.jumpPointerId = null;
    sendMove(0, true);
  }
}

function notifyLeavingApp() {
  if (state.leavingApp) return;
  state.leavingApp = true;
  stopHeartbeat();

  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    send({ type: "goodbye" });
    try {
      state.socket.close(1000, "leaving");
    } catch (err) {
      // Closing can fail when the WebView is already shutting down.
    }
  }
}

function resumeApp() {
  state.leavingApp = false;
  if (
    state.playerName &&
    (!state.socket ||
      (state.socket.readyState !== WebSocket.OPEN && state.socket.readyState !== WebSocket.CONNECTING))
  ) {
    connect();
  }
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
  state.leavingApp = false;

  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    connect();
  } else {
    sendHello();
  }
});

challengeForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (state.selectedGame === "pontinhos") {
    startPontinhos();
    return;
  }

  const target = normalizeName(targetInput.value);

  if (!target) {
    setMessage(lobbyMessage, "Digite o nome de quem voce quer desafiar.");
    return;
  }

  send({ type: "challenge", target, game: state.selectedGame });
});

botMatchButton.addEventListener("click", () => {
  if (state.selectedGame === "pontinhos") {
    startPontinhos();
    return;
  }

  const game = gameById(state.selectedGame);
  setMessage(lobbyMessage, `Abrindo ${game.title} contra a maquina...`, true);
  send({ type: "bot-match", game: state.selectedGame });
});

localMatchButton.addEventListener("click", () => {
  if (state.selectedGame !== "pontinhos") {
    setMessage(lobbyMessage, "Jogo local disponivel para Pontinhos.", false);
    return;
  }
  startPontinhos();
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
  if (state.game && state.game.game === "pontinhos") {
    exitLocalGame();
    return;
  }

  sendMove(0, true);
  send({ type: "leave-room" });
  state.game = null;
  state.visualGame = null;
  showScreen("home");
});

nextPhaseButton.addEventListener("click", () => {
  if (!state.pontinhosGame) return;
  const nextPhase = Math.min(state.pontinhosGame.maxPhase, state.pontinhosGame.phase + 1);
  state.pontinhosPhase = nextPhase;
  startPontinhos(nextPhase);
});

replayButton.addEventListener("click", () => {
  const phase = state.pontinhosGame ? state.pontinhosGame.phase : state.pontinhosPhase;
  startPontinhos(phase);
});

resultMenuButton.addEventListener("click", exitLocalGame);

controlZone.addEventListener("pointerdown", handlePointer);
controlZone.addEventListener("pointermove", handlePointer);
controlZone.addEventListener("pointerup", handlePointer);
controlZone.addEventListener("pointercancel", handlePointer);
canvas.addEventListener("pointerdown", handlePointer);
canvas.addEventListener("pointermove", handlePointer);
canvas.addEventListener("pointerup", handlePointer);
canvas.addEventListener("pointercancel", handlePointer);
window.addEventListener("pointerup", (event) => {
  if (state.game && state.game.game === "duojump" && state.jumpPointerId === event.pointerId) {
    state.jumpPointerId = null;
    sendMove(0, true);
  }
});
window.addEventListener("resize", resizeCanvas);
window.addEventListener("pagehide", notifyLeavingApp);
window.addEventListener("beforeunload", notifyLeavingApp);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    notifyLeavingApp();
  } else {
    resumeApp();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

loadSavedIdentity();
renderGames();
connect();
