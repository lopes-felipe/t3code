import "../index.css";

import {
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type WsWelcomePayload,
  WS_CHANNELS,
  WS_METHODS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import type { ReactNode } from "react";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { getRouter } from "../router";
import { useStore } from "../store";
import {
  THREAD_SIDEBAR_MAX_WIDTH_PX,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../threadSidebarWidth";

vi.mock("./DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock("./DiffPanel", () => ({
  default: ({ mode = "inline" }: { mode?: string }) => (
    <div data-testid={`mock-diff-panel-${mode}`}>Mock diff panel</div>
  ),
}));

const THREAD_ID = "thread-sidebar-browser-test" as ThreadId;
const PROJECT_ID = "project-sidebar-browser-test" as ProjectId;
const NOW_ISO = "2026-03-11T12:00:00.000Z";
const LONG_THREAD_TITLE =
  "A very long thread title that should stay intact and benefit from a wider sidebar during resize tests";

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
}

let fixture: TestFixture;

const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
      },
    ],
    availableEditors: [],
  };
}

function createSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModel: "gpt-5",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: LONG_THREAD_TITLE,
        model: "gpt-5",
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        archivedAt: null,
        createdAt: NOW_ISO,
        lastInteractionAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
        messages: [
          {
            id: "msg-sidebar-browser-test" as MessageId,
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: NOW_ISO,
            updatedAt: NOW_ISO,
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(): TestFixture {
  return {
    snapshot: createSnapshot(),
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
  };
}

function resolveWsRpc(tag: string): unknown {
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }

  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    client.send(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverWelcome,
        data: fixture.welcome,
      }),
    );
    client.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;

      let request: { id: string; body: { _tag: string } };
      try {
        request = JSON.parse(event.data) as { id: string; body: { _tag: string } };
      } catch {
        return;
      }

      const method = request.body?._tag;
      if (typeof method !== "string") return;
      client.send(
        JSON.stringify({
          id: request.id,
          result: resolveWsRpc(method),
        }),
      );
    });
  }),
  http.get("*/attachments/:attachmentId", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function setViewport(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  await waitForLayout();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
    },
    { timeout: 4_000, interval: 16 },
  );
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );

  if (!element) {
    throw new Error(errorMessage);
  }

  return element;
}

function querySidebarRoot(side: "left" | "right"): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slot='sidebar'][data-side='${side}']`);
}

function querySidebarContainer(side: "left" | "right"): HTMLElement | null {
  return (
    querySidebarRoot(side)?.querySelector<HTMLElement>("[data-slot='sidebar-container']") ?? null
  );
}

function querySidebarRail(side: "left" | "right"): HTMLButtonElement | null {
  return (
    querySidebarRoot(side)?.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']") ?? null
  );
}

function queryMainInset(): HTMLElement | null {
  return document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']");
}

function readSidebarWidth(side: "left" | "right"): number {
  const container = querySidebarContainer(side);
  if (!container) {
    throw new Error(`${side} sidebar container is unavailable.`);
  }

  return container.getBoundingClientRect().width;
}

function readMainInsetWidth(): number {
  const mainInset = queryMainInset();
  if (!mainInset) {
    throw new Error("Main inset is unavailable.");
  }

  return mainInset.getBoundingClientRect().width;
}

function dispatchPointerEvent(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  position: { x: number; y: number },
  buttons: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      clientX: position.x,
      clientY: position.y,
    }),
  );
}

function beginResize(rail: HTMLButtonElement): { startX: number; y: number } {
  const rect = rail.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  dispatchPointerEvent(rail, "pointerdown", { x: startX, y }, 1);
  return { startX, y };
}

async function moveResize(
  rail: HTMLButtonElement,
  gesture: { startX: number; y: number },
  nextX: number,
): Promise<void> {
  dispatchPointerEvent(rail, "pointermove", { x: nextX, y: gesture.y }, 1);
  await waitForLayout();
}

async function endResize(
  rail: HTMLButtonElement,
  gesture: { startX: number; y: number },
  endX: number,
): Promise<void> {
  dispatchPointerEvent(rail, "pointerup", { x: endX, y: gesture.y }, 0);
  await waitForLayout();
}

async function mountApp(options: {
  height?: number;
  initialEntries: string[];
  width: number;
}): Promise<{
  cleanup: () => Promise<void>;
  host: HTMLDivElement;
  router: ReturnType<typeof getRouter>;
}> {
  fixture = buildFixture();
  await setViewport(options.width, options.height ?? 1_100);
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: options.initialEntries,
    }),
  );
  const screen = await render(<RouterProvider router={router} />, {
    container: host,
  });

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
    host,
    router,
  };
}

describe("Thread sidebar resizing", () => {
  beforeAll(async () => {
    fixture = buildFixture();
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: {
        url: "/mockServiceWorker.js",
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resizes immediately on an active thread route and preserves the width across route changes", async () => {
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      const wrapper = await waitForElement(
        () => mounted.host.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']"),
        "Sidebar wrapper should render.",
      );
      expect(queryMainInset()).toBeTruthy();
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");

      const rail = await waitForElement(
        () => querySidebarRail("left"),
        "Left sidebar rail should render.",
      );
      const beforeSidebarWidth = readSidebarWidth("left");
      const beforeMainWidth = readMainInsetWidth();
      const gesture = beginResize(rail);

      await moveResize(rail, gesture, gesture.startX + 120);

      const duringSidebarWidth = readSidebarWidth("left");
      const duringMainWidth = readMainInsetWidth();
      expect(duringSidebarWidth).toBeGreaterThan(beforeSidebarWidth + 80);
      expect(duringMainWidth).toBeLessThan(beforeMainWidth - 80);

      await endResize(rail, gesture, gesture.startX + 120);
      expect(localStorage.getItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY)).toBeTruthy();

      await mounted.router.navigate({ to: "/" });
      await waitForLayout();
      await waitForElement(
        () =>
          Array.from(document.querySelectorAll("p")).find((element) =>
            element.textContent?.includes("Select a thread or create a new one"),
          ) ?? null,
        "Empty thread screen should render.",
      );

      expect(readSidebarWidth("left")).toBeCloseTo(duringSidebarWidth, 0);
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses the persisted width on mount and clamps persisted values into range", async () => {
    localStorage.setItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, "320");
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      const wrapper = await waitForElement(
        () => mounted.host.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']"),
        "Sidebar wrapper should render.",
      );
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("320px");
      expect(readSidebarWidth("left")).toBeCloseTo(320, 0);
    } finally {
      await mounted.cleanup();
    }

    localStorage.setItem(
      THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
      String(THREAD_SIDEBAR_MAX_WIDTH_PX + 256),
    );
    const clampedMount = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      const wrapper = await waitForElement(
        () => clampedMount.host.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']"),
        "Sidebar wrapper should render.",
      );
      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe(
        `${THREAD_SIDEBAR_MAX_WIDTH_PX}px`,
      );
      expect(readSidebarWidth("left")).toBeCloseTo(THREAD_SIDEBAR_MAX_WIDTH_PX, 0);
    } finally {
      await clampedMount.cleanup();
    }
  });
});
