import type { Court } from "./court";
import type { PracticePhysics } from "./physics";

// Arrow keys share the WASD movement state.
const KEY_ALIASES: Record<string, string> = {
  ArrowUp: "w",
  ArrowLeft: "a",
  ArrowDown: "s",
  ArrowRight: "d",
};
const GAME_KEYS = new Set(["w", "a", "s", "d", " ", "p", "enter"]);
const normalizeKey = (key: string) => KEY_ALIASES[key] ?? key.toLowerCase();

/**
 * Steer the player's hand from a mouse, touch, or the keyboard until `signal` aborts. Losing focus
 * releases everything and pauses a rally in progress.
 */
export function bindControls(
  element: HTMLElement,
  game: PracticePhysics,
  court: Court,
  signal: AbortSignal,
) {
  const keys = new Set<string>();
  let activePointer: number | undefined;
  let lastPointer: { x: number; y: number; time: number } | undefined;

  const updateDrive = () => {
    game.drive = {
      x: Number(keys.has("d")) - Number(keys.has("a")),
      y: Number(keys.has("w")) - Number(keys.has("s")),
    };
  };
  const onPointerMove = (event: PointerEvent) => {
    // A mouse aims on hover; touch and pen aim only while their drag is active.
    const tracked = event.pointerId === activePointer;
    if (!tracked && (activePointer !== undefined || event.pointerType !== "mouse")) return;
    if (event.pointerType === "mouse") {
      const hand = court.handAt(event.clientX, event.clientY);
      if (hand) {
        game.target.x = hand.x;
        game.target.y = hand.y;
      }
    } else if (lastPointer) {
      // Touch steers like a trackpad: the paddle follows the finger's movement, not its spot,
      // so a finger dragging below the table never covers the paddle or the ball.
      const drag = court.handDrag(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
      game.nudge(drag.x, drag.y);
    }
    // A quick upward flick swings; its speed sets the power.
    if (lastPointer) {
      const elapsed = event.timeStamp - lastPointer.time;
      const upwardSpeed = (lastPointer.y - event.clientY) / Math.max(8, elapsed);
      if (elapsed < 100 && upwardSpeed > 0.45) game.swing(Math.min(1, upwardSpeed / 2));
    }
    lastPointer = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  };
  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== undefined) return;
    activePointer = event.pointerId;
    element.setPointerCapture(event.pointerId);
    lastPointer = undefined;
    onPointerMove(event);
    element.focus({ preventScroll: true });
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    activePointer = undefined;
    lastPointer = undefined;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLButtonElement) return;
    const key = normalizeKey(event.key);
    if (!GAME_KEYS.has(key)) return;
    event.preventDefault();
    keys.add(key);
    updateDrive();
    if (event.repeat) return;
    if (key === " ") game.swing();
    if (key === "p") game.togglePause();
    if (key === "enter" && game.phase === "ready") game.start();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    keys.delete(normalizeKey(event.key));
    updateDrive();
  };
  const onBlur = () => {
    keys.clear();
    updateDrive();
    activePointer = undefined;
    lastPointer = undefined;
    if (game.phase === "playing") game.togglePause();
  };

  element.addEventListener("pointerdown", onPointerDown, { signal });
  element.addEventListener("pointermove", onPointerMove, { signal });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    element.addEventListener(type, onPointerEnd, { signal });
  }
  window.addEventListener("keydown", onKeyDown, { signal });
  window.addEventListener("keyup", onKeyUp, { signal });
  window.addEventListener("blur", onBlur, { signal });
  document.addEventListener("visibilitychange", () => document.hidden && onBlur(), { signal });
}
