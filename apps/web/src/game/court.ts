import * as THREE from "three";

import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { createBall } from "./ball";
import { COURTS, type CourtId } from "./courts";
import { createImpactEffects } from "./impacts";
import { PLAYER_HOME, TABLE, type Impact, type PracticePhysics } from "./physics";
import { createPost } from "./post";
import { createRacket, createRacketModel } from "./racket";
import { FLOOR_Y, loadScenery, type Scenery } from "./scenery";
import { createTable } from "./table";

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
const FOCUS_END = new THREE.Vector3(0, 0, -TABLE.halfLength - 1.2);
const FOCUS_RAMP = 4;
/** A player hit at least this strong (0–1) gets a moment of slow motion. */
const SLOW_MOTION_HIT = 0.85;
const SLOW_MOTION_TIME = 0.3;

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
    player.smear,
    opponent.object,
    opponent.smear,
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
    // Focus covers everything a rally reaches, a little past the far end of the table; the court's
    // far edge, several metres on, is soft.
    camera.updateMatrixWorld();
    const sharp = FOCUS_END.clone().applyMatrix4(camera.matrixWorldInverse).z;
    post.setFocus(-sharp, -sharp + FOCUS_RAMP);
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
      loading = loadScenery(id, renderer, pmrem).then(async (built) => {
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
    const roots = [table, player.object, player.smear, opponent.object, opponent.smear];
    for (const root of [...roots, ball.object, effects.object]) {
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
