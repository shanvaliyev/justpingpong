import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { orpc } from "@/utils/orpc";

import "../index.css";

const AppShell = lazy(() => import("@/components/app-shell"));

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "justpingpong",
      },
      {
        name: "description",
        content: "justpingpong is a web application",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
});

function RootComponent() {
  const isPractice = useRouterState({ select: (state) => state.location.pathname === "/" });

  if (isPractice) {
    return (
      <>
        <HeadContent />
        <Outlet />
      </>
    );
  }

  return (
    <>
      <HeadContent />
      <Suspense>
        <AppShell>
          <Outlet />
        </AppShell>
      </Suspense>
    </>
  );
}
