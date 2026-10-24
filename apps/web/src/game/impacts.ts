import * as THREE from "three";

import type { Impact } from "./physics";
import { radialTexture } from "./textures";

const PULSES = 4;
const SPARKS = 96;

/** Impact feedback: an expanding ring, a quick flash, and a burst of sparks on racket hits. */
export function createImpactEffects() {
  const object = new THREE.Group();
  const pulses = Array.from({ length: PULSES }, () => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.045, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffedbd,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture("rgba(255,246,220,1)", "rgba(255,200,120,0)"),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    ring.visible = flash.visible = false;
    object.add(ring, flash);
    return { ring, flash, age: 1, strength: 0, racket: false };
  });
  let nextPulse = 0;

  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkVelocity = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  const sparks = new THREE.Points(
    sparkGeometry,
    new THREE.PointsMaterial({
      size: 0.024,
      map: radialTexture("rgba(255,240,200,1)", "rgba(255,180,90,0)"),
      color: 0xffe2a8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sparks.frustumCulled = false;
  object.add(sparks);
  let nextSpark = 0;

  const burst = (at: THREE.Vector3, direction: number, strength: number) => {
    for (let n = Math.round(4 + strength * 12); n > 0; n--) {
      const i = nextSpark++ % SPARKS;
      sparkPositions.set([at.x, at.y, at.z], i * 3);
      const speed = 0.8 + Math.random() * 2.2 * strength;
      const angle = Math.random() * Math.PI * 2;
      sparkVelocity.set(
        [
          Math.cos(angle) * speed * 0.7,
          Math.sin(angle) * speed * 0.7 + 0.6,
          direction * speed * (0.4 + Math.random() * 0.6),
        ],
        i * 3,
      );
      sparkLife[i] = 0.25 + Math.random() * 0.2;
    }
  };

  return {
    object,
    /** `strength` is roughly 0–1; `facing` turns racket and net rings towards the camera. */
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
      if (racket) burst(pulse.flash.position, impact.surface === "player" ? -1 : 1, strength);
    },
    update(dt: number) {
      for (const pulse of pulses) {
        pulse.age += dt;
        const ring = pulse.age / 0.2;
        pulse.ring.visible = ring < 1;
        pulse.ring.scale.setScalar(1 + ring * (1 + pulse.strength * 1.5));
        pulse.ring.material.opacity = Math.max(0, 1 - ring) * 0.7;
        const flash = pulse.age / 0.11;
        pulse.flash.visible = flash < 1 && (pulse.racket || pulse.strength > 0.35);
        pulse.flash.scale.setScalar((0.05 + 0.2 * pulse.strength) * (0.6 + flash));
        pulse.flash.material.opacity =
          (1 - flash) * (pulse.racket ? 0.9 : 0.4) * (0.4 + pulse.strength);
      }
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) {
          sparkPositions[i * 3 + 1] = -100;
          continue;
        }
        sparkLife[i] -= dt;
        sparkVelocity[i * 3 + 1] -= 6 * dt;
        for (let axis = 0; axis < 3; axis++) {
          sparkPositions[i * 3 + axis] += sparkVelocity[i * 3 + axis] * dt;
        }
      }
      sparkGeometry.attributes.position.needsUpdate = true;
    },
  };
}
