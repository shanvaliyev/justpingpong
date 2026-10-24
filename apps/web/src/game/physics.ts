// Metres and seconds. The table surface is y = 0 and the player stands at positive z.
// Only the feed and the AI aim at a landing point; player shots are rebounds off the racket.
export const STEP = 1 / 120;
export const GRAVITY = 9.81;
export const BALL_RADIUS = 0.026;
/** Contact circle around the blade centre: a little more forgiving than the drawn blade. */
export const PADDLE_RADIUS = 0.13;
export const TABLE = { halfWidth: 0.7625, halfLength: 1.37, netHeight: 0.1525 };

export type Vec3 = { x: number; y: number; z: number };
export type Surface = "player" | "opponent" | "table" | "net";
export type Impact = { surface: Surface; position: Vec3; speed: number };
export type Phase = "ready" | "playing" | "paused";

/** Rest positions. The player's hand moves in the plane z = PLAYER_HOME.z. */
export const PLAYER_HOME: Readonly<Vec3> = { x: 0, y: 0.36, z: 1.53 };
const OPPONENT_HOME: Readonly<Vec3> = { x: 0, y: 0.36, z: -1.53 };
const FEED_FROM: Readonly<Vec3> = { x: 0, y: 0.48, z: -1.48 };

const TABLE_RESTITUTION = 0.88;
const TABLE_FRICTION = 0.98;
// Air: quadratic drag (a real 40 mm ball tops out near 9 m/s) and Magnus lift from spin (rad/s).
const DRAG = 0.1;
const MAGNUS = 0.006;
const SPIN_DECAY = 0.3;
const MAX_SPIN = 150;
// Share of the contact patch's slip that a bounce turns into linear velocity (topspin kicks forward).
const SPIN_KICK = 0.4;
// Rubber: how much of the normal speed it returns, how much contact-patch slip it removes,
// how much incoming spin survives, and how strongly a brushing stroke turns into spin.
const RACKET_RESTITUTION = 0.98;
const RACKET_FRICTION = 0.15;
const RACKET_SPIN_KEPT = 0.25;
const SPIN_GRIP = 0.35;
const PADDLE_DEPTH = BALL_RADIUS + 0.008;

const HAND_SPEED = 7;
const KEYBOARD_SPEED = 1.8;
const SWING = { reach: 0.32, speed: 3.5, recovery: 0.7 };
const OPPONENT_SPEED = { x: 1.5, y: 2 };
/** Both the feed and the AI aim deep on the player's side at a steady pace. */
const AI_SHOT = { depth: 0.9, speed: 5.5 };
const NEXT_BALL_DELAY = 1.25;
/** A table bounce slower than this means the ball has stopped: a miss. */
const DEAD_BALL_SPEED = 0.2;

export const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const AXES = ["x", "y", "z"] as const;
const onTable = (x: number, z: number) =>
  Math.abs(x) <= TABLE.halfWidth && Math.abs(z) <= TABLE.halfLength;

/** Drag and Magnus over one tick; `move` integrates gravity exactly. */
function air(velocity: Vec3, spin: Vec3, dt: number) {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const lift = cross(spin, velocity);
  for (const axis of AXES) {
    velocity[axis] += (MAGNUS * lift[axis] - DRAG * speed * velocity[axis]) * dt;
    spin[axis] *= 1 - SPIN_DECAY * dt;
  }
}

/** Ballistic motion under gravity alone for `t` seconds. */
function move(ball: Vec3, velocity: Vec3, t: number) {
  ball.x += velocity.x * t;
  ball.y = ball.y + velocity.y * t - 0.5 * GRAVITY * t * t;
  ball.z += velocity.z * t;
  velocity.y -= GRAVITY * t;
}

/** One prediction tick. The live simulation resolves exact contact times instead. */
function fly(ball: Vec3, velocity: Vec3, spin: Vec3, dt: number) {
  air(velocity, spin, dt);
  move(ball, velocity, dt);
}

