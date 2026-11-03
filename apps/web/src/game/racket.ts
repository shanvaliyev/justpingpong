import * as THREE from "three";

import { clamp, type Vec3 } from "./physics";
import { canvasTexture } from "./textures";
import { toonMaterial } from "./toon";

// Real shakehand racket proportions in metres (ITTF-sized blade, flared handle), drawn a little
// larger than life so it still reads at game distance. The physics contact circle stays separate.
const SCALE = 1.5;
const BLADE = { halfWidth: 0.075, halfHeight: 0.079, wood: 0.0058, rubber: 0.0021 };
const HANDLE = { archY: -0.064, archRadius: 0.017, thickness: 0.024, bevel: 0.0065 };
// The racket hand: handles point back toward it, so the blade fans out around the body.
const HAND = { x: 0.22, y: -0.1 };
const SUBSTEP = 1 / 240;
// Motion smear behind a fast racket: the band its blade swept over the last few frames.
const SMEAR_SAMPLES = 8;
const SMEAR_TIME = 0.075;
const SMEAR_SPEED = { from: 1.2, full: 4 };
// Rubber colours, punchier than real sheets.
const RED = "#e8233f";
const BLACK = "#2e3142";

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

type Layer = [colour: string, share: number];

/**
 * Layers seen edge-on, such as a blade's plies or a rubber's sponge under its topsheet. Extruded
 * side walls take v = 1 - z, so the layers repeat once over `thickness` metres below z = `top`,
 * the first layer outermost.
 */
