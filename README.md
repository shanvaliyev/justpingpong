# justpingpong

An arcade table-tennis game built with React, TanStack Router, and Three.js.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **Cloudflare D1** - Database engine
- **Authentication** - Better-Auth
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **PWA** - Progressive Web App support
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

### Play the local prototype

Run `pnpm dev:web` and open the web app. The home page is a first-person table-tennis practice game; it needs no API server, database, account, or environment variables.

- Mobile-first: drag one finger anywhere to steer the floating paddle. Like a trackpad, it follows the finger's movement (1.5× its travel) rather than jumping under it, so you can drag below the table and keep the paddle and ball in view. Portrait phones frame the table as close as still shows the ball's widest arrivals. Flick upward to swing forward; a stationary paddle can block. Start, pause, resume, restart, and mute all have touch controls.
- Brush left or right at contact to place and curve a shot; brushing upward (a natural upward flick) adds topspin, which dips the ball and kicks it forward off the table. Off-centre hits also steer the ball, and stronger forward strokes drive it faster. The racket's wrist picks the face angle, like a real player, so any stroke struck near the blade centre clears the net. Hitting high on the blade sends the ball deeper (the top edge of a hard drive goes long), hitting low drops it shorter, and sideways brushing can go wide.
- Optional desktop controls: move the mouse, or use arrow keys / WASD to move, Space to swing, P to pause. Keyboard hints are hidden on touch devices; no game action requires a keyboard.
- A friendly AI returns the ball. Misses automatically feed a new ball. Restart clears the current rally, but keeps the session best until the page reloads.
- Physics run at 120 Hz with real gravity, air drag, spin (Magnus curve, table kick, and rubber grip on brushing strokes), time-of-impact paddle/net/table contacts, momentum-based player returns, and interpolated rendering. The feed and AI choose landing points; player power and direction come from the stroke, while an automatic face angle sets the arc. All of them aim through the same drag and spin. Contact-offset steering and a forgiving hitbox keep this an arcade game, without regulation scoring or multiplayer.
- Racket recoil, landing rings on bounces, flashes, streaking sparks and a brief burst of real light on racket hits, motion smear behind fast rackets and balls, a brief hit-stop, camera kick, and zoom punch on hard player hits (the hardest also get a moment of slow motion), and sounds panned to where they happen mark impacts: recorded racket hits and table bounces (two takes each, with subtle pitch variation, impact-based volume, and quieter far-side hits), plus a synthesized net sound that also covers loading failures. Fast balls leave a short streak, and the printed ball visibly spins. Each court has a quiet ambience (waves, breeze, city). The speaker button mutes all sound.
- The red/black forehand/backhand flip follows the paddle across the body. This visual effect does not change the collision response.
- A new game randomly selects a spring afternoon on a Kyoto sakura terrace, sunset on a Shonan boardwalk, or a blue-hour Tokyo rooftop. Manual restart picks again (repeats are possible); misses and pause/resume keep the current scene.
- Each court is a real 3D scene: a textured floor (normal and roughness maps) and a wall or railing that take shadows, under a generated photo of the distance that is lens-blurred as if the camera were focused on the table; depth of field softens the far floor and wall the same way. The table is a worn tournament table (ball marks, scuffed lines, steel chassis, regulation net posts), and the rackets show their wood plies, sponge, and a laminated handle. Lights, reflections, and haze follow the photo, and Tokyo adds a floodlight. Cherry petals or dust drift through the air. The frame is finished like a film camera in one post pass: high dynamic range with bloom, filmic (ACES) tone mapping, a per-court colour grade, vignette, and grain. The drawn camera breathes slightly and leans towards the ball; aiming always uses the steady camera. On slow devices the game turns off antialiasing, then lowers its resolution. The title screen draws about 30 frames a second to save battery before play starts.

Check the web build and types with `pnpm --filter web check-types`. Run physics regression tests, and a check that the declared font slices cover the game's text, with `pnpm --filter web test` (Node 22.18+ for native TypeScript loading).

## Database Setup

This project uses Cloudflare D1 (SQLite) with Drizzle ORM.

Runtime database access uses the Cloudflare `DB` binding from `packages/infra/alchemy.run.ts`. If a local `DATABASE_URL` is present, it is only for database tooling.

Alchemy provisions the D1 database and applies migrations during `deploy`.

1. Generate migration files:

```bash
pnpm run db:generate
```

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@justpingpong/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

### Alchemy

- Target: web on Cloudflare + server on Cloudflare
- Configure provider accounts: `cd packages/infra && pnpm exec alchemy profile edit`
- Dev: pnpm run dev
- Deploy: pnpm run deploy
- Destroy: pnpm run destroy

`alchemy profile edit` stores the selected Axiom, Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `live_<username>` stage; `alchemy dev` defaults to `dev_<username>`. Keep using the explicit `production` stage to update the existing production stack:

```bash
cd packages/infra && pnpm exec alchemy deploy --stage production
```

### Production origins

The stack declares `justpingpong.com` for the web app and `api.justpingpong.com` for the API. Alchemy manages their DNS records and HTTPS certificates in the existing Cloudflare zone; the zone must be active in the deploying account, with provider credentials authorized to attach custom domains. `alchemy dev` serves local URLs without attaching these deployed domains. Before adding another cloud deployment stage, give it separate domains or make these declarations production-only so it does not request the same hostnames.

Before deploying production, set this in your ignored `apps/server/.env` (or supply it through the deployment environment):

```dotenv
CORS_ORIGIN=https://justpingpong.com
```

Alchemy derives `BETTER_AUTH_URL` and `VITE_SERVER_URL` from the API's custom domain. Keep the existing `BETTER_AUTH_SECRET` unchanged. Redeploy with `pnpm run deploy --stage production` from the repository root to apply the domain configuration to the existing production stack.

For local development, use `CORS_ORIGIN=http://localhost:3001` and the default dev stage, not `--stage production`.

## Git Hooks and Formatting

- Run checks: `pnpm run check`

## Project Structure

```
justpingpong/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:generate`: Generate database client/types
- `pnpm run check`: Run Oxlint and Oxfmt
- `cd apps/web && pnpm run generate-pwa-assets`: Generate PWA assets
