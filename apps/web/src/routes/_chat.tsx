import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";

import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import ThreadStatusNotificationController from "../components/ThreadStatusNotificationController";
import ThreadRecencyController from "../components/ThreadRecencyController";
import ThreadSidebar from "../components/Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import {
  canAcceptThreadSidebarWidth,
  readInitialThreadSidebarWidth,
  resolveAcceptedThreadSidebarWidth,
  THREAD_SIDEBAR_MAX_WIDTH_PX,
  THREAD_SIDEBAR_MIN_WIDTH_PX,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../threadSidebarWidth";

function ChatRouteLayout() {
  const navigate = useNavigate();
  const [initialThreadSidebarWidth, setInitialThreadSidebarWidth] = useState(() =>
    readInitialThreadSidebarWidth(),
  );

  useLayoutEffect(() => {
    const wrapper = document.querySelector<HTMLElement>("[data-thread-sidebar-layout='true']");
    if (!wrapper) {
      return;
    }

    const acceptedWidth = resolveAcceptedThreadSidebarWidth({
      preferredWidth: initialThreadSidebarWidth,
      wrapper,
    });
    if (acceptedWidth === initialThreadSidebarWidth) {
      return;
    }

    setInitialThreadSidebarWidth(acceptedWidth);
    try {
      window.localStorage.setItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, String(acceptedWidth));
    } catch {
      // Ignore storage failures to avoid blocking the initial render path.
    }
  }, [initialThreadSidebarWidth]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider
      defaultOpen
      data-thread-sidebar-layout="true"
      style={{ "--sidebar-width": `${initialThreadSidebarWidth}px` } as CSSProperties}
    >
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          minWidth: THREAD_SIDEBAR_MIN_WIDTH_PX,
          maxWidth: THREAD_SIDEBAR_MAX_WIDTH_PX,
          shouldAcceptWidth: canAcceptThreadSidebarWidth,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      <DiffWorkerPoolProvider>
        <ThreadRecencyController />
        <ThreadStatusNotificationController />
        <Outlet />
      </DiffWorkerPoolProvider>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
