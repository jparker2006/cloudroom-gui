// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import {
  applyAppKeybindingOverrides,
  defaultAppSettings,
  PANE_FOCUS_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
  TOP_LEVEL_THREAD_JUMP_APP_COMMAND_IDS,
  type AppDefaultKeybindings,
  type AppKeybindingOverrides,
  type AppShortcut,
} from "@cloudroom/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppCommandProvider,
  useAppCommandContext,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { getSidebarTopLevelThreadTarget } from "@/components/sidebar/sidebarThreadShortcuts";

function shortcut(key: string, modifiers: Partial<AppShortcut>): AppShortcut {
  return {
    key,
    mod: false,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...modifiers,
  };
}

// Mirrors the server defaults for the three numbered command families.
const DEFAULTS: AppDefaultKeybindings = [
  ...TOP_LEVEL_THREAD_JUMP_APP_COMMAND_IDS.map((command, index) => ({
    command,
    desktopOnly: true,
    shortcut: shortcut(String(index + 1), { mod: true, alt: true }),
    when: {
      all: ["mainSurface" as const, "macPlatform" as const],
      none: ["modalOpen" as const],
    },
  })),
  ...THREAD_JUMP_APP_COMMAND_IDS.map((command, index) => ({
    command,
    desktopOnly: true,
    shortcut: shortcut(String(index + 1), { mod: true }),
    when: { all: ["mainSurface" as const], none: ["modalOpen" as const] },
  })),
  ...PANE_FOCUS_APP_COMMAND_IDS.map((command, index) => ({
    command,
    desktopOnly: true,
    shortcut: shortcut(String(index + 1), { mod: true }),
    when: {
      all: ["mainSurface" as const, "splitActive" as const],
      none: ["modalOpen" as const],
    },
  })),
];

const testState = vi.hoisted(() => ({
  desktop: true,
  overrides: [] as unknown[],
  pluginCommands: [] as unknown[],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      defaultKeybindings: DEFAULTS,
      keybindingOverrides: testState.overrides,
      keybindings: applyAppKeybindingOverrides(
        DEFAULTS,
        testState.overrides as AppKeybindingOverrides,
      ),
    },
  }),
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ commandPaletteActions: testState.pluginCommands }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => (testState.desktop ? {} : null),
}));

const opened: string[] = [];
const jumped: number[] = [];
const paneFocused: number[] = [];

function sidebarFixture(): HTMLElement {
  const root = document.createElement("aside");
  const row = (threadId: string, child = false) => {
    const element = document.createElement("a");
    element.dataset.sidebarThreadShortcutTarget = "";
    element.dataset.sidebarThreadId = threadId;
    element.dataset.sidebarProjectId = "proj_1";
    if (child) element.dataset.sidebarThreadChild = "";
    root.append(element);
  };
  row("parent_1");
  row("parent_1_child", true);
  row("parent_2");
  document.body.append(root);
  return root;
}

function Handlers({
  root,
  splitActive = false,
}: {
  root: HTMLElement;
  splitActive?: boolean;
}) {
  useAppCommandContext("splitActive", splitActive);
  useIndexedAppCommandHandlers(
    TOP_LEVEL_THREAD_JUMP_APP_COMMAND_IDS,
    (index) => {
      const target = getSidebarTopLevelThreadTarget(root, index);
      if (!target) return false;
      opened.push(target.threadId);
      return true;
    },
  );
  useIndexedAppCommandHandlers(THREAD_JUMP_APP_COMMAND_IDS, (index) => {
    jumped.push(index);
    return true;
  });
  useIndexedAppCommandHandlers(
    PANE_FOCUS_APP_COMMAND_IDS,
    (index) => {
      paneFocused.push(index);
      return true;
    },
    0,
    splitActive,
  );
  return null;
}

function renderHandlers(splitActive = false) {
  const root = sidebarFixture();
  render(
    <AppCommandProvider>
      <Handlers root={root} splitActive={splitActive} />
    </AppCommandProvider>,
  );
}