/** Table rebound: restitution, friction, and the contact patch gripping a spinning ball. */
function bounceOffTable(velocity: Vec3, spin: Vec3) {
  velocity.y *= -TABLE_RESTITUTION;
  velocity.x = velocity.x * TABLE_FRICTION - SPIN_KICK * spin.z * BALL_RADIUS;
  velocity.z = velocity.z * TABLE_FRICTION + SPIN_KICK * spin.x * BALL_RADIUS;
  spin.x *= 1 - SPIN_KICK;
  spin.z *= 1 - SPIN_KICK;
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
  const relative = { x: velocity.x - paddle.x, y: velocity.y - paddle.y, z: velocity.z - paddle.z };
  const incoming = dot(relative, normal);
  // Velocity of the ball's surface at the contact point, from its own spin.
  const surface = cross(spin, {
    x: -normal.x * BALL_RADIUS,
    y: -normal.y * BALL_RADIUS,
    z: -normal.z * BALL_RADIUS,
  });
  const along = dot(surface, normal);
  // The racket's motion across its own face drags the rubber over the ball.
  const brush = dot(paddle, normal);
  const grip = cross(normal, {
    x: brush * normal.x - paddle.x,
    y: brush * normal.y - paddle.y,
    z: brush * normal.z - paddle.z,
  });
  const out = { velocity: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 } };
  for (const axis of AXES) {
    const tangential = relative[axis] - incoming * normal[axis];
    const slip = tangential + surface[axis] - along * normal[axis];
    out.velocity[axis] =
      paddle[axis] +
      tangential -
      RACKET_FRICTION * slip -
      RACKET_RESTITUTION * incoming * normal[axis];
    out.spin[axis] = clamp(
      RACKET_SPIN_KEPT * spin[axis] + (SPIN_GRIP * grip[axis]) / BALL_RADIUS,
      -MAX_SPIN,
      MAX_SPIN,
    );
  }
  return out;
}

/**
 * Where a shot from the player's side first lands (z). A net ball counts as short; one that
 * never comes down counts as long.
 */
function landingZ(from: Vec3, startVelocity: Vec3, startSpin: Vec3) {
  const ball = { ...from };
  const velocity = { ...startVelocity };
  const spin = { ...startSpin };
  for (let i = 0; i < 240; i++) {
    const { y, z } = ball;
    fly(ball, velocity, spin, STEP);
    if (z > 0 && ball.z <= 0 && ball.y < TABLE.netHeight + BALL_RADIUS) return 1;
    // Interpolate the bounce within the tick so the face-angle search sees a smooth result.
    if (ball.y < BALL_RADIUS && velocity.y < 0)
      return z + ((ball.z - z) * (y - BALL_RADIUS)) / (y - ball.y);
  }
  return -Infinity;
}

/** Launch velocity that lands a ball with this spin at `target`, travelling at `speed` along z. */
function aimShot(from: Vec3, target: { x: number; z: number }, speed: number, spin: Vec3) {
  // Solve the vacuum arc, then correct the aim point for drag and Magnus by shooting.
  const aim = { ...target };
  let velocity: Vec3 = { x: 0, y: 0, z: 0 };
  for (let attempt = 0; attempt < 5; attempt++) {
    const time = Math.abs(aim.z - from.z) / speed;
    velocity = {
      x: (aim.x - from.x) / time,
      y: (BALL_RADIUS - from.y + 0.5 * GRAVITY * time * time) / time,
      z: Math.sign(aim.z - from.z) * speed,
    };
    const ball = { ...from };
    const flight = { ...velocity };
    const turning = { ...spin };
    for (let i = 0; i < 360 && !(ball.y < BALL_RADIUS && flight.y < 0); i++) {
      fly(ball, flight, turning, STEP);
    }
    aim.x += target.x - ball.x;
    aim.z += target.z - ball.z;
  }
  return velocity;
}

