import assert from "node:assert/strict";
import { test } from "node:test";

import { BALL_RADIUS, PracticePhysics, STEP, TABLE } from "../src/game/physics.ts";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const movingBall = (ball, velocity) => {
  const game = new PracticePhysics();
  game.start();
  game.ball = { ...ball };
  game.velocity = { ...velocity };
  return game;
};
const approaching = (x = 0, speed = 3.6) =>
  movingBall({ x, y: 0.36, z: 1.49 }, { x: 0, y: 1.8, z: speed });

test("free flight follows gravity independently of step subdivision", () => {
  for (const dt of [STEP, STEP / 2]) {
    const game = movingBall({ x: 0.17, y: 0.9, z: 0.4 }, { x: -0.3, y: 0.7, z: 0.2 });
    for (let i = 0; i < Math.round(0.25 / dt); i++) game.step(dt);
    near(game.ball.x, 0.17 - 0.3 * 0.25);
    near(game.ball.y, 0.9 + 0.7 * 0.25 - 0.5 * 9.81 * 0.25 ** 2);
    near(game.velocity.y, 0.7 - 9.81 * 0.25);
  }
});

test("racket contact consumes the remainder of the tick, without repeat hits", () => {
  const whole = approaching(0.035);
  const split = approaching(0.035);
  whole.step();
  for (let i = 0; i < 3; i++) split.step(STEP / 3);
  assert.equal(whole.rally, 1);
  assert.equal(split.rally, 1);
  assert.ok(whole.ball.z < 1.48, "ball must already be travelling away from contact");
  for (const axis of ["x", "y", "z"]) {
    near(whole.ball[axis], split.ball[axis]);
    near(whole.velocity[axis], split.velocity[axis]);
  }
  for (let i = 0; i < 10; i++) whole.step();
  assert.equal(whole.rally, 1);
});

test("sideways strokes change the return even at the same contact point", () => {
  const returns = [-1.8, 0, 1.8].map((stroke) => {
    const time = 0.004;
    const game = movingBall(
      { x: 0.04, y: 0.36, z: 1.496 - 3.6 * time },
      { x: 0.2, y: 1.8, z: 3.6 },
    );
    game.player.x = -stroke * time;
    game.target.x = game.player.x + stroke * STEP;
    game.step();
    assert.equal(game.rally, 1);
    return game.velocity.x;
  });
  assert.ok(returns[0] < returns[1] - 0.2);
  assert.ok(returns[2] > returns[1] + 0.2);
});

test("off-centre blocks steer both ways without adding energy to a stationary racket", () => {
  for (const x of [-0.08, 0.055]) {
    const game = approaching(x);
    const energy = Math.hypot(...Object.values(game.velocity)) ** 2 + 2 * 9.81 * game.ball.y;
    game.step();
    assert.equal(game.rally, 1);
    assert.ok(game.velocity.x * Math.sign(x) > 0.3);
    assert.ok(game.velocity.z < 0);
    const after = Math.hypot(...Object.values(game.velocity)) ** 2 + 2 * 9.81 * game.ball.y;
    assert.ok(after < energy, "a stationary paddle cannot supply energy");
  }
});

test("incoming momentum and a forward stroke determine speed, not a preset launch", () => {
  const slow = approaching(0, 2.5);
  const fast = approaching(0, 4.5);
  const drive = approaching(0, 2.5);
  drive.swing();
  for (const game of [slow, fast, drive]) {
    game.step();
    assert.equal(game.rally, 1);
  }
  assert.ok(fast.velocity.z < slow.velocity.z - 1.5);
  assert.ok(drive.velocity.z < slow.velocity.z - 4);
});

