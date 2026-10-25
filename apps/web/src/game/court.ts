import * as THREE from "three";

import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createBall } from "./ball";
import { createImpactEffects } from "./impacts";
import { PLAYER_HOME, TABLE, type Impact, type PracticePhysics } from "./physics";
import { createPost, type Grade } from "./post";
import { createRacket, createRacketModel } from "./racket";
import { FLOOR_Y, loadScenery, type Scenery, type SceneryConfig } from "./scenery";
import { canvasTexture, grainNormalTexture, radialTexture, seededRandom } from "./textures";

type Light = { color: number; intensity: number; position: [number, number, number] };
type Lighting = {
  exposure: number;
  sky: number;
  ground: number;
  ambient: number;
  /** The sun or moon: a far light that casts the main shadows. */
  key: Light;
  rim: Light;
  /** An optional floodlight that throws a pool of light, and its own shadows, over the table. */
  lamp?: Light & { angle: number };
  environment: number;
  glow: number;
};

export const COURT_IDS = ["sakura", "seaside", "tokyo"] as const;
export type CourtId = (typeof COURT_IDS)[number];

type CourtConfig = {
  name: string;
  scenery: SceneryConfig;
  lighting: Lighting;
  /** Air between the camera and the edge of the court. */
  haze: { color: number; density: number };
  grade: Grade;
};

// Each court is a real 3D floor and edge under a lens-blurred photo of the distance. Lights follow
// the photo: Kyoto's sun is high on the left, Shonan's sets ahead on the right behind the table, and
// the Tokyo rooftop sits under a warm floodlight with the blue-hour city beyond.
// index.html preloads the first court's images by id; keep its list in sync.
export const COURTS: Record<CourtId, CourtConfig> = {
  sakura: {
    name: "Kyoto sakura terrace",
    scenery: {
      backdrop: { horizon: 0.5, span: 84, pan: 0.1, boost: 0.6 },
      sky: { horizon: 0xd7e6f2, zenith: 0x76afe4 },
      floor: { tile: 2, tint: 0xd8d2ca, bumps: 0.8 },
      edge: { kind: "wall", distance: 6.5 },
      particles: { kind: "petals", color: 0xffc8d8, count: 160 },
    },
    lighting: {
      exposure: 0.9,
      sky: 0xbcd6f5,
      ground: 0xb9ab9a,
      ambient: 0.55,
      key: { color: 0xfff1dc, intensity: 3, position: [-3.5, 6, 1.5] },
      rim: { color: 0xd0e4ff, intensity: 0.6, position: [2, 3, -5] },
      environment: 0.9,
      glow: 0.06,
    },
    haze: { color: 0xdde6f0, density: 0.012 },
    grade: {
      bloom: 0.5,
      lift: [0, 0.008, 0.02],
      gain: [1.03, 1, 0.97],
      saturation: 1.1,
      contrast: 0.4,
    },
  },
  seaside: {
    name: "Shonan sunset boardwalk",
    scenery: {
      backdrop: { horizon: 0.58, span: 84, pan: 0.1, boost: 5 },
      sky: { horizon: 0xf0a070, zenith: 0x3c4f77 },
      floor: { tile: 1.2, tint: 0xffffff, bumps: 1 },
      edge: { kind: "rail", distance: 6 },
      particles: { kind: "motes", color: 0xffd29a, count: 60 },
    },
    lighting: {
      exposure: 1,
      sky: 0x8f8fc8,
      ground: 0xc89a78,
      ambient: 0.45,
      key: { color: 0xffb470, intensity: 3.5, position: [0.9, 1.7, -7.9] },
      rim: { color: 0xff9fb0, intensity: 0.5, position: [-2, 3, 5] },
      environment: 1,
      glow: 0.18,
    },
    haze: { color: 0xe7a988, density: 0.02 },
    grade: {
      bloom: 0.9,
      lift: [0.025, 0, 0.035],
      gain: [1.05, 0.99, 0.92],
      saturation: 1.08,
      contrast: 0.3,
    },
  },
  tokyo: {
    name: "Tokyo rooftop",
    scenery: {
      backdrop: { horizon: 0.39, span: 84, pan: -0.12, boost: 4 },
      sky: { horizon: 0x2a4f95, zenith: 0x11509e },
      floor: { tile: 3, tint: 0xffffff, bumps: 0.8 },
      edge: { kind: "parapet", distance: 6.5 },
      particles: { kind: "motes", color: 0xcfe0ff, count: 40 },
    },
    lighting: {
      exposure: 1,
      sky: 0x3a4c9a,
      ground: 0x30303e,
      ambient: 0.35,
      key: { color: 0x9db4ff, intensity: 0.5, position: [-1, 6, -2] },
      rim: { color: 0x8fa8ff, intensity: 1, position: [0, 2.5, -6] },
      lamp: { color: 0xffc890, intensity: 28, position: [-1.2, 5.2, 1.4], angle: 0.8 },
      environment: 0.9,
      glow: 0.35,
    },
    haze: { color: 0x1c2550, density: 0.03 },
    grade: {
      bloom: 1.1,
      lift: [0, 0.01, 0.04],
      gain: [1.03, 0.98, 0.95],
      saturation: 1.05,
      contrast: 0.3,
    },
  },
};