/**
 * The player's return. The wrist picks the face angle a player would for this stroke: whatever
 * the power, a centred contact arcs over the net into the far half, deeper for faster balls.
 * Errors stay with the player: contact height changes depth (the top edge of a hard drive goes
 * long), sideways contact and brushing steer wide, and spin still curves.
 */
function playerReturn(
  ball: Vec3,
  velocity: Vec3,
  spin: Vec3,
  paddle: Vec3,
  offset: { x: number; y: number },
) {
  const strike = (lift: number) => racketRebound(velocity, spin, paddle, offset.x * 1.4, lift);
  const reach = (lift: number) => {
    const shot = strike(lift);
    return landingZ(ball, shot.velocity, shot.spin);
  };
  // Contact above the blade centre lands deeper, below lands shorter: a fixed depth error,
  // so a fast drive is not punished more than a block for the same mistake.
  const flat = strike(0.15).velocity;
  const depth =
    clamp(-0.5 - 0.04 * Math.hypot(flat.x, flat.y, flat.z), -0.95, -0.5) - offset.y * 2.5;
  // Depth is not monotonic in face angle (too open turns a rising ball into a short lob), so
  // open the face from closed and take the flattest angle that reaches the target depth, or
  // the deepest one if none does.
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
  return strike(best);
}

type Contact =
  | { surface: "player" | "opponent"; time: number; paddle: Vec3; offset: { x: number; y: number } }
  | { surface: "table" | "net"; time: number };

/**
 * A practice rally against a friendly AI. Positions and velocities are public so the renderer
 * can interpolate them and input can steer the player's hand through `target` and `drive`.
 */
export class PracticePhysics {
  ball: Vec3 = { ...FEED_FROM };
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  /** Angular velocity in rad/s. */
  spin: Vec3 = { x: 0, y: 0, z: 0 };
  player: Vec3 = { ...PLAYER_HOME };
  opponent: Vec3 = { ...OPPONENT_HOME };
  /** Where the player's hand is heading; a swing pushes it forward of the rest plane. */
  target: Vec3 = { ...PLAYER_HOME };
  /** Held keyboard direction per axis (-1, 0, or 1), moving the hand at a steady speed. */
  drive = { x: 0, y: 0 };
  previousBall: Vec3 = { ...this.ball };
  previousPlayer: Vec3 = { ...this.player };
  previousOpponent: Vec3 = { ...this.opponent };
  /** Contacts since the last frame; the view drains this. */
  impacts: Impact[] = [];
  phase: Phase = "ready";
  rally = 0;
  best = 0;
  /** Whether the ball in play has touched the net. */
  netted = false;
  /** Seconds until a new ball is fed after a miss; zero while a ball is live. */
  nextBallIn = 0;
  private feeds = 0;

  start() {
    this.phase = "playing";
    this.feed();
  }

  togglePause() {
    if (this.phase === "ready") return;
    this.phase = this.phase === "paused" ? "playing" : "paused";
  }

  /** A fresh rally; the session best survives. */
  restart() {
    this.rally = 0;
    this.player = { ...PLAYER_HOME };
    this.opponent = { ...OPPONENT_HOME };
    this.target = { ...PLAYER_HOME };
    this.start();
  }

  /** Drive the hand forward; strength is 0–1. */
  swing(strength = 1) {
    if (this.phase === "playing")
      this.target.z = PLAYER_HOME.z - clamp(strength, 0, 1) * SWING.reach;
  }

