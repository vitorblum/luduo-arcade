"use strict";

const assert = require("assert");

class TestClient {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.waiters = [];
    this.autoPaddle = false;
    this.ws = null;
  }

  async login() {
    this.ws = new WebSocket("ws://127.0.0.1:3000");

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout abrindo socket para ${this.name}`)), 2500);
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
      this.ws.addEventListener("open", () => clearTimeout(timer), { once: true });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      this.messages.push(message);
      if (this.autoPaddle && message.type === "game-state") {
        this.send({ type: "paddle", x: message.ball.x });
      }
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.match(message)) {
          waiter.resolve(message);
          return false;
        }
        return true;
      });
    });

    this.send({ type: "hello", name: this.name });
    return this.waitFor((message) => message.type === "hello-ok" || message.type === "error");
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(match, timeoutMs = 2500) {
    const existing = this.messages.find(match);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const waiter = {
        match,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        }
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error(`Timeout esperando mensagem para ${this.name}`));
      }, timeoutMs);

      this.waiters.push(waiter);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  console.log("1/7 health");
  const health = await fetch("http://localhost:3000/health").then((response) => response.json());
  assert.strictEqual(health.ok, true);

  const ana = new TestClient("Ana");
  const bia = new TestClient("Bia");
  const duplicate = new TestClient("Ana");

  console.log("2/7 login");
  assert.strictEqual((await ana.login()).type, "hello-ok");
  assert.strictEqual((await bia.login()).type, "hello-ok");

  console.log("3/7 nome duplicado");
  const duplicateResult = await duplicate.login();
  assert.strictEqual(duplicateResult.type, "error");
  assert.strictEqual(duplicateResult.code, "name-taken");

  console.log("4/7 convite");
  ana.send({ type: "challenge", target: "Bia", game: "duopong" });

  const invite = await bia.waitFor((message) => message.type === "invite");
  assert.strictEqual(invite.from, "Ana");

  console.log("5/7 sala");
  bia.send({ type: "accept", from: "Ana" });

  const roomAna = await ana.waitFor((message) => message.type === "room-start");
  const roomBia = await bia.waitFor((message) => message.type === "room-start");
  assert.strictEqual(roomAna.game, "duopong");
  assert.strictEqual(roomBia.game, "duopong");

  ana.send({ type: "paddle", x: 0.3 });
  bia.send({ type: "paddle", x: 0.7 });
  ana.autoPaddle = true;
  bia.autoPaddle = true;

  console.log("6/7 estado inicial");
  const stateAna = await ana.waitFor((message) => message.type === "game-state");
  const stateBia = await bia.waitFor((message) => message.type === "game-state");
  assert.strictEqual(stateAna.speed, 1);
  assert.strictEqual(stateBia.speed, 1);
  assert.ok(Number.isFinite(stateAna.ball.x));
  assert.ok(Number.isFinite(stateBia.ball.y));

  console.log("7/7 velocidade");
  await new Promise((resolve) => setTimeout(resolve, 5400));
  const fasterState = await ana.waitFor((message) => message.type === "game-state" && message.speed >= 2, 1000);
  assert.ok(fasterState.speed >= 2);

  duplicate.close();
  ana.close();
  bia.close();
  console.log("Smoke test OK: login, nome unico, convite e DuoPong online funcionando.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  process.exit(1);
});
