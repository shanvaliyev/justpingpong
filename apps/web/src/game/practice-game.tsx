import { ArrowUpRight, CircleDot, CircleHelp, Move, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createCourt } from "./court";
import { PracticePhysics, STEP } from "./physics";
import "./practice.css";

const COURTS = [
  { name: "Sakura court", image: "/game/sakura-court.webp" },
  { name: "Seaside court", image: "/game/seaside-court.webp" },
  { name: "Tokyo rooftop", image: "/game/tokyo-court.webp" },
];
const randomCourt = () => COURTS[Math.floor(Math.random() * COURTS.length)];

// Arrow keys share the WASD movement state.
const KEY_ALIASES: Record<string, string> = {
  ArrowUp: "w",
  ArrowLeft: "a",
  ArrowDown: "s",
  ArrowRight: "d",
};
const GAME_KEYS = new Set(["w", "a", "s", "d", " ", "p", "enter"]);
const normalizeKey = (key: string) => KEY_ALIASES[key] ?? key.toLowerCase();

export function PracticeGame() {
  const host = useRef<HTMLDivElement>(null);
  const [game] = useState(() => new PracticePhysics());
  const [scene, setScene] = useState(randomCourt);
  const [hud, setHud] = useState({ phase: game.phase, rally: 0, best: 0, message: "" });
  const [help, setHelp] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = host.current!;
    let court: ReturnType<typeof createCourt>;
    try {
      court = createCourt(element, game);
    } catch {
      setError(true);
      return;
    }
    // Warm the other backgrounds so restarting does not leave an empty court.
    for (const { image } of COURTS) new Image().src = image;

    const keys = new Set<string>();
    let activePointer: number | undefined;
    let lastPointer: { y: number; time: number } | undefined;
    let frame = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let lastHud = 0;

    const draw = (time: number) => {
      const elapsed = Math.min((time - previousTime) / 1000, 0.05);
      accumulator += elapsed;
      previousTime = time;
      while (accumulator >= STEP) {
        if (game.phase === "playing") {
          const dx = Number(keys.has("d")) - Number(keys.has("a"));
          const dy = Number(keys.has("w")) - Number(keys.has("s"));
          if (dx) game.target.x = game.player.x + dx * STEP * 1.8;
          if (dy) game.target.y = game.player.y + dy * STEP * 1.8;
        }
        game.step();
        accumulator -= STEP;
      }
      court.render(elapsed);
      if (time - lastHud > 80) {
        lastHud = time;
        setHud({ phase: game.phase, rally: game.rally, best: game.best, message: game.message });
      }
      frame = requestAnimationFrame(draw);
    };

    const onPointerMove = (event: PointerEvent) => {
      // A mouse aims on hover; touch and pen aim only while their drag is active.
      const tracked = event.pointerId === activePointer;
      if (!tracked && (activePointer !== undefined || event.pointerType !== "mouse")) return;
      court.aim(event.clientX, event.clientY, event.pointerType !== "mouse");
      if (lastPointer) {
        const elapsed = event.timeStamp - lastPointer.time;
        const upwardSpeed = (lastPointer.y - event.clientY) / Math.max(8, elapsed);
        if (elapsed < 100 && upwardSpeed > 0.45) game.swing(Math.min(1, upwardSpeed / 2));
      }
      lastPointer = { y: event.clientY, time: event.timeStamp };
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
      if (event.repeat) return;
      if (key === " ") game.swing();
      if (key === "p") game.pause();
      if (key === "enter" && game.phase === "ready") game.start();
    };
    const onBlur = () => {
      keys.clear();
      activePointer = undefined;
      lastPointer = undefined;
      if (game.phase === "playing") game.pause();
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    element.addEventListener("pointerdown", onPointerDown, { signal });
    element.addEventListener("pointermove", onPointerMove, { signal });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
      element.addEventListener(type, onPointerEnd, { signal });
    }
    window.addEventListener("keydown", onKeyDown, { signal });
    window.addEventListener("keyup", (event) => keys.delete(normalizeKey(event.key)), { signal });
    window.addEventListener("blur", onBlur, { signal });
    document.addEventListener("visibilitychange", () => document.hidden && onBlur(), { signal });
    frame = requestAnimationFrame(draw);

    return () => {
      listeners.abort();
      cancelAnimationFrame(frame);
      court.dispose();
    };
  }, [game]);

  const focusCourt = () => host.current?.focus({ preventScroll: true });
  const start = () => {
    game.start();
    focusCourt();
  };
  const togglePause = () => {
    game.pause();
    setHelp(false);
    focusCourt();
  };
  const restart = () => {
    setScene(randomCourt());
    game.reset();
    setHelp(false);
    focusCourt();
  };
  const closeHelp = () => {
    setHelp(false);
    focusCourt();
  };
  const toggleHelp = () => {
    if (!help && game.phase === "playing") game.pause();
    setHelp(!help);
  };

  const card = error
    ? {
        eyebrow: "WebGL unavailable",
        title: "Your court couldn’t load.",
        body: "Try a browser with WebGL enabled, then reload this page.",
      }
    : help
      ? {
          eyebrow: "The basics",
          title: "Controls",
          body: "Move your mouse or drag a finger to aim. Hold the paddle still to block; flick upward to hit harder. Returns use assisted aiming. Misses automatically feed a new ball.",
          note: "Keyboard: arrow keys / WASD to move · Space to swing · P to pause.",
          action: { label: "Close", onClick: closeHelp },
        }
      : hud.phase === "paused"
        ? {
            eyebrow: scene.name,
            title: "Paused",
            body: "Resume to continue the rally.",
            action: { label: "Resume", onClick: togglePause },
          }
        : hud.phase === "ready"
          ? {
              eyebrow: scene.name,
              title: "Table tennis",
              body: "Play against AI. Move or drag to position your paddle; flick upward to swing.",
              action: { label: "Start playing", onClick: start },
            }
          : undefined;

  return (
    <main className="practice-app">
      <header className="practice-header">
        <a className="practice-brand" href="/" aria-label="justpingpong home">
          <span className="brand-mark">
            <CircleDot size={21} strokeWidth={1.8} />
          </span>
          justpingpong<span className="brand-period">.</span>
        </a>
        <div className="practice-actions">
          <button onClick={toggleHelp} aria-label="How to play" aria-expanded={help}>
            <CircleHelp size={19} />
          </button>
          <button
            onClick={togglePause}
            disabled={hud.phase === "ready" || error}
            aria-label={hud.phase === "paused" ? "Resume game" : "Pause game"}
          >
            {hud.phase === "paused" ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button
            onClick={restart}
            disabled={error}
            aria-label="Restart rally"
            title="Restart rally"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <section
        className="practice-stage"
        aria-label="Table tennis practice"
        style={{ backgroundImage: `url(${scene.image})` }}
      >
        <div
          ref={host}
          className="court-canvas"
          tabIndex={0}
          role="application"
          aria-label="Table tennis court. Move the mouse or drag to position your paddle. Flick upward or press Space to swing. Arrow keys move the paddle; P pauses."
        />
        <div className="practice-stats" aria-label="Practice statistics">
          <div>
            <span>Returns</span>
            <strong key={hud.rally}>{hud.rally}</strong>
          </div>
          <div>
            <span>Best</span>
            <strong>{hud.best}</strong>
          </div>
        </div>

        {card && (
          <div className="practice-overlay">
            <div className="practice-card">
              <span className="card-flower" aria-hidden="true">
                ✿
              </span>
              <span className="card-eyebrow">{card.eyebrow}</span>
              <h2>{card.title}</h2>
              <p>{card.body}</p>
              {card.note && <p className="keyboard-help">{card.note}</p>}
              {card.action && (
                <button className="play-button" onClick={card.action.onClick}>
                  {card.action.label}
                  <ArrowUpRight size={19} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="court-bottom" role="status">
          {hud.message && (
            <span className="live-status">
              <span className="status-dot" />
              {hud.message}
            </span>
          )}
        </div>
      </section>

      <footer className="practice-footer">
        <h1 className="footer-note">
          <span aria-hidden="true">✿</span> {scene.name} <span>· AI opponent</span>
        </h1>
        <div className="control-hints">
          <span>
            <Move size={16} /> Move / drag to aim
          </span>
          <span>
            <ArrowUpRight size={17} /> Flick up to swing
          </span>
          <button onClick={toggleHelp}>
            How to play <CircleHelp size={15} />
          </button>
        </div>
      </footer>
    </main>
  );
}
