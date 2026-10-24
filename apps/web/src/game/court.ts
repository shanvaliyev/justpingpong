import * as THREE from "three";

import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { createCourtAudio } from "./audio";
import { BALL_RADIUS, TABLE, type PracticePhysics } from "./physics";
import { createRacket } from "./racket";

export type CourtMood = "sakura" | "seaside" | "tokyo";

type Mood = {
  exposure: number;
  sky: number;
  ground: number;
  ambient: number;
  key: { color: number; intensity: number; position: [number, number, number] };
  rim: { color: number; intensity: number; position: [number, number, number] };
  environment: number;
  shadow: number;
  glow: number;
};

// Lights are matched to each illustration so the 3D objects sit in the painting:
// the sakura sun is high on the left, the seaside sun sets behind the far right, and the
// Tokyo rooftop is lit by a warm lamp overhead with the blue city behind.
const MOODS: Record<CourtMood, Mood> = {
  sakura: {
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
  seaside: {
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
  tokyo: {
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
};

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A soft radial falloff, used for glows, flashes, sparks, and contact shadows. */
function radialTexture(inner: string, outer: string) {
  return canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** Tournament-blue top with painted lines and a faint matte grain. */
function tableTexture() {
  const width = 512;
  const height = Math.round((width * TABLE.halfLength) / TABLE.halfWidth);
  const scale = width / (TABLE.halfWidth * 2);
  return canvasTexture(width, height, (ctx) => {
    ctx.fillStyle = "#1f5f9f";
    ctx.fillRect(0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    let seed = 1234567;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const grain = (seed / 2147483647 - 0.5) * 9;
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

export function createCourt(host: HTMLElement, game: PracticePhysics) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  scene.add(hemisphere, key, rim);

  // Environment reflections start as a neutral studio and switch to the painted scene once it loads.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  let painted: THREE.Texture | undefined;
  scene.environment = studio;

  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(texture: T) => (textures.push(texture), texture);
  const steel = new THREE.MeshStandardMaterial({
    color: 0x2b3038,
    roughness: 0.38,
    metalness: 0.75,
  });
  const rubberFoot = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.9 });
  const add = <T extends THREE.Object3D>(object: T, shadow = true) => {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = shadow;
    });
    scene.add(object);
    return object;
  };
  const box = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material | THREE.Material[],
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    return add(mesh);
  };

  // Only shadows are drawn over the illustrated floor, plus a soft contact shade under the table.
  const floorShadow = new THREE.ShadowMaterial({ opacity: 0.3 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), floorShadow);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.76;
  floor.receiveShadow = true;
  scene.add(floor);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.8),
    new THREE.MeshBasicMaterial({
      map: keep(radialTexture("rgba(10,14,30,0.42)", "rgba(10,14,30,0)")),
      transparent: true,
      depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -0.758;
  scene.add(contact);

  // Table: a clear-coated top with painted lines, a dark edge band, and a steel undercarriage.
  const top = new THREE.MeshPhysicalMaterial({
    map: keep(tableTexture()),
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
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.68, 16), steel);
      leg.position.set(x, -0.42, z * 1.02);
      add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.03, 20), rubberFoot);
      foot.position.set(x, -0.745, z * 1.02);
      add(foot);
    }
    box([1.28, 0.03, 0.03], [0, -0.62, z * 1.02], steel);
    // Folding braces from each leg frame up towards the table's centre.
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 10), steel);
    brace.position.set(0, -0.36, z * 0.62);
    brace.rotation.x = z * 1.05;
    add(brace);
  }

  // Net: posts with clamps, a see-through mesh, and a white top tape.
  for (const x of [-1, 1]) {
    box([0.022, 0.165, 0.03], [x * 0.81, 0.07, 0], steel);
    box([0.06, 0.04, 0.06], [x * 0.79, -0.035, 0], steel);
  }
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, TABLE.netHeight - 0.012),
    new THREE.MeshStandardMaterial({
      map: keep(netTexture()),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.9,
    }),
  );
  net.position.y = (TABLE.netHeight - 0.012) / 2;
  scene.add(net);
  box(
    [1.62, 0.016, 0.006],
    [0, TABLE.netHeight - 0.008, 0],
    new THREE.MeshStandardMaterial({ color: 0xfbfaf4, roughness: 0.6 }),
  );

  const player = createRacket({ side: 1, forehand: "black" });
  const opponent = createRacket({ side: -1, forehand: "red" });
  scene.add(player.object, opponent.object);

  // Ball: the root follows the flight and stretches with speed; the mesh inside spins.
  const ballRoot = new THREE.Group();
  const ballMaterial = new THREE.MeshPhysicalMaterial({
    map: keep(ballTexture()),
    roughness: 0.42,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    emissive: 0xff7a14,
    emissiveIntensity: 0.12,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 32, 20), ballMaterial);
  ball.castShadow = true;
  ballRoot.add(ball);
  scene.add(ballRoot);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: keep(radialTexture("rgba(255,214,150,0.9)", "rgba(255,170,80,0)")),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  scene.add(glow);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({
      map: keep(radialTexture("rgba(8,16,30,0.55)", "rgba(8,16,30,0)")),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // A short streak behind fast balls: a camera-facing ribbon back along the flight, fading out.
  // It is built from the velocity rather than past frames, so slow devices draw the same length.
  const TRAIL = 10;
  const TRAIL_TIME = 0.06;
  const trailGeometry = new THREE.BufferGeometry();
  const trailPositions = new Float32Array(TRAIL * 2 * 3);
  const trailColors = new Float32Array(TRAIL * 2 * 4);
  trailGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  trailGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(trailColors, 4).setUsage(THREE.DynamicDrawUsage),
  );
  const trailIndex: number[] = [];
  for (let i = 0; i < TRAIL - 1; i++) {
    const a = i * 2;
    trailIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeometry.setIndex(trailIndex);
  const trail = new THREE.Mesh(
    trailGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  trail.frustumCulled = false;
  scene.add(trail);
  const trailColor = new THREE.Color(0xffe6bf);

  // Impact feedback: an expanding ring, a quick flash, and a burst of sparks on racket hits.
  const pulses = Array.from({ length: 4 }, () => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.045, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffedbd,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.visible = false;
    scene.add(mesh);
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: keep(radialTexture("rgba(255,246,220,1)", "rgba(255,200,120,0)")),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    flash.visible = false;
    scene.add(flash);
    return { mesh, flash, age: 1, strength: 0, racket: false };
  });
  let nextPulse = 0;
  const SPARKS = 96;
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
      map: keep(radialTexture("rgba(255,240,200,1)", "rgba(255,180,90,0)")),
      color: 0xffe2a8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sparks.frustumCulled = false;
  scene.add(sparks);
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

  const audio = createCourtAudio();
  let mood: Mood = MOODS.sakura;
  let shake = 0;
  let hitStop = 0;
  let clock = 0;
  const spinAxis = new THREE.Vector3();
  const spinTurn = new THREE.Quaternion();
  const spinRotation = new THREE.Quaternion();
  const stretch = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const travel = new THREE.Vector3();
  const side = new THREE.Vector3();
  const view = new THREE.Vector3();

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const portrait = camera.aspect < 0.8;
    camera.fov = portrait ? 58 : 45;
    camera.position.set(0, portrait ? 1.55 : 1.35, portrait ? 4.6 : 3.1);
    camera.lookAt(0, portrait ? 0.2 : 0.04, 0);
    camera.updateProjectionMatrix();
    aimCamera.copy(camera);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const raycaster = new THREE.Raycaster();
  const paddlePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.53);
  const point = new THREE.Vector3();
  const position = new THREE.Vector3();
  const loader = new THREE.TextureLoader();
  let sceneRequest = 0;

  return {
    enableAudio: audio.enable,
    setMuted: audio.setMuted,
    /** Match lights, reflections, and ambience to the illustrated court behind the canvas. */
    setScene(name: CourtMood, image: string) {
      mood = MOODS[name];
      renderer.toneMappingExposure = mood.exposure;
      hemisphere.color.set(mood.sky);
      hemisphere.groundColor.set(mood.ground);
      hemisphere.intensity = mood.ambient;
      key.color.set(mood.key.color);
      key.intensity = mood.key.intensity;
      key.position.set(...mood.key.position).setLength(8);
      rim.color.set(mood.rim.color);
      rim.intensity = mood.rim.intensity;
      rim.position.set(...mood.rim.position);
      scene.environmentIntensity = mood.environment;
      floorShadow.opacity = mood.shadow;
      ballMaterial.emissiveIntensity = 0.08 + mood.glow * 0.4;
      audio.setAmbience(name);
      const request = ++sceneRequest;
      loader.load(image, (texture) => {
        if (request !== sceneRequest) return texture.dispose();
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        const next = pmrem.fromEquirectangular(texture).texture;
        texture.dispose();
        painted?.dispose();
        painted = next;
        scene.environment = next;
      });
    },
    aim(clientX: number, clientY: number, touch: boolean) {
      const rect = host.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top - (touch ? 42 : 0)) / rect.height) * 2 + 1,
        ),
        aimCamera,
      );
      if (raycaster.ray.intersectPlane(paddlePlane, point)) {
        game.target.x = point.x;
        game.target.y = point.y;
      }
    },
    /** Simulation speed for the next frame; a hard racket hit briefly freezes time. */
    timeScale() {
      return hitStop > 0 ? 0.1 : 1;
    },
    render(elapsed: number, alpha: number) {
      let dt = elapsed;
      if (game.phase !== "playing") {
        dt = 0;
        alpha = 1;
      }
      hitStop = Math.max(0, hitStop - dt);
      clock += dt;
      for (const impact of game.impacts) {
        const strength = Math.min(1, impact.speed / 7);
        const racket = impact.surface === "player" || impact.surface === "opponent";
        if (impact.surface === "player") {
          player.hit(strength);
          shake = Math.min(1, shake + strength * strength * 0.9);
          if (strength > 0.6) hitStop = 0.05 + (strength - 0.6) * 0.06;
        }
        if (impact.surface === "opponent") opponent.hit(strength);
        const pulse = pulses[nextPulse++ % pulses.length];
        pulse.age = 0;
        pulse.strength = strength;
        pulse.racket = racket;
        pulse.mesh.position.copy(impact.position);
        pulse.flash.position.copy(impact.position);
        if (impact.surface === "table") pulse.mesh.rotation.set(-Math.PI / 2, 0, 0);
        else pulse.mesh.quaternion.copy(camera.quaternion);
        if (racket) burst(pulse.flash.position, impact.surface === "player" ? -1 : 1, strength);
        audio.impact(impact);
      }
      game.impacts.length = 0;
      for (const pulse of pulses) {
        pulse.age += dt;
        const progress = pulse.age / 0.2;
        pulse.mesh.visible = progress < 1;
        pulse.mesh.scale.setScalar(1 + progress * (1 + pulse.strength * 1.5));
        pulse.mesh.material.opacity = Math.max(0, 1 - progress) * 0.7;
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
        for (let axis = 0; axis < 3; axis++)
          sparkPositions[i * 3 + axis] += sparkVelocity[i * 3 + axis] * dt;
      }
      sparkGeometry.attributes.position.needsUpdate = true;

      player.update(position.lerpVectors(game.previousPlayer, game.player, alpha), dt);
      opponent.update(position.lerpVectors(game.previousOpponent, game.opponent, alpha), dt);

      ballRoot.position.lerpVectors(game.previousBall, game.ball, alpha);
      const visible = game.waiting <= 0;
      ballRoot.visible = visible;
      const speed = Math.hypot(game.velocity.x, game.velocity.y, game.velocity.z);
      // Spin the printed ball by its angular velocity, then stretch the root along its flight.
      const spin = Math.hypot(game.spin.x, game.spin.y, game.spin.z);
      if (spin > 0 && dt > 0) {
        spinAxis.set(game.spin.x, game.spin.y, game.spin.z).divideScalar(spin);
        spinRotation.premultiply(spinTurn.setFromAxisAngle(spinAxis, spin * dt)).normalize();
      }
      const stretchAmount = clamp((speed - 4) * 0.02, 0, 0.22);
      if (speed > 0.01)
        stretch.setFromUnitVectors(
          up,
          travel.set(game.velocity.x, game.velocity.y, game.velocity.z).divideScalar(speed),
        );
      ballRoot.quaternion.copy(stretch);
      ballRoot.scale.set(1 - stretchAmount * 0.4, 1 + stretchAmount, 1 - stretchAmount * 0.4);
      ball.quaternion.copy(stretch).invert().multiply(spinRotation);

      glow.visible = visible;
      glow.position.copy(ballRoot.position);
      glow.scale.setScalar(0.1 + clamp(speed / 12, 0, 1) * 0.06);
      glow.material.opacity = mood.glow + clamp((speed - 5) / 6, 0, 1) * 0.3;
      shadow.visible =
        visible &&
        Math.abs(ballRoot.position.x) < TABLE.halfWidth &&
        Math.abs(ballRoot.position.z) < TABLE.halfLength;
      shadow.position.set(ballRoot.position.x, 0.003, ballRoot.position.z);
      shadow.scale.setScalar(0.8 + ballRoot.position.y * 1.6);
      shadow.material.opacity = clamp(1 - ballRoot.position.y * 1.4, 0.15, 1);

      const streak = visible ? clamp((speed - 3.5) / 6, 0, 1) * 0.6 : 0;
      trail.visible = streak > 0;
      if (trail.visible) {
        view.subVectors(camera.position, ballRoot.position);
        side.crossVectors(travel, view).normalize();
        for (let i = 0; i < TRAIL; i++) {
          const head = i / (TRAIL - 1);
          const back = (1 - head) * TRAIL_TIME;
          // Follow gravity's curve back along the flight.
          const x = ballRoot.position.x - game.velocity.x * back;
          const y = ballRoot.position.y - game.velocity.y * back - 4.9 * back * back;
          const z = ballRoot.position.z - game.velocity.z * back;
          const width = BALL_RADIUS * (0.2 + 0.8 * head);
          trailPositions.set([x + side.x * width, y + side.y * width, z + side.z * width], i * 6);
          trailPositions.set(
            [x - side.x * width, y - side.y * width, z - side.z * width],
            i * 6 + 3,
          );
          const alphaValue = head * head * streak;
          for (const offset of [0, 4]) {
            trailColors.set([trailColor.r, trailColor.g, trailColor.b, alphaValue], i * 8 + offset);
          }
        }
        trailGeometry.attributes.position.needsUpdate = true;
        trailGeometry.attributes.color.needsUpdate = true;
      }

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
      observer.disconnect();
      audio.dispose();
      player.dispose();
      opponent.dispose();
      studio.dispose();
      painted?.dispose();
      pmrem.dispose();
      for (const texture of textures) texture.dispose();
      // Shared geometries and materials are safe to dispose more than once.
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Points ||
          object instanceof THREE.Sprite
        ) {
          object.geometry.dispose();
          for (const material of [object.material].flat()) material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
