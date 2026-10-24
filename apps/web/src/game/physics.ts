// Metres, seconds, and a slightly slower gravity for forgiving practice rallies.
// The table surface is y=0; the player stands at positive z.
export const STEP = 1 / 120;
export const GRAVITY = 5.8;
export const BALL_RADIUS = 0.026;
// Contact circle around the blade centre: a little more forgiving than the drawn blade.
export const PADDLE_RADIUS = 0.15;
export const TABLE = { halfWidth: 0.7625, halfLength: 1.37, netHeight: 0.1525 };
export type Vec3 = { x: number; y: number; z: number };
type Phase = "ready" | "playing" | "paused";
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class PracticePhysics {
  ball: Vec3 = { x: 0, y: 0.48, z: -1.48 };
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  player: Vec3 = { x: 0, y: 0.36, z: 1.53 };
  opponent: Vec3 = { x: 0, y: 0.36, z: -1.53 };
  target: Vec3 = { ...this.player };
  phase: Phase = "ready";
  rally = 0;
  best = 0;
  message = "";
  waiting = 0;
  private serveNumber = 0;

  start() {
    this.phase = "playing";
    this.serve();
  }

  pause() {
    if (this.phase === "ready") return;
    this.phase = this.phase === "paused" ? "playing" : "paused";
  }

  reset() {
    this.rally = 0;
    this.player = { x: 0, y: 0.36, z: 1.53 };
    this.target = { ...this.player };
    this.start();
  }

  swing(strength = 1) {
    if (this.phase === "playing") this.target.z = 1.53 - clamp(strength, 0, 1) * 0.32;
  }

  private launch(targetX: number, targetZ: number, speed: number) {
    const time = Math.abs(targetZ - this.ball.z) / speed;
    this.velocity = {
      x: (targetX - this.ball.x) / time,
      // Aim at a bounce on the other half, rather than teleporting the ball.
      y: (BALL_RADIUS - this.ball.y + 0.5 * GRAVITY * time * time) / time,
      z: Math.sign(targetZ - this.ball.z) * speed,
    };
  }

  private serve() {
    this.ball = { x: 0, y: 0.48, z: -1.48 };
    this.launch(0, 0.8, 2.65);
    this.waiting = 0;
    this.message = "";
    this.serveNumber++;
  }

  private miss() {
    this.message = "Next ball…";
    this.waiting = 1.25;
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  step(dt = STEP) {
    if (this.phase !== "playing") return;
    const oldPlayer = { ...this.player };
    const oldOpponent = { ...this.opponent };
    const approach = (value: number, target: number, speed: number) =>
      value + clamp(target - value, -speed * dt, speed * dt);
    this.player.x = approach(this.player.x, clamp(this.target.x, -1.05, 1.05), 7);
    this.player.y = approach(this.player.y, clamp(this.target.y, 0.12, 1.05), 7);
    this.player.z = approach(this.player.z, this.target.z, 3.5);
    this.target.z = approach(this.target.z, 1.53, 0.7);

    // A speed-limited practice partner, not a paddle that teleports to the ball.
    this.opponent.x = approach(this.opponent.x, clamp(this.ball.x, -0.86, 0.86), 1.5);
    this.opponent.y = approach(this.opponent.y, clamp(this.ball.y, 0.15, 1.05), 2);
    if (this.waiting > 0) {
      this.waiting -= dt;
      if (this.waiting <= 0) {
        this.rally = 0;
        this.serve();
      }
      return;
    }

    const old = { ...this.ball };
    this.ball.x += this.velocity.x * dt;
    this.ball.y += this.velocity.y * dt - 0.5 * GRAVITY * dt * dt;
    this.ball.z += this.velocity.z * dt;
    this.velocity.y -= GRAVITY * dt;

    // Sweep relative to both the old and new paddle planes: fast strokes cannot
    // pass through the ball between simulation ticks.
    for (const [paddle, previous, direction] of [
      [this.player, oldPlayer, 1],
      [this.opponent, oldOpponent, -1],
    ] as const) {
      const before = (old.z - previous.z) * direction + BALL_RADIUS;
      const after = (this.ball.z - paddle.z) * direction + BALL_RADIUS;
      if (before > 0 || after < 0 || after <= before) continue;
      const t = -before / (after - before);
      const x = lerp(old.x, this.ball.x, t);
      const y = lerp(old.y, this.ball.y, t);
      const px = lerp(previous.x, paddle.x, t);
      const py = lerp(previous.y, paddle.y, t);
      if (Math.hypot(x - px, y - py) > PADDLE_RADIUS + BALL_RADIUS) continue;
      this.ball = { x, y, z: lerp(previous.z, paddle.z, t) - direction * (BALL_RADIUS + 0.001) };
      if (direction === 1) {
        const forwardSpeed = Math.max(0, (previous.z - paddle.z) / dt);
        const speed = 2.8 + Math.min(1.7, forwardSpeed * 0.55);
        this.launch(clamp(px * 0.45 + (x - px) * 1.8, -0.6, 0.6), -0.85, speed);
        this.rally++;
        this.best = Math.max(this.best, this.rally);
        this.message = "";
      } else {
        this.launch(Math.sin(this.rally * 1.7 + this.serveNumber) * 0.32, 0.8, 2.65);
      }
      return;
    }

    // Sweep the ball's leading edge against the net, including its radius.
    const direction = Math.sign(this.velocity.z);
    const face = -direction * BALL_RADIUS;
    if ((old.z - face) * direction < 0 && (this.ball.z - face) * direction >= 0) {
      const t = (face - old.z) / (this.ball.z - old.z);
      if (
        Math.abs(lerp(old.x, this.ball.x, t)) <= TABLE.halfWidth + BALL_RADIUS &&
        lerp(old.y, this.ball.y, t) <= TABLE.netHeight + BALL_RADIUS
      ) {
        this.ball.z = face - direction * 0.001;
        this.velocity.z *= -0.22;
        this.velocity.x *= 0.5;
        this.message = "Net";
      }
    }

    if (old.y >= BALL_RADIUS && this.ball.y < BALL_RADIUS && this.velocity.y < 0) {
      const t = (old.y - BALL_RADIUS) / (old.y - this.ball.y);
      if (
        Math.abs(lerp(old.x, this.ball.x, t)) <= TABLE.halfWidth &&
        Math.abs(lerp(old.z, this.ball.z, t)) <= TABLE.halfLength
      ) {
        this.ball.y = BALL_RADIUS + (BALL_RADIUS - this.ball.y) * 0.88;
        this.velocity.y *= -0.88;
      }
    }
    if (Math.abs(this.ball.z) > 2.05 || this.ball.y < -0.55 || Math.abs(this.ball.x) > 2) {
      this.miss();
    }
  }
}
