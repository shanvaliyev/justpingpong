import * as THREE from "three";

import { clamp, type Vec3 } from "./physics";
import { canvasTexture, grainNormalTexture, seededRandom } from "./textures";

// Real shakehand racket proportions in metres (ITTF-sized blade, flared handle), drawn a little
// larger than life so it still reads at game distance. The physics contact circle stays separate.
const SCALE = 1.5;
const BLADE = { halfWidth: 0.075, halfHeight: 0.079, wood: 0.0058, rubber: 0.0021 };
const HANDLE = { archY: -0.064, archRadius: 0.017, thickness: 0.024, bevel: 0.0065 };
// The racket hand: handles point back toward it, so the blade fans out around the body.
const HAND = { x: 0.22, y: -0.1 };
const SUBSTEP = 1 / 240;

class Spring {
  value = 0;
  velocity = 0;
  constructor(
    private stiffness: number,
    private damping: number,
  ) {}
  step(target: number, dt: number) {
    this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity) * dt;
    this.value += this.velocity * dt;
  }
}
const spring = (frequency: number, dampingRatio: number) =>
  new Spring(frequency * frequency, 2 * dampingRatio * frequency);

function rubberTexture(color: string, speckle: string) {
  const texture = canvasTexture(512, 512, (ctx) => {
    const rand = seededRandom(color.length * 7919);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = speckle;
    for (let i = 0; i < 9000; i++) ctx.fillRect(rand() * 512, rand() * 512, 1.5, 1.5);
    // A small brand print above the handle, like a real rubber sheet.
    ctx.fillStyle = "rgba(242, 212, 140, 0.9)";
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.letterSpacing = "3px";
    ctx.fillText("JUSTPINGPONG", 256, 362);
    ctx.fillRect(206, 372, 100, 2);
  });
  // Extruded caps use metre coordinates as UVs; map the blade's bounding box onto the canvas.
  texture.repeat.set(1 / (BLADE.halfWidth * 2), 1 / (BLADE.halfHeight * 2));
  texture.offset.set(0.5, 0.5);
  return texture;
}

