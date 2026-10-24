import * as THREE from "three";

import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { createBall } from "./ball";
import { createImpactEffects } from "./impacts";
import { PLAYER_HOME, TABLE, type Impact, type PracticePhysics } from "./physics";
import { createRacket } from "./racket";
import { canvasTexture, radialTexture, seededRandom } from "./textures";

type Light = { color: number; intensity: number; position: [number, number, number] };
type Lighting = {
  exposure: number;
  sky: number;
  ground: number;
  ambient: number;
  key: Light;
  rim: Light;
  environment: number;
  shadow: number;
  glow: number;
};

export const COURT_IDS = ["sakura", "seaside", "tokyo"] as const;
export type CourtId = (typeof COURT_IDS)[number];

// Lights are matched to each illustration so the 3D objects sit in the painting:
// the sakura sun is high on the left, the seaside sun sets behind the far right, and the
// Tokyo rooftop is lit by a warm lamp overhead with the blue city behind.
// index.html preloads the first court's image by id; keep its list in sync.
export const COURTS: Record<CourtId, { name: string; image: string; lighting: Lighting }> = {
  sakura: {
    name: "Sakura court",
    image: "/game/sakura-court.webp",
    lighting: {
      exposure: 1.05,
      sky: 0xd6ebff,
      ground: 0xf3c9aa,
      ambient: 1.1,
      key: { color: 0xfff0d8, intensity: 3.1, position: [-3.5, 6, 1.5] },
      rim: { color: 0xc8e2ff, intensity: 0.8, position: [2, 3, -5] },
      environment: 0.55,
      shadow: 0.3,
      glow: 0.12,
    },
  },
  seaside: {
    name: "Seaside court",
    image: "/game/seaside-court.webp",
    lighting: {
      exposure: 1,
      sky: 0xcaa8e6,
      ground: 0xffbf96,
      ambient: 1.35,
      key: { color: 0xffad73, intensity: 3.4, position: [4.5, 2.6, -6] },
      rim: { color: 0xffa8bc, intensity: 1.3, position: [-2, 3, 5] },
      environment: 1.05,
      shadow: 0.34,
      glow: 0.22,
    },
  },
  tokyo: {
    name: "Tokyo rooftop",
    image: "/game/tokyo-court.webp",
    lighting: {
      exposure: 1.05,
      sky: 0x7b85dc,
      ground: 0x55537e,
      ambient: 1,
      key: { color: 0xffd09a, intensity: 2.6, position: [0.8, 6, 1.4] },
      rim: { color: 0x8fa8ff, intensity: 1.4, position: [0, 2.5, -6] },
      environment: 0.6,
      shadow: 0.4,
      glow: 0.4,
    },
  },
};

/** Touch aims a little above the finger, so the finger does not hide the racket. */
const TOUCH_OFFSET = 42;
// Adaptive resolution: when most of a sampling window of play runs below ~50 fps, render fewer
// pixels. It only steps down, so a sharp image never flickers between resolutions.
const SLOW_FRAME = 1 / 50;
const SAMPLE_TIME = 2;
const MIN_PIXEL_RATIO = 1;

