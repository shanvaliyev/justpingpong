import * as THREE from "three";

import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { TABLE } from "./physics";
import { FLOOR_Y } from "./scenery";
import { canvasTexture, grainNormalTexture, radialTexture, seededRandom } from "./textures";

/** Tournament-blue top with painted lines and a faint matte grain. */
function tableTexture() {
  const width = 512;
  const height = Math.round((width * TABLE.halfLength) / TABLE.halfWidth);
  const scale = width / (TABLE.halfWidth * 2);
  return canvasTexture(width, height, (ctx) => {
    // Grain over #174f8c, written directly: reading pixels back from a canvas is slow.
    const image = ctx.createImageData(width, height);
    const rand = seededRandom(1234567);
    for (let i = 0; i < image.data.length; i += 4) {
      const grain = (rand() - 0.5) * 9;
      image.data[i] = 0x17 + grain;
      image.data[i + 1] = 0x4f + grain;
      image.data[i + 2] = 0x8c + grain;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    // Wide, faint sheen so the surface is not a flat colour under even light.
    const sheen = ctx.createLinearGradient(0, 0, width, height);
    sheen.addColorStop(0, "rgba(255,255,255,0.05)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(0,0,40,0.06)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f4f2ea";
    const line = 0.02 * scale;
    ctx.fillRect(0, 0, line, height);
    ctx.fillRect(width - line, 0, line, height);
    ctx.fillRect(0, 0, width, line);
    ctx.fillRect(0, height - line, width, line);
    ctx.fillRect(width / 2 - 0.0015 * scale, 0, 0.003 * scale, height);
  });
}

/**
 * Where the top is glossy or worn: smudges and play wear break up reflections the way a real,
 * used table does. The green channel is the roughness.
 */
function tableRoughness() {
  const texture = canvasTexture(256, 460, (ctx) => {
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, 256, 460);
    const rand = seededRandom(8675309);
    for (let i = 0; i < 60; i++) {
      const x = rand() * 256;
      const y = rand() * 460;
      const radius = 10 + rand() * 50;
      const level = rand() < 0.5 ? 90 : 175;
      const smudge = ctx.createRadialGradient(x, y, 0, x, y, radius);
      smudge.addColorStop(0, `rgba(${level},${level},${level},${0.15 + rand() * 0.25})`);
      smudge.addColorStop(1, `rgba(${level},${level},${level},0)`);
      ctx.fillStyle = smudge;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Hands and balls wear the ends of the table dull.
    for (const [from, to] of [
      [0, 70],
      [460, 390],
    ]) {
      const wear = ctx.createLinearGradient(0, from, 0, to);
      wear.addColorStop(0, "rgba(190,190,190,0.5)");
      wear.addColorStop(1, "rgba(190,190,190,0)");
      ctx.fillStyle = wear;
      ctx.fillRect(0, Math.min(from, to), 256, 70);
    }
  });
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function netTexture() {
  const texture = canvasTexture(512, 48, (ctx) => {
    ctx.strokeStyle = "rgba(20, 30, 46, 0.85)";
    ctx.lineWidth = 1.2;
    for (let x = 0; x <= 512; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 48);
      ctx.stroke();
    }
    for (let y = 0; y <= 48; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = 2;
  return texture;
}

/**
 * Table and net, with soft contact shade where they meet the floor. Every solid part casts
 * shadows. Parts sharing a material are merged into one mesh, so the table costs a few draw calls
 * in each pass rather than one per leg, brace, and clamp.
 */
export function createTable() {
  const object = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2b3038,
    roughness: 0.38,
    metalness: 0.75,
  });
  const rubberFoot = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.9 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    object.add(mesh);
    return mesh;
  };
  /** Parts merged into one geometry around their centre, so a mesh there sorts by its real depth. */
  const merged = (parts: THREE.BufferGeometry[]) => {
    const geometry = mergeGeometries(parts)!;
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
  const steelPart = (
    geometry: THREE.BufferGeometry,
    position: [number, number, number],
    tilt = 0,
  ) => frame.push(geometry.rotateX(tilt).translate(...position));
  const steelBox = (size: [number, number, number], position: [number, number, number]) =>
    steelPart(new THREE.BoxGeometry(...size), position);

  // A lacquered top with painted lines over a rounded, dark edge band and a steel undercarriage.
  // Fine orange peel and uneven gloss make its reflections break up like a real table's.
  const bumps = grainNormalTexture(128, 5, 99);
  bumps.repeat.set(8, 14);
  const top = new THREE.MeshPhysicalMaterial({
    map: tableTexture(),
    roughnessMap: tableRoughness(),
    normalMap: bumps,
    normalScale: new THREE.Vector2(0.12, 0.12),
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.45,
  });
  const edge = new THREE.MeshPhysicalMaterial({ color: 0x163f68, roughness: 0.45, clearcoat: 0.4 });
  add(
    new RoundedBoxGeometry(TABLE.halfWidth * 2, 0.025, TABLE.halfLength * 2, 2, 0.006),
    edge,
  ).position.y = -0.0125;
  const surface = add(
    new THREE.PlaneGeometry(TABLE.halfWidth * 2 - 0.01, TABLE.halfLength * 2 - 0.01),
    top,
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.0002;
  // Opaque meshes draw in material order, which puts the steel frame first. Drawing the top
  // before everything lets the depth test skip the frame beneath it, instead of lighting the
  // frame and then painting over it.
  surface.renderOrder = -0.5;
  steelBox([TABLE.halfWidth * 2 - 0.08, 0.05, TABLE.halfLength * 2 - 0.1], [0, -0.05, 0]);
  const feet: [number, number][] = [];
  const footParts: THREE.BufferGeometry[] = [];
  for (const z of [-1, 1]) {
    for (const x of [-0.64, 0.64]) {
      steelPart(new THREE.CylinderGeometry(0.022, 0.022, 0.68, 16), [x, -0.42, z * 1.02]);
      footParts.push(
        new THREE.CylinderGeometry(0.036, 0.04, 0.03, 20).translate(x, -0.745, z * 1.02),
      );
      feet.push([x, z * 1.02]);
    }
    steelBox([1.28, 0.03, 0.03], [0, -0.62, z * 1.02]);
    // Folding braces from each leg frame up towards the table's centre.
    steelPart(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 10), [0, -0.36, z * 0.62], z * 1.05);
  }

  // Net: posts with clamps, a see-through mesh, and a white top tape.
  for (const x of [-1, 1]) {
    steelBox([0.022, 0.165, 0.03], [x * 0.81, 0.07, 0]);
    steelBox([0.06, 0.04, 0.06], [x * 0.79, -0.035, 0]);
  }
  solid(frame, steel);
  solid(footParts, rubberFoot);
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, TABLE.netHeight - 0.012),
    new THREE.MeshStandardMaterial({
      map: netTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      // Flat, so one pass draws both faces exactly as a back-then-front pass would.
      forceSinglePass: true,
      depthWrite: false,
      roughness: 0.9,
    }),
  );
  net.position.y = (TABLE.netHeight - 0.012) / 2;
  object.add(net);
  add(
    new THREE.BoxGeometry(1.62, 0.016, 0.006),
    new THREE.MeshStandardMaterial({ color: 0xfbfaf4, roughness: 0.6 }),
  ).position.set(0, TABLE.netHeight - 0.008, 0);

  // Contact shade: the sky is hidden under the table and right around each foot.
  const shade = (planes: THREE.BufferGeometry[], darkness: number) => {
    const { geometry, centre } = merged(planes);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: radialTexture(`rgba(6,8,16,${darkness})`, "rgba(6,8,16,0)"),
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.position.copy(centre);
    object.add(mesh);
  };
  const plane = (width: number, depth: number, x: number, z: number) =>
    new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(x, FLOOR_Y + 0.002, z);
  shade([plane(2.6, 3.8, 0, 0)], 0.5);
  shade(
    feet.map(([x, z]) => plane(0.2, 0.2, x, z)),
    0.75,
  );
  return object;
}
