// Metres and seconds. Only the feed and AI choose a landing point; player shots are rebounds.
// The table surface is y=0; the player stands at positive z.
export const STEP = 1 / 120;
export const GRAVITY = 9.81;
export const BALL_RADIUS = 0.026;
// Contact circle around the blade centre: a little more forgiving than the drawn blade.
export const PADDLE_RADIUS = 0.13;
export const TABLE = { halfWidth: 0.7625, halfLength: 1.37, netHeight: 0.1525 };
export type Vec3 = { x: number; y: number; z: number };
export type Impact = {
  surface: "player" | "opponent" | "table" | "net";
  position: Vec3;
  speed: number;
};
const TABLE_RESTITUTION = 0.88;
const TABLE_FRICTION = 0.98;
const PADDLE_DEPTH = BALL_RADIUS + 0.008;
type Phase = "ready" | "playing" | "paused";
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class PracticePhysics {
  ball: Vec3 = { x: 0, y: 0.48, z: -1.48 };
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  player: Vec3 = { x: 0, y: 0.36, z: 1.53 };
  opponent: Vec3 = { x: 0, y: 0.36, z: -1.53 };
  target: Vec3 = { ...this.player };
  previousBall = { ...this.ball };
  previousPlayer = { ...this.player };
  previousOpponent = { ...this.opponent };
  impacts: Impact[] = [];
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
    this.opponent = { x: 0, y: 0.36, z: -1.53 };
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
    this.launch(0, 0.9, 3.6);
    this.previousBall = { ...this.ball };
    this.previousPlayer = { ...this.player };
    this.previousOpponent = { ...this.opponent };
    this.impacts.length = 0;
    this.waiting = 0;
    this.message = "";
    this.serveNumber++;
  }

  private miss() {
    this.message = "Next ball…";
    this.waiting = 1.25;
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  private opponentTarget() {
    if (this.velocity.z >= 0) return { x: this.ball.x, y: 0.36 };
    let { x, y, z } = this.ball;
    let { x: vx, y: vy, z: vz } = this.velocity;
    for (let i = 0; i < 240 && z > this.opponent.z; i++) {
      x += vx * STEP;
      z += vz * STEP;
      y += vy * STEP - 0.5 * GRAVITY * STEP * STEP;
      vy -= GRAVITY * STEP;
      if (
        y < BALL_RADIUS &&
        vy < 0 &&
        Math.abs(x) <= TABLE.halfWidth &&
        Math.abs(z) <= TABLE.halfLength
      ) {
        y = BALL_RADIUS + (BALL_RADIUS - y) * TABLE_RESTITUTION;
        vy *= -TABLE_RESTITUTION;
        vx *= TABLE_FRICTION;
        vz *= TABLE_FRICTION;
      }
    }
    return { x: clamp(x, -0.86, 0.86), y: clamp(y, 0.15, 1.05) };
  }

  step(dt = STEP) {
    if (this.phase !== "playing" || dt <= 0) return;
    this.previousBall = { ...this.ball };
    this.previousPlayer = { ...this.player };
    this.previousOpponent = { ...this.opponent };
    const approach = (value: number, target: number, speed: number) =>
      value + clamp(target - value, -speed * dt, speed * dt);
    this.player.x = approach(this.player.x, clamp(this.target.x, -1.05, 1.05), 7);
    this.player.y = approach(this.player.y, clamp(this.target.y, 0.12, 1.05), 7);
    this.player.z = approach(this.player.z, this.target.z, 3.5);
    this.target.z = approach(this.target.z, 1.53, 0.7);

    // Predict the intercept so diagonal shots are playable, but still beatable.
    const intercept = this.opponentTarget();
    this.opponent.x = approach(this.opponent.x, clamp(intercept.x, -0.86, 0.86), 1.5);
    this.opponent.y = approach(this.opponent.y, intercept.y, 2);
    if (this.waiting > 0) {
      this.waiting -= dt;
      if (this.waiting <= 0) {
        this.rally = 0;
        this.serve();
      }
      return;
    }

    // Resolve the earliest contact, then integrate the unused time. A hit must not
    // freeze a frame or skip a later table/net contact in the same tick.
    let remaining = dt;
    for (let contacts = 0; remaining > 0 && contacts < 4; contacts++) {
      let time = remaining;
      let surface: Impact["surface"] | undefined;
      let paddleVelocity: Vec3 = { x: 0, y: 0, z: 0 };
      let offset = { x: 0, y: 0 };
      const height = (t: number) => this.ball.y + this.velocity.y * t - 0.5 * GRAVITY * t * t;

      for (const [paddle, previous, direction, kind] of [
        [this.player, this.previousPlayer, 1, "player"],
        [this.opponent, this.previousOpponent, -1, "opponent"],
      ] as const) {
        const motion = {
          x: (paddle.x - previous.x) / dt,
          y: (paddle.y - previous.y) / dt,
          z: (paddle.z - previous.z) / dt,
        };
        const relativeZ = this.velocity.z - motion.z;
        if (relativeZ * direction <= 0) continue;
        const z = lerp(previous.z, paddle.z, (dt - remaining) / dt);
        const t = (z - direction * PADDLE_DEPTH - this.ball.z) / relativeZ;
        if (t < 0 || t > time) continue;
        const fraction = (dt - remaining + t) / dt;
        const x = this.ball.x + this.velocity.x * t - lerp(previous.x, paddle.x, fraction);
        const y = height(t) - lerp(previous.y, paddle.y, fraction);
        if (Math.hypot(x, y) > PADDLE_RADIUS + BALL_RADIUS) continue;
        time = t;
        surface = kind;
        paddleVelocity = motion;
        offset = { x, y };
      }

      if (this.ball.y >= BALL_RADIUS) {
        const t =
          (this.velocity.y +
            Math.sqrt(this.velocity.y ** 2 + 2 * GRAVITY * (this.ball.y - BALL_RADIUS))) /
          GRAVITY;
        if (
          t >= 0 &&
          t <= time &&
          Math.abs(this.ball.x + this.velocity.x * t) <= TABLE.halfWidth &&
          Math.abs(this.ball.z + this.velocity.z * t) <= TABLE.halfLength
        ) {
          time = t;
          surface = "table";
        }
      }

      const direction = Math.sign(this.velocity.z);
      const face = -direction * BALL_RADIUS;
      const netTime = (face - this.ball.z) / this.velocity.z;
      if (
        netTime >= 0 &&
        netTime <= time &&
        Math.abs(this.ball.x + this.velocity.x * netTime) <= TABLE.halfWidth + BALL_RADIUS &&
        height(netTime) >= -BALL_RADIUS &&
        height(netTime) <= TABLE.netHeight + BALL_RADIUS
      ) {
        time = netTime;
        surface = "net";
      }

      this.ball.x += this.velocity.x * time;
      this.ball.y = height(time);
      this.ball.z += this.velocity.z * time;
      this.velocity.y -= GRAVITY * time;
      remaining -= time;
      if (!surface) break;

      const position = { ...this.ball };
      let speed: number;
      if (surface === "table") {
        speed = -this.velocity.y;
        if (speed < 0.2) {
          this.miss();
          break;
        }
        this.ball.y = BALL_RADIUS;
        this.velocity.y *= -TABLE_RESTITUTION;
        this.velocity.x *= TABLE_FRICTION;
        this.velocity.z *= TABLE_FRICTION;
        position.y = 0.006;
      } else if (surface === "net") {
        speed = Math.abs(this.velocity.z);
        this.ball.z = face - direction * 0.0001;
        this.velocity.z *= -0.22;
        this.velocity.x *= 0.5;
        this.message = "Net";
      } else {
        speed = Math.abs(this.velocity.z - paddleVelocity.z);
        this.ball.z += surface === "player" ? -0.0001 : 0.0001;
        if (surface === "player") {
          // A slightly open face supports a block. Off-centre contact gives modest
          // arcade steering; rubber grip transfers sideways/upward stroke motion.
          // No target point or minimum forward speed: weak strokes can hit the net.
          const normal = {
            x: offset.x * 1.4,
            y: 0.11 + offset.y * 0.3 - Math.max(0, -paddleVelocity.z) * 0.1,
            z: -1,
          };
          const length = Math.hypot(normal.x, normal.y, normal.z);
          normal.x /= length;
          normal.y /= length;
          normal.z /= length;
          const relative = {
            x: this.velocity.x - paddleVelocity.x,
            y: this.velocity.y - paddleVelocity.y,
            z: this.velocity.z - paddleVelocity.z,
          };
          const incoming = relative.x * normal.x + relative.y * normal.y + relative.z * normal.z;
          for (const axis of ["x", "y", "z"] as const) {
            this.velocity[axis] =
              paddleVelocity[axis] +
              0.85 * (relative[axis] - incoming * normal[axis]) -
              0.98 * incoming * normal[axis];
          }
          this.rally++;
          this.best = Math.max(this.best, this.rally);
          this.message = "";
        } else {
          this.launch(Math.sin(this.rally * 1.7 + this.serveNumber) * 0.32, 0.9, 3.6);
        }
      }
      this.impacts.push({ surface, position, speed });
    }
    if (Math.abs(this.ball.z) > 2.05 || this.ball.y < -0.55 || Math.abs(this.ball.x) > 2) {
      this.miss();
    }
  }
}
