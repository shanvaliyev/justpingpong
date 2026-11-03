import * as THREE from "three";

import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { TABLE } from "./physics";
import { FLOOR_Y } from "./scenery";
import { canvasTexture, radialTexture } from "./textures";
import { toonMaterial } from "./toon";

const TOP_WIDTH = 1024;
const TOP_HEIGHT = Math.round((TOP_WIDTH * TABLE.halfLength) / TABLE.halfWidth);
/** The net and its posts reach 15.25 cm beyond each side line, as on a regulation table. */
const NET_HALF_WIDTH = TABLE.halfWidth + 0.1525;

/**
 * Tournament blue as an anime background painter would do it: one flat colour, crisp white lines,
 * and slanted streaks of reflected sky across each half to say "glossy".
 */
function tableTexture() {
  const width = TOP_WIDTH;
  const height = TOP_HEIGHT;
  const scale = width / (TABLE.halfWidth * 2);
  return canvasTexture(width, height, (ctx) => {
    ctx.fillStyle = "#1f5cb0";
    ctx.fillRect(0, 0, width, height);
    // A wide and a thin streak on each half, rising to the right.
    ctx.fillStyle = "rgba(220, 238, 255, 0.16)";
    for (const at of [0.2, 0.68]) {
      for (const [from, size] of [
        [0, 0.07],
        [0.095, 0.018],
      ]) {
        const y = (at + from) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y - width * 0.45);
        ctx.lineTo(width, y - width * 0.45 + size * height);
        ctx.lineTo(0, y + size * height);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#f6f3ea";
    const line = 0.02 * scale;
    ctx.fillRect(0, 0, line, height);
    ctx.fillRect(width - line, 0, line, height);
    ctx.fillRect(0, 0, width, line);
    ctx.fillRect(0, height - line, width, line);
    ctx.fillRect(width / 2 - 0.0015 * scale, 0, 0.003 * scale, height);
  });
}

/** Knotted navy cord in 13 mm squares, with a heavier cord along the bottom and ends. */
function netTexture() {
  const width = 1024;
  const perMetre = width / (NET_HALF_WIDTH * 2);
  const height = Math.round(perMetre * TABLE.netHeight);
  const texture = canvasTexture(width, height, (ctx) => {
    ctx.strokeStyle = "rgba(14, 20, 34, 0.92)";
    ctx.lineWidth = 1.3;
    const cell = perMetre * 0.013;
    for (let x = cell / 2; x < width; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = height - cell / 2; y > 0; y -= cell) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(14, 20, 34, 0.95)";
    ctx.fillRect(0, height - 3, width, 3);
    ctx.fillRect(0, 0, 4, height);
    ctx.fillRect(width - 4, 0, 4, height);
  });
  return texture;
}

/** A soft dark band, densest along its centre line; contact shade where the net meets the top. */
function bandTexture() {
  return canvasTexture(4, 64, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "rgba(4,8,18,0)");
    gradient.addColorStop(0.5, "rgba(4,8,18,0.55)");
    gradient.addColorStop(1, "rgba(4,8,18,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 64);
  });
}

/**
 * A tournament table and net, with soft contact shade where they meet the floor and each other.
 * Every solid part casts shadows. Parts sharing a material are merged into one mesh, so the table
 * costs a few draw calls in each pass rather than one per leg, brace, and clamp.
 */
