import assert from "node:assert/strict";
import { test } from "node:test";
import { PracticePhysics, STEP } from "./physics.ts";

test("gravity, a lossy table bounce, and a miss beyond the table edge", () => {
  for (const [x, bounces] of [
    [0.3, true],
    [0.9, false],
  ]) {
    const game = new PracticePhysics();
    game.start();
    game.ball = { x, y: 0.03, z: 0.65 };
    game.velocity = { x: 0, y: -2, z: 0 };
    game.step();
    assert.equal(game.velocity.y > 0, bounces);
    if (bounces) assert.ok(game.velocity.y < 2);
    else assert.ok(game.ball.y < 0.026);
  }
});

test("swept net collision stops fast low shots but clears high shots in both directions", () => {
  for (const direction of [-1, 1]) {
    for (const [y, blocked] of [
      [0.1, true],
      [0.25, false],
    ]) {
      const game = new PracticePhysics();
      game.start();
      game.ball = { x: 0.35, y, z: -0.08 * direction };
      game.velocity = { x: 0, y: 0, z: 25 * direction };
      game.step();
      assert.equal(Math.sign(game.velocity.z), blocked ? -direction : direction);
    }
  }
});

test("swept paddle contacts catch fast balls, but near misses stay misses", () => {
  for (const [x, hits] of [
    [0.12, true],
    [0.23, false],
  ]) {
    const game = new PracticePhysics();
    game.start();
    game.ball = { x, y: 0.36, z: 1.35 };
    game.velocity = { x: 0, y: 0, z: 35 };
    game.step();
    assert.equal(game.rally, hits ? 1 : 0);
    assert.equal(game.velocity.z < 0, hits);
  }
});

test("a forward stroke adds speed only on contact, including a moving-plane hit", () => {
  const block = new PracticePhysics();
  const drive = new PracticePhysics();
  for (const game of [block, drive]) {
    game.start();
    game.ball = { x: 0.03, y: 0.36, z: 1.49 };
    game.velocity = { x: 0, y: 0, z: 3 };
  }
  drive.swing();
  block.step();
  drive.step();
  assert.equal(block.rally, 1);
  assert.equal(drive.rally, 1);
  assert.ok(Math.abs(drive.velocity.z) > Math.abs(block.velocity.z) + 1);

  const moving = new PracticePhysics();
  moving.start();
  moving.ball = { x: 0, y: 0.36, z: 1.49 };
  moving.velocity = { x: 0, y: 0, z: 0 };
  moving.swing();
  moving.step();
  assert.equal(moving.rally, 1, "paddle can sweep into a stationary ball");

  const miss = new PracticePhysics();
  miss.start();
  miss.ball = { x: 0.5, y: 0.36, z: 1.49 };
  miss.velocity = { x: 0, y: 0, z: 3 };
  miss.swing();
  miss.step();
  assert.equal(miss.velocity.z, 3);
  assert.equal(miss.rally, 0);
});

test("the feeder and AI sustain a rally when the player meets the ball", () => {
  const game = new PracticePhysics();
  game.start();
  for (let i = 0; i < 120 * 25; i++) {
    game.target.x = game.ball.x;
    game.target.y = game.ball.y;
    game.step();
    assert.equal(game.waiting, 0, "an aligned paddle should keep this rally alive");
  }
  assert.ok(game.rally >= 10);
  assert.equal(game.best, game.rally);
});

test("pause freezes play; misses refeed; restart preserves session best", () => {
  const game = new PracticePhysics();
  game.start();
  for (let i = 0; i < 140; i++) game.step();
  assert.equal(game.rally, 1);
  game.pause();
  const before = JSON.stringify(game);
  for (let i = 0; i < 100; i++) game.step();
  assert.equal(JSON.stringify(game), before);
  game.pause();
  game.target.x = 1;
  for (let i = 0; i < 4 / STEP; i++) game.step();
  assert.equal(game.rally, 0);
  assert.equal(game.best, 1);
  game.reset();
  assert.equal(game.phase, "playing");
  assert.equal(game.rally, 0);
  assert.equal(game.best, 1);
  assert.equal(game.waiting, 0);
  assert.ok(game.velocity.z > 0);
});
