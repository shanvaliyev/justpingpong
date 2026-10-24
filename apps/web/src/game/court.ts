import * as THREE from "three";

import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { BALL_RADIUS, TABLE, type PracticePhysics } from "./physics";
import { createRacket } from "./racket";

export function createCourt(host: HTMLElement, game: PracticePhysics) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 30);
  scene.add(new THREE.HemisphereLight(0xfffcf1, 0x7e9fba, 2.4));
  const sunlight = new THREE.DirectionalLight(0xfff2dc, 2.8);
  sunlight.position.set(-3, 6, 3);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunlight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
  sunlight.shadow.normalBias = 0.025;
  scene.add(sunlight);

  const green = new THREE.MeshStandardMaterial({ color: 0x248e9a, roughness: 0.87 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x285866, roughness: 0.75 });
  const white = new THREE.MeshStandardMaterial({ color: 0xfff9e8 });
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material = dark,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  // Only render shadows over the illustrated courtyard floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({ opacity: 0.18 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.76;
  floor.receiveShadow = true;
  scene.add(floor);
  box(1.56, 0.07, 2.78, 0, -0.05, 0);
  box(TABLE.halfWidth * 2, 0.025, TABLE.halfLength * 2, 0, -0.0125, 0, green);
  for (const x of [-0.75, 0.75]) box(0.015, 0.002, 2.73, x, 0.002, 0, white);
  for (const z of [-1.358, 1.358]) box(1.515, 0.002, 0.015, 0, 0.002, z, white);
  box(0.008, 0.002, 2.73, 0, 0.002, 0, white);
  for (const x of [-0.61, 0.61]) {
    for (const z of [-1.04, 1.04]) box(0.055, 0.68, 0.055, x, -0.42, z);
    box(0.035, 0.035, 2.1, x, -0.55, 0);
  }
  for (const x of [-0.8, 0.8]) box(0.025, 0.21, 0.025, x, 0.07, 0);
  const netPoints: number[] = [];
  for (let x = -0.79; x <= 0.8; x += 0.025) netPoints.push(x, 0.012, 0, x, TABLE.netHeight, 0);
  for (let y = 0.012; y <= TABLE.netHeight; y += 0.02) netPoints.push(-0.8, y, 0, 0.8, y, 0);
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute("position", new THREE.Float32BufferAttribute(netPoints, 3));
  scene.add(
    new THREE.LineSegments(
      netGeometry,
      new THREE.LineBasicMaterial({ color: 0x466258, transparent: true, opacity: 0.65 }),
    ),
  );
  box(1.62, 0.012, 0.012, 0, TABLE.netHeight, 0, white);

  // A soft studio reflection for the rackets only, so lacquer and rubber catch the light.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const player = createRacket({ side: 1, forehand: "black", envMap });
  const opponent = createRacket({ side: -1, forehand: "red", envMap });
  scene.add(player.object, opponent.object);
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffa127,
      emissive: 0xb95b0c,
      emissiveIntensity: 0.25,
      roughness: 0.55,
    }),
  );
  ball.castShadow = true;
  scene.add(ball);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.055, 32),
    new THREE.MeshBasicMaterial({
      color: 0x122e25,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const portrait = camera.aspect < 0.8;
    camera.fov = portrait ? 58 : 45;
    camera.position.set(0, portrait ? 1.55 : 1.35, portrait ? 4.6 : 3.1);
    camera.lookAt(0, portrait ? 0.2 : 0.04, 0);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const raycaster = new THREE.Raycaster();
  const paddlePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.53);
  const point = new THREE.Vector3();
  let previousVz = 0;

  return {
    aim(clientX: number, clientY: number, touch: boolean) {
      const rect = host.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top - (touch ? 42 : 0)) / rect.height) * 2 + 1,
        ),
        camera,
      );
      if (raycaster.ray.intersectPlane(paddlePlane, point)) {
        game.target.x = point.x;
        game.target.y = point.y;
      }
    },
    render(dt: number) {
      // A reversed ball near a racket means that racket just struck it (net bounces are mid-table).
      const vz = game.velocity.z;
      if (previousVz > 0 && vz < 0 && game.ball.z > 1) player.hit(Math.min(1, -vz / 4));
      if (previousVz < 0 && vz > 0 && game.ball.z < -1) opponent.hit(Math.min(1, vz / 4));
      previousVz = vz;
      player.update(game.player, dt);
      opponent.update(game.opponent, dt);
      ball.position.copy(game.ball);
      ball.visible = game.waiting <= 0;
      shadow.visible =
        ball.visible &&
        Math.abs(game.ball.x) < TABLE.halfWidth &&
        Math.abs(game.ball.z) < TABLE.halfLength;
      shadow.position.set(game.ball.x, 0.005, game.ball.z);
      shadow.scale.setScalar(1 + game.ball.y * 0.5);
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      player.dispose();
      opponent.dispose();
      envMap.dispose();
      // Shared geometries and materials are safe to dispose more than once.
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          for (const material of [object.material].flat()) material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
