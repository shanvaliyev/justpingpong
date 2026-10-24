import * as THREE from "three";

import { BALL_RADIUS, clamp, TABLE, type PracticePhysics } from "./physics";
import { canvasTexture, radialTexture } from "./textures";

// Streak behind fast balls: a camera-facing ribbon back along the flight, fading out. It is
// built from the velocity rather than past frames, so slow devices draw the same length.
const TRAIL_POINTS = 10;
const TRAIL_TIME = 0.06;
const TRAIL_COLOR = new THREE.Color(0xffe6bf);

/** Orange ball with a seam and a small print, so its spin is visible in flight. */
function ballTexture() {
  return canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = "#ff9126";
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(0, 62, 256, 4);
    ctx.fillStyle = "#b44a07";
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("★★★", 64, 44);
    ctx.font = "800 11px system-ui, sans-serif";
    ctx.fillText("JPP 40+", 192, 92);
  });
}

function createTrail() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(TRAIL_POINTS * 2 * 3);
  const colors = new Float32Array(TRAIL_POINTS * 2 * 4);
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage),
  );
  const index: number[] = [];
  for (let i = 0; i < TRAIL_POINTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false;
  return { mesh, positions, colors };
}

/** The ball, its halo, its shadow on the table, and the speed streak. */
export function createBall() {
  // The root follows the flight and stretches with speed; the mesh inside spins.
  const root = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({
    map: ballTexture(),
    roughness: 0.42,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    emissive: 0xff7a14,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 20), material);
  ball.castShadow = true;
  root.add(ball);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture("rgba(255,214,150,0.9)", "rgba(255,170,80,0)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({
      map: radialTexture("rgba(8,16,30,0.55)", "rgba(8,16,30,0)"),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  const trail = createTrail();
  const object = new THREE.Group().add(root, glow, shadow, trail.mesh);

  let glowLevel = 0;
  const spinAxis = new THREE.Vector3();
  const spinTurn = new THREE.Quaternion();
  const spinRotation = new THREE.Quaternion();
  const stretch = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const travel = new THREE.Vector3();
  const side = new THREE.Vector3();
  const view = new THREE.Vector3();

  return {
    object,
    /** Ambient glow for the court's light: dusk courts make the ball glow more. */
    setGlow(level: number) {
      glowLevel = level;
      material.emissiveIntensity = 0.08 + level * 0.4;
    },
    update(game: PracticePhysics, alpha: number, dt: number, eye: THREE.Vector3) {
      const { velocity } = game;
      root.position.lerpVectors(game.previousBall, game.ball, alpha);
      const position = root.position;
      const visible = game.nextBallIn <= 0;
      root.visible = visible;
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      // Spin the printed ball by its angular velocity, then stretch the root along its flight.
      const spin = Math.hypot(game.spin.x, game.spin.y, game.spin.z);
      if (spin > 0 && dt > 0) {
        spinAxis.set(game.spin.x, game.spin.y, game.spin.z).divideScalar(spin);
        spinRotation.premultiply(spinTurn.setFromAxisAngle(spinAxis, spin * dt)).normalize();
      }
      const stretchAmount = clamp((speed - 4) * 0.02, 0, 0.22);
      if (speed > 0.01) {
        stretch.setFromUnitVectors(
          up,
          travel.set(velocity.x, velocity.y, velocity.z).divideScalar(speed),
        );
      }
      root.quaternion.copy(stretch);
      root.scale.set(1 - stretchAmount * 0.4, 1 + stretchAmount, 1 - stretchAmount * 0.4);
      ball.quaternion.copy(stretch).invert().multiply(spinRotation);

      glow.visible = visible;
      glow.position.copy(position);
      glow.scale.setScalar(0.1 + clamp(speed / 12, 0, 1) * 0.06);
      glow.material.opacity = glowLevel + clamp((speed - 5) / 6, 0, 1) * 0.3;
      shadow.visible =
        visible &&
        Math.abs(position.x) < TABLE.halfWidth &&
        Math.abs(position.z) < TABLE.halfLength;
      shadow.position.set(position.x, 0.003, position.z);
      shadow.scale.setScalar(0.8 + position.y * 1.6);
      shadow.material.opacity = clamp(1 - position.y * 1.4, 0.15, 1);

      const streak = visible ? clamp((speed - 3.5) / 6, 0, 1) * 0.6 : 0;
      trail.mesh.visible = streak > 0;
      if (!trail.mesh.visible) return;
      view.subVectors(eye, position);
      side.crossVectors(travel, view).normalize();
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const head = i / (TRAIL_POINTS - 1);
        const back = (1 - head) * TRAIL_TIME;
        // Follow gravity's curve back along the flight.
        const x = position.x - velocity.x * back;
        const y = position.y - velocity.y * back - 4.9 * back * back;
        const z = position.z - velocity.z * back;
        const width = BALL_RADIUS * (0.2 + 0.8 * head);
        trail.positions.set([x + side.x * width, y + side.y * width, z + side.z * width], i * 6);
        trail.positions.set(
          [x - side.x * width, y - side.y * width, z - side.z * width],
          i * 6 + 3,
        );
        const opacity = head * head * streak;
        for (const offset of [0, 4]) {
          trail.colors.set([TRAIL_COLOR.r, TRAIL_COLOR.g, TRAIL_COLOR.b, opacity], i * 8 + offset);
        }
      }
      trail.mesh.geometry.attributes.position.needsUpdate = true;
      trail.mesh.geometry.attributes.color.needsUpdate = true;
    },
  };
}
