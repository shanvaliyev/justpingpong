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
// Air: quadratic drag (a real 40 mm ball tops out near 9 m/s) and Magnus lift from spin (rad/s).
const DRAG = 0.1;
const MAGNUS = 0.006;
const SPIN_DECAY = 0.3;
const MAX_SPIN = 150;
// Share of the contact patch's slip that a bounce turns into linear velocity (topspin kicks forward).
const SPIN_KICK = 0.4;
// How strongly rubber turns a brushing stroke into spin.
const SPIN_GRIP = 0.35;
const PADDLE_DEPTH = BALL_RADIUS + 0.008;
type Phase = "ready" | "playing" | "paused";
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Drag and Magnus acceleration over one tick; gravity is integrated exactly by the caller. */
function air(velocity: Vec3, spin: Vec3, dt: number) {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const lift = cross(spin, velocity);
  for (const axis of ["x", "y", "z"] as const) {
    velocity[axis] += (MAGNUS * lift[axis] - DRAG * speed * velocity[axis]) * dt;
    spin[axis] *= 1 - SPIN_DECAY * dt;
  }
}

/** Table rebound: restitution, friction, and the contact patch gripping a spinning ball. */
function bounce(velocity: Vec3, spin: Vec3) {
  velocity.y *= -TABLE_RESTITUTION;
  velocity.x = velocity.x * TABLE_FRICTION - SPIN_KICK * spin.z * BALL_RADIUS;
  velocity.z = velocity.z * TABLE_FRICTION + SPIN_KICK * spin.x * BALL_RADIUS;
  spin.x *= 1 - SPIN_KICK;
  spin.z *= 1 - SPIN_KICK;
}

/** One prediction tick, used by launches and the AI; the live step resolves exact contacts. */
function advance(ball: Vec3, velocity: Vec3, spin: Vec3, dt: number) {
  air(velocity, spin, dt);
  ball.x += velocity.x * dt;
  ball.z += velocity.z * dt;
  ball.y += velocity.y * dt - 0.5 * GRAVITY * dt * dt;
  velocity.y -= GRAVITY * dt;
  if (
    ball.y < BALL_RADIUS &&
    velocity.y < 0 &&
    Math.abs(ball.x) <= TABLE.halfWidth &&
    Math.abs(ball.z) <= TABLE.halfLength
  ) {
    ball.y = BALL_RADIUS + (BALL_RADIUS - ball.y) * TABLE_RESTITUTION;
    bounce(velocity, spin);
  }
}

/**
 * Racket rebound for a face tilted up by `lift` and sideways by `steer` (normal-vector units).
 * The rubber grips the contact patch; its slip includes the ball's own spin, so an incoming
 * topspin ball kicks up off a block. Spin comes from the stroke brushing across the ball,
 * so a still block stays flat: brushing up gives topspin, sideways gives sidespin.
 */