/** Tournament-blue top with painted lines and a faint matte grain. */
function tableTexture() {
  const width = 512;
  const height = Math.round((width * TABLE.halfLength) / TABLE.halfWidth);
  const scale = width / (TABLE.halfWidth * 2);
  return canvasTexture(width, height, (ctx) => {
    ctx.fillStyle = "#1f5f9f";
    ctx.fillRect(0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const rand = seededRandom(1234567);
    for (let i = 0; i < image.data.length; i += 4) {
      const grain = (rand() - 0.5) * 9;
      image.data[i] += grain;
      image.data[i + 1] += grain;
      image.data[i + 2] += grain;
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

/** Table, net, and the floor shading under them. Every part casts and receives shadows. */
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
  const box = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material | THREE.Material[],
  ) => {
    add(new THREE.BoxGeometry(...size), material).position.set(...position);
  };

  // A clear-coated top with painted lines, a dark edge band, and a steel undercarriage.
  const top = new THREE.MeshPhysicalMaterial({
    map: tableTexture(),
    roughness: 0.62,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
  });
  const edge = new THREE.MeshPhysicalMaterial({ color: 0x163f68, roughness: 0.45, clearcoat: 0.4 });
  box(
    [TABLE.halfWidth * 2, 0.025, TABLE.halfLength * 2],
    [0, -0.0125, 0],
    [edge, edge, top, edge, edge, edge],
  );
  box([TABLE.halfWidth * 2 - 0.08, 0.05, TABLE.halfLength * 2 - 0.1], [0, -0.05, 0], steel);
  for (const z of [-1, 1]) {
    for (const x of [-0.64, 0.64]) {
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.68, 16), steel).position.set(
        x,
        -0.42,
        z * 1.02,
      );
      add(new THREE.CylinderGeometry(0.036, 0.04, 0.03, 20), rubberFoot).position.set(
        x,
        -0.745,
        z * 1.02,
      );
    }
    box([1.28, 0.03, 0.03], [0, -0.62, z * 1.02], steel);
    // Folding braces from each leg frame up towards the table's centre.
    const brace = add(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 10), steel);
    brace.position.set(0, -0.36, z * 0.62);
    brace.rotation.x = z * 1.05;
  }

  // Net: posts with clamps, a see-through mesh, and a white top tape.
  for (const x of [-1, 1]) {
    box([0.022, 0.165, 0.03], [x * 0.81, 0.07, 0], steel);
    box([0.06, 0.04, 0.06], [x * 0.79, -0.035, 0], steel);
  }
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, TABLE.netHeight - 0.012),
    new THREE.MeshStandardMaterial({
      map: netTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.9,
    }),
  );
  net.position.y = (TABLE.netHeight - 0.012) / 2;
  object.add(net);
  box(
    [1.62, 0.016, 0.006],
    [0, TABLE.netHeight - 0.008, 0],
    new THREE.MeshStandardMaterial({ color: 0xfbfaf4, roughness: 0.6 }),
  );

  // Only shadows are drawn over the illustrated floor, plus a soft contact shade under the table.
  const floorShadow = new THREE.ShadowMaterial({ opacity: 0.3 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), floorShadow);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.76;
  floor.receiveShadow = true;
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.8),
    new THREE.MeshBasicMaterial({
      map: radialTexture("rgba(10,14,30,0.42)", "rgba(10,14,30,0)"),
      transparent: true,
      depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -0.758;
  object.add(floor, contact);
  return { object, floorShadow };
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

/** Decode an illustration off the main thread; same-origin, so it shares the page's preload. */
async function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

/**
 * The 3D court drawn over the illustrated background inside `host`. Nothing is drawn until
 * `ready` resolves: the first court's reflections are built and every shader has compiled.
 */
export function createCourt(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 30);
  // Shake moves the drawn camera only; aiming always uses the steady pose.
  const aimCamera = camera.clone();

  const hemisphere = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -2.8,
    right: 2.8,
    top: 2.8,
    bottom: -2.8,
    near: 1,
    far: 20,
  });
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  const rim = new THREE.DirectionalLight();

  // Reflections come from each court's painting, built once per court. A neutral studio stands in
  // only if a painting cannot load. Compile the converter while the first painting downloads.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environments = new Map<CourtId, THREE.Texture>();
  let studio: THREE.Texture | undefined;

  const table = createTable();
  const player = createRacket({ side: 1, forehand: "black" });
  const opponent = createRacket({ side: -1, forehand: "red" });
  const ball = createBall();
  const effects = createImpactEffects();
  scene.add(
    hemisphere,
    key,
    rim,
    table.object,
    player.object,
    opponent.object,
    ball.object,
    effects.object,
  );

  let shake = 0;
  let hitStop = 0;
  let clock = 0;
  const position = new THREE.Vector3();
  // Outside play nothing moves, so a frame is drawn only when the view or the phase changes.
  let dirty = true;
  let lastPhase: PracticePhysics["phase"] | undefined;
  let sampled = 0;
  let slow = 0;

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const portrait = camera.aspect < 0.8;
    camera.fov = portrait ? 58 : 45;
    camera.position.set(0, portrait ? 1.55 : 1.35, portrait ? 4.6 : 3.1);
    camera.lookAt(0, portrait ? 0.2 : 0.04, 0);
    camera.updateProjectionMatrix();
    aimCamera.copy(camera);
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
  let compiling = false;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  const useEnvironment = (texture: THREE.Texture) => {
    scene.environment = texture;
    dirty = true;
    // Reflections are part of every lit shader, so compile once the first ones exist; with
    // KHR_parallel_shader_compile this keeps the main thread free.
    if (compiling) return;
    compiling = true;
    void renderer.compileAsync(scene, camera).then(() => {
      if (disposed) return;
      // A shader's first draw and each buffer's upload also block. Draw once with the hidden
      // trails, rings, flashes, and sparks shown, so none of that lands on a rally's first hit,
      // then clear it before the first real frame.
      const hidden: THREE.Object3D[] = [];
      scene.traverse((object) => {
        if (object.visible) return;
        hidden.push(object);
        object.visible = true;
      });
      renderer.render(scene, camera);
      for (const object of hidden) object.visible = false;
      renderer.clear();
      markReady();
    });
  };

  return {
    ready,
    /** Match lights, reflections, and ball glow to the illustrated court behind the canvas. */
    setCourt(id: CourtId) {
      const { image, lighting } = COURTS[id];
      renderer.toneMappingExposure = lighting.exposure;
      hemisphere.color.set(lighting.sky);
      hemisphere.groundColor.set(lighting.ground);
      hemisphere.intensity = lighting.ambient;
      key.color.set(lighting.key.color);
      key.intensity = lighting.key.intensity;
      key.position.set(...lighting.key.position).setLength(8);
      rim.color.set(lighting.rim.color);
      rim.intensity = lighting.rim.intensity;
      rim.position.set(...lighting.rim.position);
      scene.environmentIntensity = lighting.environment;
      table.floorShadow.opacity = lighting.shadow;
      ball.setGlow(lighting.glow);
      dirty = true;
      const request = ++courtRequest;
      const built = environments.get(id);
      if (built) return useEnvironment(built);
      loadImage(image).then(
        (picture) => {
          if (request !== courtRequest || disposed) return;
          const texture = new THREE.Texture(picture);
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          const next = pmrem.fromEquirectangular(texture).texture;
          texture.dispose();
          environments.set(id, next);
          useEnvironment(next);
        },
        () => {
          // Keep the current reflections; the studio is only for a court with none yet.
          if (request !== courtRequest || disposed || scene.environment) return;
          studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          useEnvironment(studio);
        },
      );
    },
    /** Where the player's hand should go for a pointer at this screen position, if anywhere. */
    handAt(clientX: number, clientY: number, touch: boolean) {
      const rect = host.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top - (touch ? TOUCH_OFFSET : 0)) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, aimCamera);
      return raycaster.ray.intersectPlane(handPlane, hand) ?? undefined;
    },
    /** Simulation speed for the next frame; a hard racket hit briefly freezes time. */
    timeScale() {
      return hitStop > 0 ? 0.1 : 1;
    },
    render(game: PracticePhysics, impacts: readonly Impact[], elapsed: number, alpha: number) {
      const playing = game.phase === "playing";
      if (!playing && !dirty && game.phase === lastPhase) return;
      dirty = false;
      lastPhase = game.phase;
      if (playing) {
        sampled += elapsed;
        if (elapsed > SLOW_FRAME) slow += elapsed;
        if (sampled >= SAMPLE_TIME) {
          if (slow > sampled / 2 && pixelRatio > MIN_PIXEL_RATIO) {
            pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.5);
            resize();
          }
          sampled = slow = 0;
        }
      }
      const dt = playing ? elapsed : 0;
      if (!playing) alpha = 1;
      hitStop = Math.max(0, hitStop - dt);
      clock += dt;
      for (const impact of impacts) {
        const strength = Math.min(1, impact.speed / 7);
        if (impact.surface === "player") {
          player.hit(strength);
          shake = Math.min(1, shake + strength * strength * 0.9);
          if (strength > 0.6) hitStop = 0.05 + (strength - 0.6) * 0.06;
        }
        if (impact.surface === "opponent") opponent.hit(strength);
        effects.add(impact, strength, camera.quaternion);
      }
      effects.update(dt);
      player.update(position.lerpVectors(game.previousPlayer, game.player, alpha), dt);
      opponent.update(position.lerpVectors(game.previousOpponent, game.opponent, alpha), dt);
      ball.update(game, alpha, dt, camera.position);

      // Camera shake from the drawn camera only; it decays fast so play stays readable.
      shake = Math.max(0, shake - dt * 2.8);
      const amount = shake * shake * 0.012;
      camera.quaternion.copy(aimCamera.quaternion);
      camera.rotateX(Math.sin(clock * 61) * amount);
      camera.rotateY(Math.sin(clock * 47 + 1.3) * amount);
      camera.rotateZ(Math.sin(clock * 53 + 2.1) * amount * 0.6);
      renderer.render(scene, camera);
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      for (const texture of environments.values()) texture.dispose();
      studio?.dispose();
      pmrem.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
