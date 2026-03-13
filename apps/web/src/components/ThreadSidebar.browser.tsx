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

import { COMPOSER_DRAFT_STORAGE_KEY, useComposerDraftStore } from "../composerDraftStore";
import { getRouter } from "../router";
import { useStore } from "../store";
import { useThreadSelectionStore } from "../threadSelectionStore";
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
const UUID_ROUTE_RE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LONG_THREAD_TITLE =
  "A very long thread title that should stay intact and benefit from a wider sidebar during resize tests";

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
}

let fixture: TestFixture;

const wsLink = ws.link(/ws(s)?:\/\/.*/);

type SnapshotThread = OrchestrationReadModel["threads"][number];

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

function createSidebarShortcutBindings(): ServerConfig["keybindings"] {
  return [
    {
      command: "chat.new",
      shortcut: {
        key: "o",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        modKey: true,
      },
    },
    {
      command: "chat.newLocal",
      shortcut: {
        key: "n",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        modKey: true,
      },
    },
  ];
}

function createSnapshotThread(
  overrides: Partial<SnapshotThread> & Pick<SnapshotThread, "id">,
): SnapshotThread {
  const { id, ...rest } = overrides;
  return {
    id,
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
        id: `msg-${overrides.id}` as MessageId,
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
      threadId: id,
      status: "ready",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: NOW_ISO,
    },
    ...rest,
  };
}

function createSnapshot(
  threads: SnapshotThread[] = [createSnapshotThread({ id: THREAD_ID })],
): OrchestrationReadModel {
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
    threads,
    updatedAt: NOW_ISO,
  };
}

function buildFixture(snapshot: OrchestrationReadModel = createSnapshot()): TestFixture {
  return {
    snapshot,
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

async function waitForPath(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  message: string,
): Promise<string> {
  let pathname = "";
  await vi.waitFor(
    () => {
      pathname = router.state.location.pathname;
      expect(predicate(pathname), message).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );

  return pathname;
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

function querySidebarThreadRowsByTitle(title: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-slot='sidebar-menu-sub-button']"),
  ).filter((element) => element.textContent?.includes(title) ?? false);
}

function querySidebarThreadRowByTitle(title: string): HTMLElement | null {
  return querySidebarThreadRowsByTitle(title)[0] ?? null;
}

function querySidebarButtonByText(text: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("button")).find(
      (element) => element.textContent?.trim() === text,
    ) ?? null
  );
}

function queryProjectButton(projectName: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[data-slot='sidebar-menu-button']")).find(
      (element) => element.textContent?.includes(projectName) ?? false,
    ) ?? null
  );
}

async function waitForSidebarThreadRow(title: string): Promise<HTMLElement> {
  return waitForElement(
    () => querySidebarThreadRowByTitle(title),
    `Expected sidebar row titled "${title}" to render.`,
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
  configureFixture?: (fixture: TestFixture) => void;
  height?: number;
  initialEntries: string[];
  width: number;
}): Promise<{
  cleanup: () => Promise<void>;
  host: HTMLDivElement;
  router: ReturnType<typeof getRouter>;
}> {
  fixture = buildFixture();
  options.configureFixture?.(fixture);
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

async function dispatchNewThreadShortcut(command: "chat.new" | "chat.newLocal"): Promise<void> {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: command === "chat.new" ? "o" : "n",
      metaKey: isMac,
      ctrlKey: !isMac,
      shiftKey: true,
      altKey: false,
      bubbles: true,
      cancelable: true,
    }),
  );
  await waitForLayout();
}