function handleTexture() {
  const texture = canvasTexture(128, 512, (ctx) => {
    const rand = seededRandom(42);
    const base = ctx.createLinearGradient(0, 0, 128, 0);
    base.addColorStop(0, "#a8723f");
    base.addColorStop(0.5, "#c08a52");
    base.addColorStop(1, "#a8723f");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 512);
    // Grain runs along the handle; keep it soft because the extruded sides stretch it.
    for (let i = 0; i < 46; i++) {
      ctx.strokeStyle = `rgba(92, 50, 18, ${0.08 + rand() * 0.14})`;
      ctx.lineWidth = 0.6 + rand() * 1.6;
      const x = rand() * 128;
      const wave = 1 + rand() * 3;
      ctx.beginPath();
      for (let y = 0; y <= 512; y += 16) ctx.lineTo(x + Math.sin(y / 70 + i) * wave, y);
      ctx.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // Handle caps span x ∈ [-0.02, 0.02] and y ∈ [-0.175, -0.04].
  texture.repeat.set(1 / 0.04, 1 / 0.135);
  texture.offset.set(0.5, 0.175 / 0.135);
  return texture;
}

// The blade outline with the arch the handle shoulder sits in, as rubber sheets are cut.
function bladeShape() {
  const { halfWidth: a, halfHeight: b } = BLADE;
  const { archY, archRadius: r } = HANDLE;
  const start = -Math.acos(r / a);
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, a, b, start, -Math.PI - start, false, 0);
  shape.lineTo(-r, archY);
  shape.absarc(0, archY, r, Math.PI, 0, true);
  return shape;
}

function handleGeometry() {
  const { archY, archRadius, thickness, bevel } = HANDLE;
  // Outer half-widths from the shoulder to the flared butt; the bevel grows the inset outline back.
  const side: [number, number][] = [
    [0.0145, -0.085],
    [0.0138, -0.115],
    [0.016, -0.145],
    [0.0185, -0.161],
    [0.012, -0.1695],
  ];
  const inset = ([x, y]: [number, number]) =>
    new THREE.Vector2(x - Math.sign(x) * bevel, y < -0.165 ? y + bevel : y);
  const shape = new THREE.Shape();
  shape.absarc(0, archY, archRadius - bevel, 0, Math.PI, false);
  shape.splineThru([
    ...side.map(([x, y]) => inset([-x, y])),
    new THREE.Vector2(0, -0.171 + bevel),
    ...[...side].reverse().map(inset),
    new THREE.Vector2(archRadius - bevel, archY),
  ]);
  const depth = thickness - 2 * bevel;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 24,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/**
 * The racket's blade, rubbers, and handle, centred on the blade. Red rubber is on the model's +z
 * face, black on -z. Build it once: each racket draws a clone sharing its geometry, materials, and
 * textures.
 */
export function createRacketModel() {
  // Tacky rubber: fine pores break up its gloss, and sheen lights its rim at grazing angles.
  const pores = grainNormalTexture(64, 8, 31);
  pores.repeat.set(1 / 0.03, 1 / 0.03);
  const rubber = (map: THREE.Texture) =>
    new THREE.MeshPhysicalMaterial({
      map,
      normalMap: pores,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.5,
      clearcoat: 0.3,
      clearcoatRoughness: 0.5,
      sheen: 0.6,
      sheenRoughness: 0.4,
      sheenColor: 0xffffff,
      envMapIntensity: 0.5,
    });
  const shadowed = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    return mesh;
  };

  const model = new THREE.Group();
  model.scale.setScalar(SCALE);
  const blade = bladeShape();
  const wood = new THREE.ExtrudeGeometry(blade, {
    depth: BLADE.wood,
    bevelEnabled: false,
    curveSegments: 40,
  });
  wood.translate(0, 0, -BLADE.wood / 2);
  // Extrusion groups: 0 is the (hidden) faces under the rubber, 1 is the edge, wrapped in tape.
  model.add(
    shadowed(
      new THREE.Mesh(wood, [
        new THREE.MeshStandardMaterial({ color: 0xe8cc98, roughness: 0.6 }),
        new THREE.MeshPhysicalMaterial({
          color: 0x17181d,
          roughness: 0.35,
          metalness: 0.2,
          clearcoat: 0.6,
          envMapIntensity: 0.8,
        }),
      ]),
    ),
  );
  const sheet = new THREE.ExtrudeGeometry(blade, {
    depth: BLADE.rubber - 0.0008,
    bevelEnabled: true,
    bevelThickness: 0.0004,
    bevelSize: 0.0002,
    bevelSegments: 2,
    curveSegments: 40,
  });
  sheet.translate(0, 0, 0.0004);
  for (const [map, direction] of [
    [rubberTexture("#b0141c", "rgba(0, 0, 0, 0.12)"), 1],
    [rubberTexture("#141518", "rgba(255, 255, 255, 0.05)"), -1],
  ] as const) {
    const mesh = shadowed(new THREE.Mesh(sheet, rubber(map)));
    // Turning the back sheet around keeps its print readable from that side.
    mesh.rotation.y = direction === 1 ? 0 : Math.PI;
    mesh.position.z = (direction * BLADE.wood) / 2;
    model.add(mesh);
  }
  model.add(
    shadowed(
      new THREE.Mesh(
        handleGeometry(),
        new THREE.MeshPhysicalMaterial({
          map: handleTexture(),
          roughness: 0.42,
          clearcoat: 0.6,
          clearcoatRoughness: 0.3,
          envMapIntensity: 0.7,
        }),
      ),
    ),
  );
  return model;
}

/**
 * A shakehand racket with a sprung wrist pose, drawing a clone of `model`. Its origin is the blade
 * centre, which matches the physics contact point; every rotation pivots there so the visible
 * blade stays on the hitbox.
 */
export function createRacket(
  model: THREE.Object3D,
  options: { side: 1 | -1; forehand: "red" | "black" },
) {
  const { side } = options;
  // root: contact point, turned to face across the table. pose: the animated wrist.
  const root = new THREE.Group();
  root.rotation.y = side === 1 ? 0 : Math.PI;
  const pose = new THREE.Group();
  pose.rotation.order = "ZXY";
  pose.add(model.clone());
  root.add(pose);

  const roll = spring(20, 0.6);
  const pitch = spring(20, 0.6);
  const yaw = spring(24, 0.75);
  const kick = spring(32, 0.5);
  // The -z face points across the table at yaw 0; a half turn presents the other rubber.
  const forehandYaw = options.forehand === "black" ? 0 : Math.PI;
  const phase = side === 1 ? 0 : 2.1;
  const velocity = { x: 0, y: 0, z: 0 };
  let last: Vec3 | undefined;
  let backhand = false;
  let time = 0;

  return {
    object: root,
    update(position: Vec3, dt: number) {
      root.position.set(position.x, position.y, position.z);
      // Work in the racket owner's frame: +x is their forehand side, -z is towards the net.
      const local = { x: position.x * side, y: position.y, z: position.z * side };
      const first = !last;
      if (last && dt > 0) {
        const blend = 1 - Math.exp(-dt * 30);
        for (const axis of ["x", "y", "z"] as const) {
          velocity[axis] += ((local[axis] - last[axis]) / dt - velocity[axis]) * blend;
        }
      }
      last = local;
      time += dt;
      // Hysteresis stops the red/black flip chattering as the hand crosses the middle.
      if (backhand ? local.x > 0.08 : local.x < -0.05) backhand = !backhand;
      if (first) backhand = local.x < 0;

      const forward = -velocity.z;
      const targets = {
        // The handle points back towards the hand; sideways speed makes the head trail behind.
        roll:
          clamp(Math.atan2(HAND.x - local.x, local.y - HAND.y), -1, 1) +
          clamp(velocity.x * 0.1, -0.35, 0.35) +
          Math.sin(time * 1.3 + phase) * 0.02,
        // Open for a block, close for a drive. The rubber-side flip is visual only;
        // neither colour changes the rebound or the blade-centred contact point.
        pitch: 0.11 - clamp(forward * 0.1, 0, 0.35) + Math.sin(time * 1.9 + phase) * 0.012,
        yaw:
          forehandYaw +
          (backhand ? Math.PI : 0) +
          clamp(local.x * 0.35, -0.4, 0.4) +
          clamp(forward * 0.08, -0.1, 0.3) * (backhand ? -1 : 1),
      };
      if (first) {
        roll.value = targets.roll;
        pitch.value = targets.pitch;
        yaw.value = targets.yaw;
      }
      for (let remaining = dt; remaining > 0; remaining -= SUBSTEP) {
        const step = Math.min(SUBSTEP, remaining);
        roll.step(targets.roll, step);
        pitch.step(targets.pitch, step);
        yaw.step(targets.yaw, step);
        kick.step(0, step);
      }
      pose.rotation.set(pitch.value, yaw.value, roll.value);
      pose.position.z = kick.value;
    },
    /** Knock the face back after contact; strength is roughly 0–1. */
    hit(strength: number) {
      pitch.velocity += 7 * strength;
      kick.velocity += 0.5 * strength;
    },
  };
}