  step(dt = STEP) {
    if (this.phase !== "playing" || dt <= 0) return;
    this.previousBall = { ...this.ball };
    this.previousPlayer = { ...this.player };
    this.previousOpponent = { ...this.opponent };
    this.moveRackets(dt);
    if (this.nextBallIn > 0) {
      this.nextBallIn -= dt;
      if (this.nextBallIn <= 0) {
        this.rally = 0;
        this.feed();
      }
      return;
    }
    air(this.velocity, this.spin, dt);

    // Resolve the earliest contact, then integrate the unused time. A hit must not
    // freeze a frame or skip a later table/net contact in the same tick.
    let remaining = dt;
    for (let contacts = 0; remaining > 0 && contacts < 4; contacts++) {
      const contact = this.nextContact(dt, remaining);
      const time = contact?.time ?? remaining;
      move(this.ball, this.velocity, time);
      remaining -= time;
      if (!contact) break;
      this.resolve(contact);
      if (this.nextBallIn > 0) break;
    }
    if (Math.abs(this.ball.z) > 2.05 || this.ball.y < -0.55 || Math.abs(this.ball.x) > 2) {
      this.miss();
    }
  }

  private moveRackets(dt: number) {
    const approach = (value: number, target: number, speed: number) =>
      value + clamp(target - value, -speed * dt, speed * dt);
    if (this.drive.x) this.target.x = this.player.x + this.drive.x * KEYBOARD_SPEED * dt;
    if (this.drive.y) this.target.y = this.player.y + this.drive.y * KEYBOARD_SPEED * dt;
    this.player.x = approach(this.player.x, clamp(this.target.x, -1.05, 1.05), HAND_SPEED);
    this.player.y = approach(this.player.y, clamp(this.target.y, 0.12, 1.05), HAND_SPEED);
    this.player.z = approach(this.player.z, this.target.z, SWING.speed);
    this.target.z = approach(this.target.z, PLAYER_HOME.z, SWING.recovery);

    // The AI predicts the intercept so diagonal shots are playable, but still beatable.
    const intercept = this.opponentIntercept();
    this.opponent.x = approach(this.opponent.x, intercept.x, OPPONENT_SPEED.x);
    this.opponent.y = approach(this.opponent.y, intercept.y, OPPONENT_SPEED.y);
  }

  private opponentIntercept() {
    if (this.velocity.z >= 0) return { x: clamp(this.ball.x, -0.86, 0.86), y: OPPONENT_HOME.y };
    const ball = { ...this.ball };
    const velocity = { ...this.velocity };
    const spin = { ...this.spin };
    for (let i = 0; i < 240 && ball.z > this.opponent.z; i++) {
      fly(ball, velocity, spin, STEP);
      if (ball.y < BALL_RADIUS && velocity.y < 0 && onTable(ball.x, ball.z)) {
        ball.y = BALL_RADIUS + (BALL_RADIUS - ball.y) * TABLE_RESTITUTION;
        bounceOffTable(velocity, spin);
      }
    }
    return { x: clamp(ball.x, -0.86, 0.86), y: clamp(ball.y, 0.15, 1.05) };
  }

  /** The earliest racket, table, or net contact within the tick's `remaining` seconds. */
  private nextContact(dt: number, remaining: number) {
    const elapsed = dt - remaining;
    const height = (t: number) => this.ball.y + this.velocity.y * t - 0.5 * GRAVITY * t * t;
    let contact: Contact | undefined;
    const within = () => contact?.time ?? remaining;

    for (const [surface, racket, previous, facing] of [
      ["player", this.player, this.previousPlayer, 1],
      ["opponent", this.opponent, this.previousOpponent, -1],
    ] as const) {
      const paddle = {
        x: (racket.x - previous.x) / dt,
        y: (racket.y - previous.y) / dt,
        z: (racket.z - previous.z) / dt,
      };
      const closing = this.velocity.z - paddle.z;
      if (closing * facing <= 0) continue;
      const z = lerp(previous.z, racket.z, elapsed / dt);
      const t = (z - facing * PADDLE_DEPTH - this.ball.z) / closing;
      if (t < 0 || t > within()) continue;
      const fraction = (elapsed + t) / dt;
      const offset = {
        x: this.ball.x + this.velocity.x * t - lerp(previous.x, racket.x, fraction),
        y: height(t) - lerp(previous.y, racket.y, fraction),
      };
      if (Math.hypot(offset.x, offset.y) > PADDLE_RADIUS + BALL_RADIUS) continue;
      contact = { surface, time: t, paddle, offset };
    }

    if (this.ball.y >= BALL_RADIUS) {
      const { y: vy } = this.velocity;
      const t = (vy + Math.sqrt(vy ** 2 + 2 * GRAVITY * (this.ball.y - BALL_RADIUS))) / GRAVITY;
      if (
        t >= 0 &&
        t <= within() &&
        onTable(this.ball.x + this.velocity.x * t, this.ball.z + this.velocity.z * t)
      ) {
        contact = { surface: "table", time: t };
      }
    }

    const t = (this.netFace() - this.ball.z) / this.velocity.z;
    if (
      t >= 0 &&
      t <= within() &&
      Math.abs(this.ball.x + this.velocity.x * t) <= TABLE.halfWidth + BALL_RADIUS &&
      height(t) >= -BALL_RADIUS &&
      height(t) <= TABLE.netHeight + BALL_RADIUS
    ) {
      contact = { surface: "net", time: t };
    }
    return contact;
  }

