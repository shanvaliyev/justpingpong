import * as THREE from "three";

import type { Impact } from "./physics";
import { canvasTexture, seededRandom } from "./textures";

const PULSES = 4;
const SPARKS = 96;
/** Sparks draw as streaks this many seconds of their flight long. */
const SPARK_STREAK = 0.022;
/** Sparks and the contact light are brighter than white, so they bloom. */
const SPARK_COLOUR = new THREE.Color(0xffd9a0).multiplyScalar(3);
const FLASH_TIME = 0.09;

/** A jagged starburst with an inked edge: the contact flash an animator draws on a hit. */
function burstTexture() {
  return canvasTexture(256, 256, (ctx) => {
    const rand = seededRandom(1701);
    const star = (outer: number, inner: number) => {
      const points = 28;
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const radius = i % 2 === 0 ? outer * (0.6 + rand() * 0.4) : inner;
        ctx.lineTo(128 + Math.cos(angle) * radius, 128 + Math.sin(angle) * radius);
      }
      ctx.closePath();
    };
    star(120, 48);
    ctx.fillStyle = "#ffd84a";
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1b1433";
    ctx.stroke();
    star(82, 34);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  });
}

/**
 * Impact feedback: a starburst on every hit, and on racket hits a spray of streaking sparks and a
 * moment of real light that catches the blade, the ball, and the table. Bounces on the table and
 * net leave an expanding ring that marks where the ball landed.
 */
export function createImpactEffects() {
  const object = new THREE.Group();
  const flashMap = burstTexture();
  const pulses = Array.from({ length: PULSES }, () => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.045, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffedbd,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Flat, so one pass draws both faces exactly as a back-then-front pass would.
        forceSinglePass: true,
      }),
    );
    // Drawn over everything, like an effect painted on the cel above the scene.
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flashMap,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    flash.renderOrder = 1;
    ring.visible = flash.visible = false;
    object.add(ring, flash);
    return { ring, flash, age: 1, strength: 0, racket: false };
  });
  let nextPulse = 0;
  // Always present so hits never change the shaders; dark between racket hits.
  const light = new THREE.PointLight(0xffe0b0, 0, 1.6, 2);
  object.add(light);
  let lightAge = FLASH_TIME;
  let lightPeak = 0;

  // Each spark is a segment from where it is back along its flight.
  const sparkPositions = new Float32Array(SPARKS * 6);
  const sparkVelocity = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  const sparks = new THREE.LineSegments(
    sparkGeometry,
    new THREE.LineBasicMaterial({
      color: SPARK_COLOUR,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sparks.frustumCulled = false;
  object.add(sparks);
  let nextSpark = 0;
  // Spark positions upload only while some fly, plus once more to park the last ones out of sight.
  let sparksFlying = true;

  const burst = (at: THREE.Vector3, direction: number, strength: number) => {
    for (let n = Math.round(6 + strength * 16); n > 0; n--) {
      const i = nextSpark++ % SPARKS;
      sparkPositions.set([at.x, at.y, at.z, at.x, at.y, at.z], i * 6);
      const speed = 1.2 + Math.random() * 3 * strength;
      const angle = Math.random() * Math.PI * 2;
      sparkVelocity.set(
        [
          Math.cos(angle) * speed * 0.7,
          Math.sin(angle) * speed * 0.7 + 0.6,
          direction * speed * (0.4 + Math.random() * 0.6),
        ],
        i * 3,
      );
      sparkLife[i] = 0.18 + Math.random() * 0.2;
    }
  };

  return {
    object,
    /** `strength` is roughly 0–1; `facing` turns net rings towards the camera. */
    add(impact: Impact, strength: number, facing: THREE.Quaternion) {
      const pulse = pulses[nextPulse++ % PULSES];
      const racket = impact.surface === "player" || impact.surface === "opponent";
      pulse.age = 0;
      pulse.strength = strength;
      pulse.racket = racket;
      pulse.ring.position.copy(impact.position);
      if (impact.surface === "table") {
        // Lie flat, just above the table so the ring is not hidden in it.
        pulse.ring.position.y = 0.006;
        pulse.ring.rotation.set(-Math.PI / 2, 0, 0);
      } else {
        pulse.ring.quaternion.copy(facing);
      }
      pulse.flash.position.copy(pulse.ring.position);
      pulse.flash.material.rotation = Math.random() * Math.PI * 2;
      if (!racket) return;
      burst(pulse.flash.position, impact.surface === "player" ? -1 : 1, strength);
      light.position.copy(pulse.flash.position);
      lightAge = 0;
      lightPeak = 0.2 + strength * 0.8;
    },
    update(dt: number) {
      for (const pulse of pulses) {
        pulse.age += dt;
        const ring = pulse.age / 0.2;
        pulse.ring.visible = ring < 1 && !pulse.racket;
        pulse.ring.scale.setScalar(1 + ring * (1 + pulse.strength * 1.5));
        pulse.ring.material.opacity = Math.max(0, 1 - ring) * 0.55;
        // The burst pops to full size at once, holds, then fades out fast.
        const flash = pulse.age / 0.12;
        pulse.flash.visible = flash < 1 && (pulse.racket || pulse.strength > 0.35);
        pulse.flash.scale.setScalar(
          (pulse.racket ? 0.06 + 0.22 * pulse.strength : 0.05) *
            (0.7 + 0.3 * Math.min(1, flash * 4)),
        );
        pulse.flash.material.opacity = Math.min(1, (1 - flash) * 2.5) * (pulse.racket ? 1 : 0.7);
      }
      lightAge += dt;
      const fade = Math.max(0, 1 - lightAge / FLASH_TIME);
      light.intensity = lightPeak * fade * fade;
      let flying = false;
      for (let i = 0; i < SPARKS; i++) {
        const head = i * 6;
        if (sparkLife[i] <= 0) {
          sparkPositions[head + 1] = sparkPositions[head + 4] = -100;
          continue;
        }
        flying = true;
        sparkLife[i] -= dt;
        sparkVelocity[i * 3 + 1] -= 6 * dt;
        // Air drag slows them, so the streaks shorten as they die.
        const drag = Math.exp(-dt * 4);
        for (let axis = 0; axis < 3; axis++) {
          const velocity = (sparkVelocity[i * 3 + axis] *= drag);
          sparkPositions[head + axis] += velocity * dt;
          sparkPositions[head + 3 + axis] = sparkPositions[head + axis] - velocity * SPARK_STREAK;
        }
      }
      if (flying || sparksFlying) sparkGeometry.attributes.position.needsUpdate = true;
      sparksFlying = flying;
    },
  };
}