/** A touch drag moves the hand this many times the finger's travel, so a thumb covers its reach. */
const TOUCH_GAIN = 1.5;
// Portrait screens look down a fixed sight line at a point above the hand's rest, from as close as
// still shows this many metres of the hand's plane either side of centre (about where the ball
// arrives at its widest), so narrower phones step back. The fixed pitch keeps the horizon in place.
const PORTRAIT_HALF_VIEW = 0.82;
const PORTRAIT_FOCUS = new THREE.Vector3(0, 0.65, PLAYER_HOME.z);
const PORTRAIT_SIGHT = new THREE.Vector3(0, 1.35, 4.6).normalize();
// Adaptive quality: when most of a sampling window of play runs below ~50 fps, stop antialiasing
// first, then render fewer pixels. It only steps down, so a sharp image never flickers between
// qualities.
const SLOW_FRAME = 1 / 50;
const SAMPLE_TIME = 2;
const MIN_PIXEL_RATIO = 1;
/**
 * The title screen only drifts, so it draws about 30 times a second rather than every display
 * frame. The margin absorbs frame-time jitter, so 60 Hz screens draw every other frame.
 */
const TITLE_FRAME = 1 / 30 - 0.004;
/** A player hit at least this strong (0–1) gets a moment of slow motion. */
const SLOW_MOTION_HIT = 0.85;
const SLOW_MOTION_TIME = 0.3;

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
function createTable() {
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

/** Free GPU resources of every mesh, sprite, and point cloud, including material textures. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.Sprite
    ) {
      object.geometry.dispose();
      for (const material of [object.material].flat()) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    }
  });
}

export type Court = ReturnType<typeof createCourt>;

/**
 * The 3D court inside `host`. Nothing is drawn until `ready` resolves: the first court's scenery
 * and reflections are built and every shader has compiled.
 */
export function createCourt(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  let pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  // Tone mapping happens in the post pass, after bloom, so bright light can glow.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.opacity = "0";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0, 0);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  // Shake, drift, and follow move the drawn camera only; aiming always uses the steady pose.
  const aimCamera = camera.clone();
  const post = createPost(renderer, scene, camera);

  const hemisphere = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -6,
    right: 6,
    top: 6,
    bottom: -6,
    near: 0.5,
    far: 40,
  });
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight();
  // Present on every court so changing courts never changes the shaders; off unless a court has one.
  const lamp = new THREE.SpotLight(0xffffff, 0, 0, 0.7, 0.75, 2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 4;
  lamp.target.position.set(0, FLOOR_Y, -0.2);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const sceneries = new Map<CourtId, Promise<Scenery>>();
  let shown: Scenery | undefined;
  let studio: THREE.Texture | undefined;

  const table = createTable();
  const racket = createRacketModel();
  const player = createRacket(racket, { side: 1, forehand: "black" });
  const opponent = createRacket(racket, { side: -1, forehand: "red" });
  const ball = createBall();
  const effects = createImpactEffects();
  scene.add(
    hemisphere,
    key,
    rim,
    lamp,
    lamp.target,
    table,
    player.object,
    opponent.object,
    ball.object,
    effects.object,
  );

  let shake = 0;
  let hitStop = 0;
  let slowMotion = 0;
  let zoom = 0;
  let clock = 0;
  let ambientClock = 0;
  const follow = { yaw: 0, pitch: 0 };
  const position = new THREE.Vector3();
  // Paused, nothing moves, so a frame is drawn only when the view or the phase changes. The title
  // screen keeps its petals, dust, and camera drift alive at TITLE_FRAME.
  let dirty = true;
  let titleWait = 0;
  let lastPhase: PracticePhysics["phase"] | undefined;
  let sampled = 0;
  let slow = 0;
  let metresPerPixel = 0;

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setPixelRatio(pixelRatio);
    post.setSize(width, height);
    camera.aspect = width / height;
    if (camera.aspect < 0.8) {
      camera.fov = 58;
      // Wider screens, such as tablets, keep a tall phone's distance and show more court.
      const halfWidth =
        Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 0.58);
      camera.position
        .copy(PORTRAIT_FOCUS)
        .addScaledVector(PORTRAIT_SIGHT, PORTRAIT_HALF_VIEW / halfWidth);
      camera.lookAt(PORTRAIT_FOCUS);
    } else {
      // Level enough to see the horizon above the far end, like the portrait view.
      camera.fov = 50;
      camera.position.set(0, 1.4, 3.3);
      camera.lookAt(0, 0.35, 0);
    }
    camera.updateProjectionMatrix();
    aimCamera.copy(camera);
    // Metres of the hand's plane per screen pixel, at the hand's resting depth.
    const depth = new THREE.Vector3()
      .copy(PLAYER_HOME)
      .sub(camera.position)
      .dot(camera.getWorldDirection(new THREE.Vector3()));
    metresPerPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height;
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const handPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PLAYER_HOME.z);
  const hand = new THREE.Vector3();
  let courtRequest = 0;
  let disposed = false;
  let compiled = false;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));

  /** Build a court's scenery once, hidden, with its shaders compiled; restarts reuse it. */
  const loadCourt = (id: CourtId) => {
    let loading = sceneries.get(id);
    if (!loading) {
      const { scenery, lighting } = COURTS[id];
      loading = loadScenery(id, scenery, lighting.ground, renderer, pmrem).then(async (built) => {
        built.object.visible = false;
        scene.add(built.object);
        // The first court compiles with everything else below; reflections are part of every
        // lit shader, so the first ones must exist before it does.
        scene.environment ??= built.environment;
        if (compiled) await post.compile(built.object, scene);
        return built;
      });
      sceneries.set(id, loading);
    }
    return loading;
  };

  const applyLighting = (id: CourtId) => {
    const { lighting, haze, grade } = COURTS[id];
    renderer.toneMappingExposure = lighting.exposure;
    hemisphere.color.set(lighting.sky);
    hemisphere.groundColor.set(lighting.ground);
    hemisphere.intensity = lighting.ambient;
    key.color.set(lighting.key.color);
    key.intensity = lighting.key.intensity;
    key.position.set(...lighting.key.position).setLength(15);
    rim.color.set(lighting.rim.color);
    rim.intensity = lighting.rim.intensity;
    rim.position.set(...lighting.rim.position);
    lamp.intensity = lighting.lamp?.intensity ?? 0;
    // An unlit lamp draws its (unused) shadow map once instead of every frame. It must exist:
    // WebGL2 skips every lit draw call whose shadow sampler has no depth texture bound.
    lamp.shadow.autoUpdate = !!lighting.lamp;
    lamp.shadow.needsUpdate = true;
    if (lighting.lamp) {
      lamp.color.set(lighting.lamp.color);
      lamp.position.set(...lighting.lamp.position);
      lamp.angle = lighting.lamp.angle;
    }
    const fog = scene.fog as THREE.FogExp2;
    fog.color.set(haze.color);
    fog.density = haze.density;
    scene.environmentIntensity = lighting.environment;
    ball.setGlow(lighting.glow);
    post.setGrade(grade);
  };

  /** Draw once with hidden trails, rings, flashes, and sparks shown, so their first use never stalls. */
  const warmUp = () => {
    const hidden: THREE.Object3D[] = [];
    for (const root of [table, player.object, opponent.object, ball.object, effects.object]) {
      root.traverse((object) => {
        if (object.visible) return;
        hidden.push(object);
        object.visible = true;
      });
    }
    post.render(0);
    for (const object of hidden) object.visible = false;
  };

  const show = (id: CourtId, next: Scenery | undefined) => {
    if (shown) shown.object.visible = false;
    shown = next;
    if (next) {
      next.object.visible = true;
      scene.environment = next.environment;
    }
    applyLighting(id);
    dirty = true;
    if (compiled) return;
    compiled = true;
    // With KHR_parallel_shader_compile this keeps the main thread free.
    void post.compile(scene).then(() => {
      if (disposed) return;
      warmUp();
      renderer.domElement.style.opacity = "1";
      markReady();
    });
  };

  return {
    ready,
    /** Switch to a court's scenery, lights, and look once it has loaded. */
    setCourt(id: CourtId) {
      const request = ++courtRequest;
      loadCourt(id).then(
        (built) => {
          if (request === courtRequest && !disposed) show(id, built);
        },
        () => {
          sceneries.delete(id);
          // Keep the current court; with none yet, play over a neutral studio.
          if (request !== courtRequest || disposed || compiled) return;
          studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          scene.environment = studio;
          show(id, undefined);
        },
      );
    },
    /** Where the player's hand should go for a pointer at this screen position, if anywhere. */
    handAt(clientX: number, clientY: number) {
      const rect = host.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, aimCamera);
      return raycaster.ray.intersectPlane(handPlane, hand) ?? undefined;
    },
    /** How far a touch drag of this many screen pixels moves the player's hand, in metres. */
    handDrag(dx: number, dy: number) {
      const scale = metresPerPixel * TOUCH_GAIN;
      return { x: dx * scale, y: -dy * scale };
    },
    /** Simulation speed for the next frame: a hard hit freezes time, then eases out of slow motion. */
    timeScale() {
      if (hitStop > 0) return 0.1;
      if (slowMotion > 0) return 1 - 0.6 * (slowMotion / SLOW_MOTION_TIME);
      return 1;
    },
    render(game: PracticePhysics, impacts: readonly Impact[], elapsed: number, alpha: number) {
      const playing = game.phase === "playing";
      const alive = game.phase !== "paused";
      if (!alive && !dirty && game.phase === lastPhase) return;
      if (game.phase === "ready" && lastPhase === "ready" && !dirty) {
        // Between title frames, keep the time so the next one moves as far as it would have.
        titleWait += elapsed;
        if (titleWait < TITLE_FRAME) return;
        elapsed = titleWait;
      }
      titleWait = 0;
      dirty = false;
      lastPhase = game.phase;
      if (playing) {
        sampled += elapsed;
        if (elapsed > SLOW_FRAME) slow += elapsed;
        if (sampled >= SAMPLE_TIME) {
          if (slow > sampled / 2 && !post.stopAntialiasing() && pixelRatio > MIN_PIXEL_RATIO) {
            pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.5);
            resize();
          }
          sampled = slow = 0;
        }
      }
      const dt = playing ? elapsed : 0;
      const ambientDt = alive ? elapsed : 0;
      if (!playing) alpha = 1;
      hitStop = Math.max(0, hitStop - dt);
      slowMotion = Math.max(0, slowMotion - dt);
      clock += dt;
      ambientClock += ambientDt;
      for (const impact of impacts) {
        const strength = Math.min(1, impact.speed / 7);
        if (impact.surface === "player") {
          player.hit(strength);
          shake = Math.min(1, shake + strength * strength * 0.9);
          zoom = Math.min(3, zoom + strength * strength * 2.5);
          if (strength > 0.6) hitStop = 0.05 + (strength - 0.6) * 0.06;
          if (strength >= SLOW_MOTION_HIT) slowMotion = SLOW_MOTION_TIME;
        }
        if (impact.surface === "opponent") opponent.hit(strength);
        effects.add(impact, strength, camera.quaternion);
      }
      effects.update(dt);
      player.update(position.lerpVectors(game.previousPlayer, game.player, alpha), dt);
      opponent.update(position.lerpVectors(game.previousOpponent, game.opponent, alpha), dt);
      ball.update(game, alpha, dt, camera.position);
      shown?.update(ambientDt, ambientClock);

      // The drawn camera breathes like a handheld shot, leans a little towards the ball, punches
      // in on hard hits, and shakes; all of it is small and fast to settle so play stays readable.
      const settle = 1 - Math.exp(-ambientDt * 2.5);
      const ballVisible = playing && game.nextBallIn <= 0;
      follow.yaw += ((ballVisible ? -game.ball.x * 0.02 : 0) - follow.yaw) * settle;
      follow.pitch += ((ballVisible ? (game.ball.y - 0.3) * 0.012 : 0) - follow.pitch) * settle;
      zoom *= Math.exp(-dt * 5);
      shake = Math.max(0, shake - dt * 2.8);
      const amount = shake * shake * 0.012;
      const t = ambientClock;
      camera.position.copy(aimCamera.position);
      camera.position.x += Math.sin(t * 0.37) * 0.012;
      camera.position.y += Math.sin(t * 0.29 + 1) * 0.008;
      camera.quaternion.copy(aimCamera.quaternion);
      camera.rotateY(follow.yaw + Math.sin(t * 0.23) * 0.003 + Math.sin(clock * 47 + 1.3) * amount);
      camera.rotateX(follow.pitch + Math.sin(t * 0.31 + 2) * 0.002 + Math.sin(clock * 61) * amount);
      camera.rotateZ(Math.sin(clock * 53 + 2.1) * amount * 0.6);
      camera.fov = aimCamera.fov - zoom;
      camera.updateProjectionMatrix();
      post.render(elapsed);
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      for (const loading of sceneries.values()) void loading.then((built) => built.dispose());
      studio?.dispose();
      pmrem.dispose();
      disposeTree(scene);
      post.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