  /** The z the ball's centre reaches when its leading edge meets the net. */
  private netFace() {
    return -Math.sign(this.velocity.z) * BALL_RADIUS;
  }

  private resolve(contact: Contact) {
    const position = { ...this.ball };
    let speed: number;
    switch (contact.surface) {
      case "table":
        speed = -this.velocity.y;
        if (speed < DEAD_BALL_SPEED) return this.miss();
        this.ball.y = BALL_RADIUS;
        bounceOffTable(this.velocity, this.spin);
        break;
      case "net":
        speed = Math.abs(this.velocity.z);
        // Leave the ball just short of the net on the side it came from.
        this.ball.z = this.netFace() - Math.sign(this.velocity.z) * 0.0001;
        this.velocity.z *= -0.22;
        this.velocity.x *= 0.5;
        this.spin = { x: this.spin.x * -0.3, y: this.spin.y * 0.3, z: this.spin.z * 0.3 };
        this.netted = true;
        break;
      case "player": {
        speed = Math.abs(this.velocity.z - contact.paddle.z);
        this.ball.z -= 0.0001;
        const shot = playerReturn(
          this.ball,
          this.velocity,
          this.spin,
          contact.paddle,
          contact.offset,
        );
        this.velocity = shot.velocity;
        this.spin = shot.spin;
        this.rally++;
        this.best = Math.max(this.best, this.rally);
        this.netted = false;
        break;
      }
      case "opponent": {
        speed = Math.abs(this.velocity.z - contact.paddle.z);
        this.ball.z += 0.0001;
        // Vary placement and sidespin through the rally so returns are not all the same.
        this.playToPlayer(Math.sin(this.rally * 1.7 + this.feeds) * 0.32, {
          x: 32,
          y: Math.sin(this.rally * 2.3 + this.feeds) * 14,
          z: 0,
        });
        break;
      }
    }
    this.impacts.push({ surface: contact.surface, position, speed });
  }

  /** Send the ball from where it is to land at `x`, deep on the player's side. */
  private playToPlayer(x: number, spin: Vec3) {
    this.velocity = aimShot(this.ball, { x, z: AI_SHOT.depth }, AI_SHOT.speed, spin);
    this.spin = { ...spin };
  }

  private feed() {
    this.ball = { ...FEED_FROM };
    this.playToPlayer(0, { x: 18, y: 0, z: 0 });
    this.previousBall = { ...this.ball };
    this.previousPlayer = { ...this.player };
    this.previousOpponent = { ...this.opponent };
    this.impacts.length = 0;
    this.nextBallIn = 0;
    this.netted = false;
    this.feeds++;
  }

  private miss() {
    this.nextBallIn = NEXT_BALL_DELAY;
    this.velocity = { x: 0, y: 0, z: 0 };
    this.spin = { x: 0, y: 0, z: 0 };
  }
}