function layerTexture(layers: Layer[], top: number, thickness: number) {
  const height = 128;
  const total = layers.reduce((sum, [, share]) => sum + share, 0);
  const texture = canvasTexture(4, height, (ctx) => {
    // Canvas rows run down while v runs up: the outermost layer is the bottom row.
    let y = height;
    for (const [colour, share] of layers) {
      const rows = (share / total) * height;
      ctx.fillStyle = colour;
      ctx.fillRect(0, y - rows, 4, rows);
      y -= rows;
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1 / thickness);
  const start = (1 - top) / thickness;
  texture.offset.y = Math.ceil(start) - start;
  return texture;
}

/** Map a canvas onto the blade's bounding box: extruded caps use metre coordinates as UVs. */
function onBlade(texture: THREE.Texture) {
  texture.repeat.set(1 / (BLADE.halfWidth * 2), 1 / (BLADE.halfHeight * 2));
  texture.offset.set(0.5, 0.5);
  return texture;
}

/** A rubber's face: flat colour with the maker's print above the handle. */
function rubberTexture(colour: string) {
  return onBlade(
    canvasTexture(512, 512, (ctx) => {
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = "#ffd36b";
      ctx.textAlign = "center";
      ctx.font = "900 italic 30px system-ui, sans-serif";
      ctx.fillText("JPP", 256, 356);
      ctx.fillRect(220, 368, 72, 4);
    }),
  );
}

/**
 * The handle's faces: flat strips of pale and dark wood laminated along its length, with a
 * maker's badge on the flare below the blade.
 */
function handleTexture() {
  const width = 256;
  const height = 864;
  const texture = canvasTexture(width, height, (ctx) => {
    const metre = width / 0.04;
    // Strips from the centre line outwards, mirrored on both sides.
    const strips: [string, number][] = [
      ["#e2a964", 0.0042],
      ["#5a2d18", 0.004],
      ["#f4d39a", 0.02],
    ];
    for (const side of [-1, 1]) {
      let x = 0;
      for (const [colour, size] of strips) {
        ctx.fillStyle = colour;
        const from = width / 2 + side * x * metre;
        const to = width / 2 + side * (x + size) * metre;
        ctx.fillRect(Math.min(from, to), 0, Math.abs(to - from), height);
        x += size;
      }
    }
    // The badge: a gold oval with the maker's mark, inked like the rest of the frame.
    const badgeY = height * (1 - (0.175 - 0.098) / 0.135);
    ctx.fillStyle = "#f2c64e";
    ctx.beginPath();
    ctx.ellipse(width / 2, badgeY, 0.0085 * metre, 0.0125 * metre, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a1530";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = "#9b1420";
    ctx.font = "900 italic 46px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("J", width / 2, badgeY + 2);
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
  // Extrusion groups: 0 is the (hidden) faces under the rubber, 1 is the edge, where the plies
  // show as pale wood with a dark carbon line under each face.
  const plies = layerTexture(
    [
      ["#eec48a", 0.2],
      ["#2b2230", 0.1],
      ["#f7dca8", 0.4],
      ["#2b2230", 0.1],
      ["#eec48a", 0.2],
    ],
    BLADE.wood,
    BLADE.wood,
  );
  model.add(
    shadowed(
      new THREE.Mesh(wood, [toonMaterial({ color: 0xf2d29c }), toonMaterial({ map: plies })]),
    ),
  );
  const sheetDepth = BLADE.rubber - 0.0008;
  const sheet = new THREE.ExtrudeGeometry(blade, {
    depth: sheetDepth,
    bevelEnabled: true,
    bevelThickness: 0.0004,
    bevelSize: 0.0002,
    bevelSegments: 2,
    curveSegments: 40,
  });
  sheet.translate(0, 0, 0.0004);
  // The faces glow a little in their own colour, as anime keeps a hero prop readable even with
  // the light behind it.
  const rubber = (colour: string) =>
    toonMaterial({ map: rubberTexture(colour), emissive: colour, emissiveIntensity: 0.3 });
  // On the sheet's edge, the topsheet sits over a thick orange sponge.
  const edge = (topsheet: string) =>
    toonMaterial({
      map: layerTexture(
        [
          [topsheet, 0.3],
          ["#ffb13d", 0.7],
        ],
        sheetDepth + 0.0004,
        BLADE.rubber,
      ),
    });
  for (const [face, side, direction] of [
    [rubber(RED), edge(RED), 1],
    [rubber(BLACK), edge(BLACK), -1],
  ] as const) {
    const mesh = shadowed(new THREE.Mesh(sheet, [face, side]));
    // Turning the back sheet around keeps its print readable from that side.
    mesh.rotation.y = direction === 1 ? 0 : Math.PI;
    mesh.position.z = (direction * BLADE.wood) / 2;
    model.add(mesh);
  }
  // The handle's faces show its laminated strips; its sides show the blade running through the
  // middle between the two pale wings.
  const handleDepth = HANDLE.thickness - 2 * HANDLE.bevel;
  const handleSide = layerTexture(
    [
      ["#f4d39a", 0.4],
      ["#2b2230", 0.04],
      ["#f7dca8", 0.12],
      ["#2b2230", 0.04],
      ["#f4d39a", 0.4],
    ],
    handleDepth + HANDLE.bevel,
    HANDLE.thickness,
  );
  model.add(
    shadowed(
      new THREE.Mesh(handleGeometry(), [
        toonMaterial({ map: handleTexture() }),
        toonMaterial({ map: handleSide }),
      ]),
    ),
  );
  return model;
}

/** The band a fast blade sweeps: its centre and the half-width across its motion, frame by frame. */
function createSmear() {
  const rows = 3;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(SMEAR_SAMPLES * rows * 3);
  const colours = new Float32Array(SMEAR_SAMPLES * rows * 4);
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colours, 4).setUsage(THREE.DynamicDrawUsage),
  );
  const index: number[] = [];
  for (let i = 0; i < SMEAR_SAMPLES - 1; i++) {
    for (let row = 0; row < rows - 1; row++) {
      const a = i * rows + row;
      index.push(a, a + rows, a + 1, a + 1, a + rows, a + rows + 1);
    }
  }
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Flat and see-through, so one pass draws both faces.
      forceSinglePass: true,
    }),
  );
  mesh.frustumCulled = false;
  mesh.visible = false;
  const samples = Array.from({ length: SMEAR_SAMPLES }, () => ({
    centre: new THREE.Vector3(),
    across: new THREE.Vector3(),
    opacity: 0,
    age: SMEAR_TIME,
  }));
  return {
    mesh,
    /** Record where the blade is now; `opacity` 0 records a still or edge-on blade. */
    add(centre: THREE.Vector3, across: THREE.Vector3, opacity: number, dt: number) {
      for (const sample of samples) sample.age += dt;
      const sample = samples.pop()!;
      sample.centre.copy(centre);
      sample.across.copy(across);
      sample.opacity = opacity;
      sample.age = 0;
      samples.unshift(sample);
      let visible = false;
      samples.forEach((s, i) => {
        const fade = Math.max(0, 1 - s.age / SMEAR_TIME);
        const alpha = s.opacity * fade * fade;
        if (alpha > 0.01 && i > 0) visible = true;
        for (let row = 0; row < rows; row++) {
          const offset = row - 1;
          const vertex = i * rows + row;
          positions[vertex * 3] = s.centre.x + s.across.x * offset;
          positions[vertex * 3 + 1] = s.centre.y + s.across.y * offset;
          positions[vertex * 3 + 2] = s.centre.z + s.across.z * offset;
          colours.set([1, 0.97, 0.93, offset === 0 ? alpha : alpha * 0.15], vertex * 4);
        }
      });
      mesh.visible = visible;
      if (!visible) return;
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

/**
 * A shakehand racket with a sprung wrist pose, drawing a clone of `model`. Its origin is the blade
 * centre, which matches the physics contact point; every rotation pivots there so the visible
 * blade stays on the hitbox. `object` holds the racket; `smear` is its motion blur, in world space.
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
  const smear = createSmear();

  const roll = spring(20, 0.6);
  const pitch = spring(20, 0.6);
  const yaw = spring(24, 0.75);
  const kick = spring(32, 0.5);
  // The -z face points across the table at yaw 0; a half turn presents the other rubber.
  const forehandYaw = options.forehand === "black" ? 0 : Math.PI;
  const phase = side === 1 ? 0 : 2.1;
  const velocity = { x: 0, y: 0, z: 0 };
  const centre = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const motion = new THREE.Vector3();
  const across = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  let last: Vec3 | undefined;
  let backhand = false;
  let time = 0;

  return {
    object: root,
    smear: smear.mesh,
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
      if (dt <= 0) return;

      // The smear spans the blade across its motion within the blade's plane, so it covers what
      // a camera shutter would see the blade sweep. A blade moving edge-on sweeps nothing.
      root.updateMatrixWorld();
      pose.getWorldPosition(centre);
      normal.set(0, 0, 1).applyQuaternion(pose.getWorldQuaternion(turn));
      motion.set(velocity.x * side, velocity.y, velocity.z * side);
      const speed = motion.length();
      across.crossVectors(normal, motion);
      const swept = speed > 0 ? across.length() / speed : 0;
      across.normalize().multiplyScalar(BLADE.halfWidth * SCALE * 0.95);
      const opacity =
        clamp((speed - SMEAR_SPEED.from) / (SMEAR_SPEED.full - SMEAR_SPEED.from), 0, 1) *
        swept *
        0.32;
      smear.add(centre, across, opacity, dt);
    },
    /** Knock the face back after contact; strength is roughly 0–1. */
    hit(strength: number) {
      pitch.velocity += 7 * strength;
      kick.velocity += 0.5 * strength;
    },
  };
}