export function createTable() {
  const object = new THREE.Group();
  // Dark navy steel, the way tournament chassis are finished.
  const steel = toonMaterial({ color: 0x252d44 });
  const rubberFoot = toonMaterial({ color: 0x15161c });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    object.add(mesh);
    return mesh;
  };
  /** Parts merged into one geometry around their centre, so a mesh there sorts by its real depth. */
  const merged = (parts: THREE.BufferGeometry[]) => {
    // Rounded boxes come unindexed; merging needs every part alike.
    const geometry = mergeGeometries(
      parts.map((part) => (part.index ? part.toNonIndexed() : part)),
    )!;
    for (const part of parts) part.dispose();
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    return { geometry, centre };
  };
  const solid = (parts: THREE.BufferGeometry[], material: THREE.Material) => {
    const { geometry, centre } = merged(parts);
    add(geometry, material).position.copy(centre);
  };
  const frame: THREE.BufferGeometry[] = [];
  const footParts: THREE.BufferGeometry[] = [];
  /** A steel bar from `a` to `b`, `size` metres square in section. */
  const bar = (a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, size: number) => {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const geometry = new RoundedBoxGeometry(size, from.distanceTo(to), size, 1, size * 0.18);
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.clone().sub(from).normalize(),
      ),
    );
    const middle = from.add(to).multiplyScalar(0.5);
    frame.push(geometry.translate(middle.x, middle.y, middle.z));
  };

  // A 25 mm top with painted lines over a darker edge.
  const top = toonMaterial({ map: tableTexture() });
  const edge = toonMaterial({ color: 0x173d73 });
  add(
    new RoundedBoxGeometry(TABLE.halfWidth * 2, 0.025, TABLE.halfLength * 2, 2, 0.004),
    edge,
  ).position.y = -0.0125;
  const surface = add(
    new THREE.PlaneGeometry(TABLE.halfWidth * 2 - 0.006, TABLE.halfLength * 2 - 0.006),
    top,
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.0002;
  // Opaque meshes draw in material order, which puts the steel frame first. Drawing the top
  // before everything lets the depth test skip the frame beneath it, instead of lighting the
  // frame and then painting over it.
  surface.renderOrder = -0.5;

  // Each folding half has its own apron: a deep steel skirt set in from the edge.
  const apron = { x: TABLE.halfWidth - 0.05, y: -0.06, depth: 0.07, size: 0.026 };
  for (const z of [-1, 1]) {
    const inner = z * 0.04;
    const outer = z * (TABLE.halfLength - 0.05);
    for (const x of [-apron.x, apron.x]) {
      frame.push(
        new THREE.BoxGeometry(apron.size, apron.depth, Math.abs(outer - inner)).translate(
          x,
          apron.y,
          (outer + inner) / 2,
        ),
      );
    }
    for (const at of [inner, outer]) {
      frame.push(
        new THREE.BoxGeometry(apron.x * 2, apron.depth, apron.size).translate(0, apron.y, at),
      );
    }
  }
  // Square-tube legs on each end, a low stretcher between them, and the folding chassis: two
  // rails along the table with struts up to each half's apron.
  const legX = 0.6;
  const legZ = 1.0;
  const footY = FLOOR_Y + 0.03;
  for (const z of [-legZ, legZ]) {
    for (const x of [-legX, legX]) {
      bar([x, apron.y - apron.depth / 2, z], [x, footY, z], 0.045);
      footParts.push(
        new THREE.CylinderGeometry(0.03, 0.036, 0.022, 20).translate(x, FLOOR_Y + 0.011, z),
        new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8).translate(x, FLOOR_Y + 0.03, z),
      );
    }
    bar([-legX, -0.5, z], [legX, -0.5, z], 0.035);
  }
  for (const x of [-0.24, 0.24]) {
    bar([x, -0.62, -legZ], [x, -0.62, legZ], 0.038);
    for (const z of [-1, 1]) bar([x, -0.62, z * 0.12], [x * 1.4, apron.y, z * 0.75], 0.026);
  }
  bar([-0.24, -0.62, 0], [0.24, -0.62, 0], 0.032);
  for (const z of [-legZ, legZ]) bar([-legX, -0.62, z], [legX, -0.62, z], 0.03);

  // Net posts: an upright beyond each side line on a clamp arm screwed under the table's edge.
  for (const x of [-1, 1]) {
    const post = x * (NET_HALF_WIDTH - 0.008);
    frame.push(
      new RoundedBoxGeometry(0.022, TABLE.netHeight + 0.004, 0.026, 1, 0.005).translate(
        post,
        (TABLE.netHeight + 0.004) / 2 - 0.004,
        0,
      ),
      new RoundedBoxGeometry(0.17, 0.018, 0.034, 1, 0.005).translate(
        x * (TABLE.halfWidth + 0.07),
        -0.012,
        0,
      ),
      new RoundedBoxGeometry(0.05, 0.05, 0.05, 1, 0.008).translate(
        x * (TABLE.halfWidth - 0.02),
        -0.05,
        0,
      ),
    );
    footParts.push(
      new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16).translate(
        x * (TABLE.halfWidth - 0.02),
        -0.08,
        0,
      ),
    );
  }
  solid(frame, steel);
  solid(footParts, rubberFoot);

  const netHeight = TABLE.netHeight - 0.015;
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(NET_HALF_WIDTH * 2 - 0.02, netHeight),
    toonMaterial({
      map: netTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      // Flat, so one pass draws both faces exactly as a back-then-front pass would.
      forceSinglePass: true,
      depthWrite: false,
    }),
  );
  net.position.y = netHeight / 2 + 0.002;
  object.add(net);
  // The white tape folds over the top cord, so it has a little thickness.
  add(
    new RoundedBoxGeometry(NET_HALF_WIDTH * 2 - 0.02, 0.016, 0.006, 1, 0.0025),
    toonMaterial({ color: 0xf6f3ea }),
  ).position.set(0, TABLE.netHeight - 0.008, 0);

  // Contact shade, drawn as flat cel shapes: the sky is hidden under the table, around each foot,
  // and where the net meets the top.
  const shade = (planes: THREE.BufferGeometry[], map: THREE.Texture) => {
    const { geometry, centre } = merged(planes);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
    );
    mesh.position.copy(centre);
    object.add(mesh);
  };
  const plane = (width: number, depth: number, x: number, y: number, z: number) =>
    new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(x, y, z);
  const floor = FLOOR_Y + 0.002;
  shade(
    [plane(2.4, 3.6, 0, floor, 0)],
    radialTexture("rgba(18,20,56,0.42)", "rgba(18,20,56,0)", 0.6),
  );
  const feet: THREE.BufferGeometry[] = [];
  for (const z of [-legZ, legZ]) {
    for (const x of [-legX, legX]) feet.push(plane(0.22, 0.22, x, floor, z));
  }
  shade(feet, radialTexture("rgba(18,20,56,0.6)", "rgba(18,20,56,0)", 0.5));
  shade([plane(TABLE.halfWidth * 2 - 0.01, 0.07, 0, 0.0006, 0)], bandTexture());
  return object;
}
