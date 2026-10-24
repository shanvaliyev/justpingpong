import assert from "node:assert/strict";
import { test } from "node:test";

import { BALL_RADIUS, PracticePhysics, STEP, TABLE } from "../src/game/physics.ts";

// Air forces are applied once per tick, so subdividing ticks shifts results slightly.
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
const movingBall = (ball, velocity) => {
  const game = new PracticePhysics();
  game.start();
  game.ball = { ...ball };
  game.velocity = { ...velocity };
  game.spin = { x: 0, y: 0, z: 0 };
  return game;
};
const approaching = (x = 0, speed = 3.6) =>
  movingBall({ x, y: 0.36, z: 1.49 }, { x: 0, y: 1.8, z: speed });

test("drag slows a fast ball like a real one, independently of step subdivision", () => {
  const runs = [STEP, STEP / 2].map((dt) => {
    const game = movingBall({ x: 0, y: 5, z: 1 }, { x: 0, y: 0, z: -10 });
    for (let i = 0; i < Math.round(0.1 / dt); i++) game.step(dt);
    return game;
  });
  // 1D quadratic drag, dv/dt = -k v², gives v = v0 / (1 + k v0 t) with k = 0.1 per metre.
  near(runs[0].velocity.z, -10 / (1 + 0.1 * 10 * 0.1), 0.05);
  assert.ok(
    runs[0].velocity.y < 0 && runs[0].velocity.y > -9.81 * 0.1,
    "drag also resists falling",
  );
  for (const axis of ["x", "y", "z"]) near(runs[0].ball[axis], runs[1].ball[axis], 5e-3);
});

test("topspin dives and kicks forward off the table; backspin floats and checks up", () => {
  // Travelling towards the opponent (-z), topspin turns the ball's top forward: spin.x < 0.
  const flights = [-80, 0, 80].map((spinX) => {
    const game = movingBall({ x: 0, y: 0.3, z: 1 }, { x: 0, y: 1, z: -5 });
    game.spin = { x: spinX, y: 0, z: 0 };
    let height;
    let after;
    for (let i = 0; i < 120 && !after; i++) {
      game.step();
      if (height === undefined && game.ball.z <= 0.4) height = game.ball.y;
      if (game.impacts.some((impact) => impact.surface === "table")) after = { ...game.velocity };
    }
    return { height, after };
  });
  const [top, flat, back] = flights;
  assert.ok(top.height < flat.height - 0.01 && back.height > flat.height + 0.01);
  assert.ok(top.after.z < flat.after.z - 0.3, "topspin should leave the bounce faster");
  assert.ok(back.after.z > flat.after.z + 0.3, "backspin should leave the bounce slower");
});

test("brushing up through contact imparts topspin, while a still block adds none", () => {
  const spins = [0, 2].map((brush) => {
    const game = approaching();
    game.player.y = 0.36 - brush * STEP;
    game.target.y = game.player.y + brush * STEP;
    game.step();
    assert.equal(game.rally, 1);
    return game.spin.x;
  });
  near(spins[0], 0);
  assert.ok(spins[1] < -20, `expected topspin, got ${spins[1]}`);
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
    near(whole.ball[axis], split.ball[axis], 1e-4);
    near(whole.velocity[axis], split.velocity[axis], 1e-2);
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
  // The wrist sets the face angle, so compare total speed rather than its forward part.
  const speed = (game) => Math.hypot(game.velocity.x, game.velocity.y, game.velocity.z);
  assert.ok(speed(fast) > speed(slow) + 1.5);
  assert.ok(speed(drive) > speed(slow) + 4);
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
  // Drag shifts this tick by a few mm/s; a bounce judged at the end of the tick would be 10x off.
  near(game.velocity.y, bounce - 9.81 * remaining, 0.006);
  near(game.ball.y, BALL_RADIUS + bounce * remaining - 0.5 * 9.81 * remaining ** 2, 1e-4);
  near(game.ball.x, 0.6 + 1.2 * time + 1.2 * 0.98 * remaining, 1e-4);
  near(game.velocity.z, -0.4 * 0.98, 0.006);
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
  assert.equal(game.nextBallIn, 0);
});

test("full-power flicks of the feed land across the net, whatever the upward speed", () => {
  // Where the feed crosses the racket plane, found with the racket out of the way.
  const probe = new PracticePhysics();
  probe.start();
  probe.player = probe.target = { x: 9, y: 0, z: 1.53 };
  let tick = 0;
  while (probe.ball.z < 1.49) {
    probe.step();
    tick++;
  }
  for (const up of [0, 2, 4]) {
    const game = new PracticePhysics();
    game.start();
    const contact = { ...probe.ball };
    game.player = { ...game.player, x: contact.x, y: contact.y - up * 8 * STEP };
    game.target = { ...game.player };
    const landings = [];
    for (let i = 0; i < 300 && landings.length === 0; i++) {
      if (i >= tick - 8) {
        // A finger flick: the racket rises through the ball while the swing drives forward.
        game.target.y = contact.y + up * (i - tick) * STEP;
        game.swing(1);
      }
      game.step();
      if (game.rally === 1) {
        for (const impact of game.impacts) if (impact.surface !== "player") landings.push(impact);
      }
      game.impacts.length = 0;
    }
    assert.equal(game.rally, 1, `up ${up}: missed the ball`);
    assert.equal(landings[0]?.surface, "table", `up ${up}: ${landings[0]?.surface}`);
    assert.ok(landings[0].position.z < 0 && landings[0].position.z > -TABLE.halfLength);
  }
});

test("pause freezes play, restart preserves best, and a settled ball feeds a new one", () => {
  const game = approaching();
  game.step();
  game.togglePause();
  const ball = { ...game.ball };
  game.step();
  assert.deepEqual(game.ball, ball);
  game.togglePause();
  game.step();
  assert.notDeepEqual(game.ball, ball);
  game.restart();
  assert.equal(game.rally, 0);
  assert.equal(game.best, 1);
  assert.deepEqual(game.previousBall, game.ball);
  assert.equal(game.impacts.length, 0);
  game.ball = { x: 0.2, y: BALL_RADIUS, z: 0.4 };
  game.velocity = { x: 0, y: 0, z: 0 };
  game.step();
  assert.ok(game.nextBallIn > 0);
  for (let i = 0; i < 160; i++) game.step();
  assert.equal(game.nextBallIn, 0);
  assert.ok(game.velocity.z > 0);
});