function press(
  digit: number,
  init: Partial<KeyboardEventInit> & { key?: string },
  target: EventTarget = window,
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: `Digit${digit}`,
    key: String(digit),
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

const CMD_OPTION = { metaKey: true, altKey: true };

let platform: PropertyDescriptor | undefined;

beforeEach(() => {
  platform = Object.getOwnPropertyDescriptor(navigator, "platform");
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  testState.desktop = true;
  testState.overrides = [];
  testState.pluginCommands = [];
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  opened.length = 0;
  jumped.length = 0;
  paneFocused.length = 0;
  if (platform) Object.defineProperty(navigator, "platform", platform);
  else delete (navigator as { platform?: string }).platform;
});

describe("top-level thread jump key events", () => {
  it.each([
    ["US", "1", 1, "¡"],
    ["US", "2", 2, "™"],
    ["French AZERTY", "1", 1, ""],
    ["German", "2", 2, "“"],
  ])(
    "opens the nth top-level thread on %s Option+%s",
    (_layout, _digit, digit, composed) => {
      renderHandlers();
      const event = press(digit, { ...CMD_OPTION, key: composed });

      expect(opened).toEqual([digit === 1 ? "parent_1" : "parent_2"]);
      expect(event.defaultPrevented).toBe(true);
      expect(jumped).toEqual([]);
    },
  );

  it("keeps Cmd+digit on visible-row jumps and split-pane focus", () => {
    renderHandlers();
    press(2, { metaKey: true });
    expect(jumped).toEqual([1]);
    expect(opened).toEqual([]);

    cleanup();
    jumped.length = 0;
    renderHandlers(true);
    press(2, { metaKey: true });
    press(2, { ...CMD_OPTION, key: "™" });
    expect(paneFocused).toEqual([1]);
    expect(jumped).toEqual([]);
    expect(opened).toEqual(["parent_2"]);
  });

  it("does nothing and leaves the event alone for a missing target", () => {
    renderHandlers();
    const event = press(3, { ...CMD_OPTION, key: "£" });

    expect(opened).toEqual([]);
    expect(jumped).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("works from an editable field but not while a modal is open", () => {
    renderHandlers();
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    press(1, { ...CMD_OPTION, key: "¡" }, textarea);
    expect(opened).toEqual(["parent_1"]);

    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    const event = press(2, { ...CMD_OPTION, key: "™" });
    expect(opened).toEqual(["parent_1"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores Cmd+Shift+digit and Option-only digits", () => {
    renderHandlers();
    press(3, { metaKey: true, shiftKey: true, key: "#" });
    press(4, { metaKey: true, shiftKey: true, key: "$" });
    press(1, { metaKey: true, altKey: true, shiftKey: true, key: "⁄" });
    press(1, { altKey: true, key: "¡" });

    expect(opened).toEqual([]);
  });

  it.each([
    ["the web app", false, "MacIntel"],
    ["Windows desktop", true, "Win32"],
  ])("has no default binding in %s", (_name, desktop, value) => {
    testState.desktop = desktop;
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value,
    });
    renderHandlers();
    press(1, { metaKey: true, altKey: true, key: "¡" });
    press(1, { ctrlKey: true, altKey: true, key: "1" });

    expect(opened).toEqual([]);
  });

  it("uses the effective custom binding instead of the default", () => {
    testState.overrides = [
      {
        command: "thread.jumpTopLevel.1",
        shortcut: shortcut("t", { control: true, alt: true }),
      },
      { command: "thread.jumpTopLevel.2", shortcut: null },
    ];
    renderHandlers();
    press(1, { ...CMD_OPTION, key: "¡" });
    press(2, { ...CMD_OPTION, key: "™" });
    expect(opened).toEqual([]);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyT",
      key: "†",
      ctrlKey: true,
      altKey: true,
    });
    window.dispatchEvent(event);
    expect(opened).toEqual(["parent_1"]);
  });

  it("lets a user-assigned command take over the default chord", () => {
    testState.overrides = [
      {
        command: "thread.jump.5",
        shortcut: shortcut("1", { mod: true, alt: true }),
      },
    ];
    renderHandlers();
    press(1, { ...CMD_OPTION, key: "¡" });

    expect(jumped).toEqual([4]);
    expect(opened).toEqual([]);
  });

  it("drops a conflicting plugin default instead of the built-in chord", () => {
    const run = vi.fn();
    testState.pluginCommands = [
      {
        pluginId: "acme",
        id: "first",
        title: "Acme first",
        defaultShortcut: shortcut("1", { mod: true, alt: true }),
        run,
      },
    ];
    renderHandlers();
    press(1, { ...CMD_OPTION, key: "¡" });

    expect(opened).toEqual(["parent_1"]);
    expect(run).not.toHaveBeenCalled();
  });
});