function addThreadToSnapshot(
  snapshot: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationReadModel {
  return {
    ...snapshot,
    threads: [
      ...snapshot.threads,
      createSnapshotThread({
        id: threadId,
        title: "New thread",
        createdAt: "2026-03-11T12:05:00.000Z",
        lastInteractionAt: "2026-03-11T12:05:00.000Z",
        updatedAt: "2026-03-11T12:05:00.000Z",
      }),
    ],
    updatedAt: "2026-03-11T12:05:00.000Z",
  };
}

function seedPersistedDraftStorage(threadId: ThreadId): void {
  localStorage.setItem(
    COMPOSER_DRAFT_STORAGE_KEY,
    JSON.stringify({
      state: {
        draftsByThreadId: {},
        draftThreadsByThreadId: {
          [threadId]: {
            projectId: PROJECT_ID,
            createdAt: "2026-03-10T08:00:00.000Z",
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            envMode: "local",
          },
        },
        projectDraftThreadIdByProjectId: {
          [PROJECT_ID]: threadId,
        },
      },
      version: 1,
    }),
  );
}

describe("Thread sidebar", () => {
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
    useThreadSelectionStore.getState().clearSelection();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resizes immediately on an active thread route and preserves the width across route changes", async () => {
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: createSidebarShortcutBindings(),
        };
      },
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
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: createSidebarShortcutBindings(),
        };
      },
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

  it("shows a new draft row in the project sidebar and auto-expands the project", async () => {
    useStore.setState({
      projects: [
        {
          id: PROJECT_ID,
          name: "Project",
          cwd: "/repo/project",
          model: "gpt-5",
          createdAt: NOW_ISO,
          expanded: false,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: false,
    });

    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      await waitForElement(
        () => queryProjectButton("Project"),
        "Project button should render before opening a draft.",
      );

      await page.getByTestId("new-thread-button").click();

      const newThreadPath = await waitForPath(
        mounted.router,
        (pathname) => UUID_ROUTE_RE.test(pathname),
        "Route should switch to the new draft thread.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;
      const newThreadRow = await waitForSidebarThreadRow("New thread");

      expect(newThreadRow.getAttribute("data-active")).toBe("true");
      expect(
        useStore.getState().projects.find((project) => project.id === PROJECT_ID)?.expanded,
      ).toBe(true);
      expect(useComposerDraftStore.getState().getDraftThreadByProjectId(PROJECT_ID)?.threadId).toBe(
        newThreadId,
      );
    } finally {
      await mounted.cleanup();
    }
  });

  // TODO: Re-enable once this browser harness can reliably trigger the window-level shortcut path.
  it.skip("creates a project-scoped draft from chat.new and preserves branch context", async () => {
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      await waitForElement(
        () => queryProjectButton("Project"),
        "Project button should render before triggering chat.new.",
      );
      await dispatchNewThreadShortcut("chat.new");

      const newThreadPath = await waitForPath(
        mounted.router,
        (pathname) => UUID_ROUTE_RE.test(pathname),
        "chat.new should navigate to a draft thread route.",
      );
      const draftThread = useComposerDraftStore.getState().getDraftThreadByProjectId(PROJECT_ID);

      expect(draftThread?.threadId).toBe(newThreadPath.slice(1));
      expect(draftThread?.branch).toBe("main");
      expect(draftThread?.worktreePath).toBeNull();
      expect(querySidebarThreadRowsByTitle("New thread")).toHaveLength(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it.skip("reuses the same project draft for chat.newLocal", async () => {
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      await waitForElement(
        () => queryProjectButton("Project"),
        "Project button should render before triggering chat.newLocal.",
      );
      await dispatchNewThreadShortcut("chat.newLocal");

      const firstPath = await waitForPath(
        mounted.router,
        (pathname) => UUID_ROUTE_RE.test(pathname),
        "chat.newLocal should navigate to a draft thread route.",
      );
      await dispatchNewThreadShortcut("chat.newLocal");
      const secondPath = await waitForPath(
        mounted.router,
        (pathname) => pathname === firstPath,
        "chat.newLocal should reuse the same draft for the project.",
      );
      const draftThread = useComposerDraftStore.getState().getDraftThreadByProjectId(PROJECT_ID);

      expect(secondPath).toBe(firstPath);
      expect(draftThread?.branch).toBeNull();
      expect(draftThread?.worktreePath).toBeNull();
      expect(querySidebarThreadRowsByTitle("New thread")).toHaveLength(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps a project draft visible in the collapsed preview when it would normally be truncated", async () => {
    const previewThreads = Array.from({ length: 8 }, (_, index) =>
      createSnapshotThread({
        id: `preview-thread-${index}` as ThreadId,
        title: `Preview thread ${index}`,
        createdAt: `2026-03-11T12:0${index}:00.000Z`,
        lastInteractionAt: `2026-03-11T12:0${index}:00.000Z`,
        updatedAt: `2026-03-11T12:0${index}:00.000Z`,
      }),
    ).toReversed();
    const draftThreadId = "preview-draft-thread" as ThreadId;
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {
        [draftThreadId]: {
          projectId: PROJECT_ID,
          createdAt: "2026-03-01T00:00:00.000Z",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: draftThreadId,
      },
    });

    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${previewThreads[0]!.id}`],
      configureFixture: (nextFixture) => {
        nextFixture.snapshot = createSnapshot(previewThreads);
        nextFixture.welcome = {
          ...nextFixture.welcome,
          bootstrapThreadId: previewThreads[0]!.id,
        };
      },
    });

    try {
      await waitForSidebarThreadRow("New thread");
      expect(querySidebarThreadRowByTitle("Preview thread 3")).toBeTruthy();
      expect(querySidebarThreadRowByTitle("Preview thread 2")).toBeNull();
      expect(querySidebarThreadRowByTitle("Preview thread 1")).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders archived threads in a collapsed archived section that can be expanded", async () => {
    const activeThreadId = "active-thread" as ThreadId;
    const archivedThreadId = "archived-thread" as ThreadId;
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${activeThreadId}`],
      configureFixture: (nextFixture) => {
        nextFixture.snapshot = createSnapshot([
          createSnapshotThread({
            id: activeThreadId,
            title: "Active thread",
            createdAt: "2026-03-11T12:00:00.000Z",
            lastInteractionAt: "2026-03-11T12:00:00.000Z",
            updatedAt: "2026-03-11T12:00:00.000Z",
          }),
          createSnapshotThread({
            id: archivedThreadId,
            title: "Archived thread",
            createdAt: "2026-03-11T11:55:00.000Z",
            lastInteractionAt: "2026-03-11T11:55:00.000Z",
            updatedAt: "2026-03-11T11:55:00.000Z",
            archivedAt: "2026-03-11T12:10:00.000Z",
          }),
        ]);
        nextFixture.welcome = {
          ...nextFixture.welcome,
          bootstrapThreadId: activeThreadId,
        };
      },
    });

    try {
      await waitForSidebarThreadRow("Active thread");
      const archivedToggle = await waitForElement(
        () => querySidebarButtonByText("Archived"),
        "Archived section toggle should render for projects with archived threads.",
      );

      expect(querySidebarThreadRowByTitle("Archived thread")).toBeNull();

      archivedToggle.click();

      await waitForSidebarThreadRow("Archived thread");
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps a draft row visible after navigating away within the same project", async () => {
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      await page.getByTestId("new-thread-button").click();
      await waitForPath(
        mounted.router,
        (pathname) => UUID_ROUTE_RE.test(pathname),
        "Route should switch to the draft thread after opening it.",
      );

      const persistedThreadRow = await waitForSidebarThreadRow(LONG_THREAD_TITLE);
      persistedThreadRow.click();

      await waitForPath(
        mounted.router,
        (pathname) => pathname === `/${THREAD_ID}`,
        "Route should switch back to the persisted thread.",
      );
      expect(querySidebarThreadRowsByTitle("New thread")).toHaveLength(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("hydrates a persisted draft row from local storage", async () => {
    const draftThreadId = "persisted-sidebar-draft" as ThreadId;
    seedPersistedDraftStorage(draftThreadId);
    await useComposerDraftStore.persist.rehydrate();

    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      await waitForSidebarThreadRow("New thread");
      expect(useComposerDraftStore.getState().getDraftThreadByProjectId(PROJECT_ID)?.threadId).toBe(
        draftThreadId,
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("avoids duplicate sidebar rows when a draft is promoted to a persisted thread", async () => {
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      await page.getByTestId("new-thread-button").click();
      const draftPath = await waitForPath(
        mounted.router,
        (pathname) => UUID_ROUTE_RE.test(pathname),
        "Route should switch to the draft thread after opening it.",
      );
      const draftThreadId = draftPath.slice(1) as ThreadId;

      expect(querySidebarThreadRowsByTitle("New thread")).toHaveLength(1);

      useStore.getState().syncServerReadModel(addThreadToSnapshot(fixture.snapshot, draftThreadId));
      useComposerDraftStore.getState().clearDraftThread(draftThreadId);
      await waitForLayout();

      expect(mounted.router.state.location.pathname).toBe(draftPath);
      expect(querySidebarThreadRowsByTitle("New thread")).toHaveLength(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("treats modifier clicks on draft rows like plain focus instead of multi-select", async () => {
    const mounted = await mountApp({
      width: 1_400,
      initialEntries: [`/${THREAD_ID}`],
    });

    try {
      await page.getByTestId("new-thread-button").click();
      const draftPath = await waitForPath(
        mounted.router,
        (pathname) => UUID_ROUTE_RE.test(pathname),
        "Route should switch to the draft thread after opening it.",
      );
      const persistedThreadRow = await waitForSidebarThreadRow(LONG_THREAD_TITLE);
      const draftThreadRow = await waitForSidebarThreadRow("New thread");

      persistedThreadRow.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          metaKey: true,
        }),
      );
      await waitForLayout();
      expect(useThreadSelectionStore.getState().selectedThreadIds).toEqual(new Set([THREAD_ID]));

      draftThreadRow.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          metaKey: true,
        }),
      );
      await waitForLayout();
      expect(mounted.router.state.location.pathname).toBe(draftPath);
      expect(useThreadSelectionStore.getState().selectedThreadIds.size).toBe(0);
      expect(useThreadSelectionStore.getState().anchorThreadId).toBeNull();

      persistedThreadRow.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          metaKey: true,
        }),
      );
      await waitForLayout();
      expect(useThreadSelectionStore.getState().selectedThreadIds).toEqual(new Set([THREAD_ID]));

      draftThreadRow.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }),
      );
      await waitForLayout();
      expect(mounted.router.state.location.pathname).toBe(draftPath);
      expect(useThreadSelectionStore.getState().selectedThreadIds.size).toBe(0);
      expect(useThreadSelectionStore.getState().anchorThreadId).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });
});
