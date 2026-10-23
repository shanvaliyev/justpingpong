import { createFileRoute } from "@tanstack/react-router";

import { PracticeGame } from "@/game/practice-game";

export const Route = createFileRoute("/")({
  component: PracticeGame,
});
