import { ArrowUpRight, CircleHelp, Move, Pause, Play, RotateCcw, CircleDot } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createCourt } from "./court";
import { PracticePhysics, STEP } from "./physics";
import "./practice.css";

export function PracticeGame() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef(new PracticePhysics());
  const [hud, setHud] = useState({
    phase: game.current.phase,
    rally: 0,
    best: 0,
    speed: 0,
    message: game.current.message,
  });
  const [help, setHelp] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = host.current!;
    const physics = game.current;
    let court: ReturnType<typeof createCourt>;
    try {
      court = createCourt(element, physics);
    } catch {
      setError(true);
      return;
    }
    let frame = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let lastHud = 0;
    let lastPointer: { y: number; time: number } | undefined;
    let activePointer: number | undefined;
    const keys = new Set<string>();
    const draw = (time: number) => {
      accumulator += Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      while (accumulator >= STEP) {
        if (physics.phase === "playing") {
          const dx =
            Number(keys.has("ArrowRight") || keys.has("d")) -
            Number(keys.has("ArrowLeft") || keys.has("a"));
          const dy =
            Number(keys.has("ArrowUp") || keys.has("w")) -
            Number(keys.has("ArrowDown") || keys.has("s"));
          if (dx) physics.target.x = physics.player.x + dx * STEP * 1.8;
          if (dy) physics.target.y = physics.player.y + dy * STEP * 1.8;
        }
        physics.step();
        accumulator -= STEP;
      }
      court.render();
      if (time - lastHud > 80) {
        setHud({
          phase: physics.phase,
          rally: physics.rally,
          best: physics.best,
          speed: physics.speed,
          message: physics.message,
        });
        lastHud = time;
      }
      frame = requestAnimationFrame(draw);
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerId !== activePointer) return;
      if (activePointer !== undefined && event.pointerId !== activePointer) return;
      court.aim(event.clientX, event.clientY, event.pointerType !== "mouse");
      if (lastPointer) {
        const elapsed = event.timeStamp - lastPointer.time;
        const upwardSpeed = (lastPointer.y - event.clientY) / Math.max(8, elapsed);
        if (elapsed < 100 && upwardSpeed > 0.45) physics.swing(Math.min(1, upwardSpeed / 2));
      }
      lastPointer = { y: event.clientY, time: event.timeStamp };
    };
    const pointerDown = (event: PointerEvent) => {
      if (activePointer !== undefined) return;
      activePointer = event.pointerId;
      element.setPointerCapture(event.pointerId);
      lastPointer = undefined;
      pointerMove(event);
      element.focus({ preventScroll: true });
    };
    const pointerEnd = (event: PointerEvent) => {
      if (event.pointerId === activePointer) {
        activePointer = undefined;
        lastPointer = undefined;
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLButtonElement) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          " ",
          "w",
          "a",
          "s",
          "d",
          "p",
          "Enter",
        ].includes(key)
      ) {
        event.preventDefault();
        keys.add(key);
      }
      if (event.repeat) return;
      if (key === " ") physics.swing();
      if (key === "p") physics.pause();
      if (key === "Enter" && physics.phase === "ready") physics.start();
    };
    const keyUp = (event: KeyboardEvent) =>
      keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
    const blur = () => {
      keys.clear();
      lastPointer = undefined;
      activePointer = undefined;
      if (physics.phase === "playing") physics.pause();
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    element.addEventListener("pointerdown", pointerDown);
    element.addEventListener("pointermove", pointerMove);
    element.addEventListener("pointerup", pointerEnd);
    element.addEventListener("pointercancel", pointerEnd);
    element.addEventListener("lostpointercapture", pointerEnd);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      court.dispose();
      element.removeEventListener("pointerdown", pointerDown);
      element.removeEventListener("pointermove", pointerMove);
      element.removeEventListener("pointerup", pointerEnd);
      element.removeEventListener("pointercancel", pointerEnd);
      element.removeEventListener("lostpointercapture", pointerEnd);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const focusCourt = () => host.current?.focus({ preventScroll: true });
  const start = () => {
    game.current.start();
    focusCourt();
  };
  const pause = () => {
    game.current.pause();
    setHelp(false);
    focusCourt();
  };
  const toggleHelp = () => {
    if (!help && game.current.phase === "playing") game.current.pause();
    setHelp(!help);
  };

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
            onClick={pause}
            disabled={hud.phase === "ready" || error}
            aria-label={hud.phase === "paused" ? "Resume game" : "Pause game"}
          >
            {hud.phase === "paused" ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button
            onClick={() => {
              game.current.reset();
              setHelp(false);
              focusCourt();
            }}
            disabled={error}
            aria-label="Restart rally"
            title="Restart rally"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <section className="practice-stage" aria-label="Table tennis practice">
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
            <strong className="best-stat">{hud.best}</strong>
          </div>
        </div>

        {(hud.phase === "ready" || hud.phase === "paused" || help || error) && (
          <div className="practice-overlay">
            <div className="practice-card">
              <span className="card-flower" aria-hidden="true">
                ✿
              </span>
              <span className="card-eyebrow">
                {error ? "WEBGL UNAVAILABLE" : help ? "THE BASICS" : "SAKURA COURT"}
              </span>
              <h2>
                {error
                  ? "Your court couldn’t load."
                  : help
                    ? "Controls"
                    : hud.phase === "paused"
                      ? "Paused"
                      : "Table tennis"}
              </h2>
              <p>
                {error
                  ? "Try a browser with WebGL enabled, then reload this page."
                  : help
                    ? "Move your mouse or drag a finger to aim. Hold the paddle still to block; flick upward to hit harder. Returns use assisted aiming. Misses automatically feed a new ball."
                    : hud.phase === "paused"
                      ? "Resume to continue the rally."
                      : "Play against AI. Move or drag to position your paddle; flick upward to swing."}
              </p>
              {help && (
                <p className="keyboard-help">
                  Keyboard: arrow keys / WASD to move · Space to swing · P to pause.
                </p>
              )}
              {!error && (
                <button
                  className="play-button"
                  onClick={
                    help
                      ? () => {
                          setHelp(false);
                          focusCourt();
                        }
                      : hud.phase === "paused"
                        ? pause
                        : start
                  }
                >
                  {help ? "Close" : hud.phase === "paused" ? "Resume" : "Start playing"}
                  <ArrowUpRight size={19} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="court-bottom">
          <div className={hud.message ? "live-status" : undefined} role="status">
            {hud.message && <span className="status-dot" />}
            {hud.message}
          </div>
          <span className="shot-speed">
            {hud.speed ? `${hud.speed.toFixed(1)} m/s` : "— m/s"}
            <small>LAST RETURN</small>
          </span>
        </div>
      </section>

      <footer className="practice-footer">
        <h1 className="footer-note">
          <span aria-hidden="true">✿</span> Sakura court <span>· AI opponent</span>
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