test("table bounce occurs at time of impact and retains the rest of the flight", () => {
  const time = 0.003;
  const game = movingBall(
    { x: 0.6, y: BALL_RADIUS + 2 * time + 0.5 * 9.81 * time ** 2, z: -0.5 },
    { x: 1.2, y: -2, z: -0.4 },
  );
  game.step();
  const bounce = (2 + 9.81 * time) * 0.88;
  const remaining = STEP - time;
  near(game.velocity.y, bounce - 9.81 * remaining);
  near(game.ball.y, BALL_RADIUS + bounce * remaining - 0.5 * 9.81 * remaining ** 2);
  near(game.ball.x, 0.6 + 1.2 * time + 1.2 * 0.98 * remaining);
  near(game.velocity.z, -0.4 * 0.98);
  assert.deepEqual(
    game.impacts.map((impact) => impact.surface),
    ["table"],
  );
});

test("a ball crossing the table edge is judged at contact, not the end of the tick", () => {
  for (const [x, vx, bounce] of [
    [TABLE.halfWidth - 0.001, 2, false],
    [TABLE.halfWidth + 0.001, -2, true],
  ]) {
    const time = 0.003;
    const game = movingBall(
      { x, y: BALL_RADIUS + time + 0.5 * 9.81 * time ** 2, z: 0.7 },
      { x: vx, y: -1, z: 0.4 },
    );
    game.step();
    assert.equal(game.velocity.y > 0, bounce);
  }
});

test("table and racket contacts in one tick resolve in chronological order", () => {
  const game = movingBall({ x: 0, y: 0.04, z: 1.25 }, { x: 0, y: -4, z: 4 });
  game.player = { x: 0, y: 0.12, z: 1.3 };
  game.target = { ...game.player };
  game.step();
  assert.deepEqual(
    game.impacts.map((impact) => impact.surface),
    ["table", "player"],
  );
  assert.equal(game.rally, 1);
  assert.ok(game.ball.y >= BALL_RADIUS);
  assert.ok(game.velocity.z < 0);
});

test("the net includes the ball radius, but shots above or beside it clear", () => {
  for (const [x, y, hit] of [
    [0.2, TABLE.netHeight + BALL_RADIUS - 0.005, true],
    [0.2, TABLE.netHeight + BALL_RADIUS + 0.005, false],
    [TABLE.halfWidth + BALL_RADIUS + 0.01, 0.1, false],
  ]) {
    const game = movingBall({ x, y, z: 0.04 }, { x: 0, y: 0, z: -7 });
    game.step();
    assert.equal(game.velocity.z > 0, hit);
    assert.equal(
      game.impacts.some((impact) => impact.surface === "net"),
      hit,
    );
  }
});

test("a paddle miss does not bounce, while a fast incoming ball cannot tunnel", () => {
  for (const [x, hit] of [
    [0.05, true],
    [0.19, false],
  ]) {
    const game = approaching(x, 20);
    game.step();
    assert.equal(game.rally, hit ? 1 : 0);
    assert.equal(game.velocity.z < 0, hit);
  }
});

test("the default feed can be blocked across the net and returned by the partner", () => {
  const game = new PracticePhysics();
  game.start();
  for (let i = 0; i < 300 && !game.impacts.some((impact) => impact.surface === "opponent"); i++)
    game.step();
  assert.equal(game.rally, 1);
  assert.deepEqual(
    game.impacts.map((impact) => impact.surface),
    ["table", "player", "table", "opponent"],
  );
  assert.ok(game.impacts[2].position.z < 0);
  assert.equal(game.waiting, 0);
});

test("pause freezes play, reset preserves best, and a settled ball feeds a new one", () => {
  const game = approaching();
  game.step();
  game.pause();
  const ball = { ...game.ball };
  game.step();
  assert.deepEqual(game.ball, ball);
  game.pause();
  game.step();
  assert.notDeepEqual(game.ball, ball);
  game.reset();
  assert.equal(game.rally, 0);
  assert.equal(game.best, 1);
  assert.deepEqual(game.previousBall, game.ball);
  assert.equal(game.impacts.length, 0);
  game.ball = { x: 0.2, y: BALL_RADIUS, z: 0.4 };
  game.velocity = { x: 0, y: 0, z: 0 };
  game.step();
  assert.ok(game.waiting > 0);
  for (let i = 0; i < 160; i++) game.step();
  assert.equal(game.waiting, 0);
  assert.ok(game.velocity.z > 0);
});