function racketRebound(velocity: Vec3, spin: Vec3, paddle: Vec3, steer: number, lift: number) {
  const length = Math.hypot(steer, lift, 1);
  const normal = { x: steer / length, y: lift / length, z: -1 / length };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const relative = { x: velocity.x - paddle.x, y: velocity.y - paddle.y, z: velocity.z - paddle.z };
  const incoming = dot(relative, normal);
  const surface = cross(spin, {
    x: -normal.x * BALL_RADIUS,
    y: -normal.y * BALL_RADIUS,
    z: -normal.z * BALL_RADIUS,
  });
  const along = dot(surface, normal);
  const brush = dot(paddle, normal);
  const grip = cross(normal, {
    x: brush * normal.x - paddle.x,
    y: brush * normal.y - paddle.y,
    z: brush * normal.z - paddle.z,
  });
  const out = { velocity: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
  for (const axis of ["x", "y", "z"] as const) {
    const slip = relative[axis] - incoming * normal[axis] + surface[axis] - along * normal[axis];
    out.velocity[axis] =
      paddle[axis] +
      relative[axis] -
      incoming * normal[axis] -
      0.15 * slip -
      0.98 * incoming * normal[axis];
    out.spin[axis] = clamp(
      0.25 * spin[axis] + (SPIN_GRIP * grip[axis]) / BALL_RADIUS,
      -MAX_SPIN,
      MAX_SPIN,
    );
  }
  return out;
}

/** Where a shot first lands (z); a net ball or one dropping on the hitter's side counts as short. */
function landing(start: Vec3, startVelocity: Vec3, startSpin: Vec3) {
  const ball = { ...start };
  const velocity = { ...startVelocity };
  const spin = { ...startSpin };
  for (let i = 0; i < 240; i++) {
    const { y, z } = ball;
    air(velocity, spin, STEP);
    ball.x += velocity.x * STEP;
    ball.z += velocity.z * STEP;
    ball.y += velocity.y * STEP - 0.5 * GRAVITY * STEP * STEP;
    velocity.y -= GRAVITY * STEP;
    if (z > 0 && ball.z <= 0 && ball.y < TABLE.netHeight + BALL_RADIUS) return 1;
    // Interpolate the bounce within the tick so the face-angle search sees a smooth result.
    if (ball.y < BALL_RADIUS && velocity.y < 0)
      return z + ((ball.z - z) * (y - BALL_RADIUS)) / (y - ball.y);
  }
  return -9;
}

export class PracticePhysics {
  ball: Vec3 = { x: 0, y: 0.48, z: -1.48 };
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  /** Angular velocity in rad/s. */
  spin: Vec3 = { x: 0, y: 0, z: 0 };
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

  private launch(targetX: number, targetZ: number, speed: number, spin: Vec3) {
    // Solve the vacuum arc, then correct the aim point for drag and Magnus by shooting.
    const start = { ...this.ball };
    let aimX = targetX;
    let aimZ = targetZ;
    for (let attempt = 0; attempt < 5; attempt++) {
      const time = Math.abs(aimZ - start.z) / speed;
      this.velocity = {
        x: (aimX - start.x) / time,
        y: (BALL_RADIUS - start.y + 0.5 * GRAVITY * time * time) / time,
        z: Math.sign(aimZ - start.z) * speed,
      };
      const ball = { ...start };
      const velocity = { ...this.velocity };
      const turning = { ...spin };
      for (let i = 0; i < 360 && !(ball.y < BALL_RADIUS && velocity.y < 0); i++) {
        air(velocity, turning, STEP);
        ball.x += velocity.x * STEP;
        ball.z += velocity.z * STEP;
        ball.y += velocity.y * STEP - 0.5 * GRAVITY * STEP * STEP;
        velocity.y -= GRAVITY * STEP;
      }
      aimX += targetX - ball.x;
      aimZ += targetZ - ball.z;
    }
    this.spin = { ...spin };
  }

  private serve() {
    this.ball = { x: 0, y: 0.48, z: -1.48 };
    this.launch(0, 0.9, 5.5, { x: 18, y: 0, z: 0 });
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
    this.spin = { x: 0, y: 0, z: 0 };
  }

  private opponentTarget() {
    if (this.velocity.z >= 0) return { x: this.ball.x, y: 0.36 };
    const ball = { ...this.ball };
    const velocity = { ...this.velocity };
    const spin = { ...this.spin };
    for (let i = 0; i < 240 && ball.z > this.opponent.z; i++) advance(ball, velocity, spin, STEP);
    const { x, y } = ball;
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
    air(this.velocity, this.spin, dt);

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
        bounce(this.velocity, this.spin);
        position.y = 0.006;
      } else if (surface === "net") {
        speed = Math.abs(this.velocity.z);
        this.ball.z = face - direction * 0.0001;
        this.velocity.z *= -0.22;
        this.velocity.x *= 0.5;
        this.spin = { x: this.spin.x * -0.3, y: this.spin.y * 0.3, z: this.spin.z * 0.3 };
        this.message = "Net";
      } else {
        speed = Math.abs(this.velocity.z - paddleVelocity.z);
        this.ball.z += surface === "player" ? -0.0001 : 0.0001;
        if (surface === "player") {
          // The wrist picks the face angle a player would for this stroke: whatever the power,
          // a centred contact arcs over the net into the far half, deeper for faster balls.
          // Errors stay with the player: contact height changes depth (the top edge of a hard
          // drive goes long), sideways contact and brushing steer wide, and spin still curves.
          const incoming = { velocity: { ...this.velocity }, spin: { ...this.spin } };
          const steer = offset.x * 1.4;
          const strike = (lift: number) =>
            racketRebound(incoming.velocity, incoming.spin, paddleVelocity, steer, lift);
          const out = strike(0.15);
          // Contact above the blade centre lands deeper, below lands shorter: a fixed depth
          // error, so a fast drive is not punished more than a block for the same mistake.
          const depth =
            clamp(
              -0.5 - 0.04 * Math.hypot(out.velocity.x, out.velocity.y, out.velocity.z),
              -0.95,
              -0.5,
            ) -
            offset.y * 2.5;
          // Depth is not monotonic in face angle (too open turns a rising ball into a short
          // lob), so open the face from closed and take the flattest angle that reaches the
          // target depth, or the deepest one if none does.
          const reach = (lift: number) => {
            const shot = strike(lift);
            return landing(this.ball, shot.velocity, shot.spin);
          };
          let best = -0.6;
          let deepest = Infinity;
          for (let lift = -0.6; lift <= 0.5; lift += 0.025) {
            const z = reach(lift);
            if (z <= depth) {
              let low = lift - 0.025;
              best = lift;
              for (let i = 0; i < 16; i++) {
                const mid = (low + best) / 2;
                if (reach(mid) <= depth) best = mid;
                else low = mid;
              }
              break;
            }
            // Prefer the flatter angle unless a more open one is clearly deeper.
            if (z < deepest - 0.02) [best, deepest] = [lift, z];
          }
          const shot = strike(best);
          this.velocity = shot.velocity;
          this.spin = shot.spin;
          this.rally++;
          this.best = Math.max(this.best, this.rally);
          this.message = "";
        } else {
          this.launch(Math.sin(this.rally * 1.7 + this.serveNumber) * 0.32, 0.9, 5.5, {
            x: 32,
            y: Math.sin(this.rally * 2.3 + this.serveNumber) * 14,
            z: 0,
          });
        }
      }
      this.impacts.push({ surface, position, speed });
    }
    if (Math.abs(this.ball.z) > 2.05 || this.ball.y < -0.55 || Math.abs(this.ball.x) > 2) {
      this.miss();
    }
  }
}
