// @vitest-environment jsdom

import { MemoryRouter } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { useContext, useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { threadsQueryKey } from "@/hooks/queries/query-keys";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@cloudroom/domain";
import {
  makeThreadListEntry,
  makeThreadQueuedMessage,
} from "@cloudroom/test-helpers/domain-fixtures";
import { focusWithKeyboard } from "@/test/keyboard-focus";
import {
  QueuedMessagesList as QueuedMessagesListComponent,
  clampQueuedMessageDragTransform,
  getInlineEditorSurfaceMaxHeight,
  resolveQueuedMessageDrag,
  type QueuedMessagesListProps,
} from "./QueuedMessagesList";
import {
  QueuedEditorTypeaheadLayoutContext,
  type QueuedEditorTypeaheadLayout,
} from "@/components/promptbox/queued-editor-typeahead-layout";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";

const bottomAnchorMocks = vi.hoisted(() => ({
  scrollElement: null as HTMLElement | null,
}));

function QueuedMessagesList({
  attachedToComposer = true,
  sendAction = "send-now",
  ...props
}: Omit<QueuedMessagesListProps, "attachedToComposer" | "sendAction"> & {
  attachedToComposer?: boolean;
  sendAction?: QueuedMessagesListProps["sendAction"];
}) {
  return (
    <QueuedMessagesListComponent
      {...props}
      attachedToComposer={attachedToComposer}
      sendAction={sendAction}
    />
  );
}

vi.mock("@/components/ui/bottom-anchored-scroll-body", () => ({
  useBottomAnchoredScroll: () =>
    bottomAnchorMocks.scrollElement === null
      ? null
      : {
          getScrollElement: () => bottomAnchorMocks.scrollElement,
        },
}));

const noop = () => {};

function TypeaheadLayoutFixture({
  layout,
}: {
  layout: QueuedEditorTypeaheadLayout;
}) {
  const reportLayout = useContext(QueuedEditorTypeaheadLayoutContext);
  useLayoutEffect(() => {
    reportLayout?.(layout);
  }, [layout, reportLayout]);
  return <div>Inline editor</div>;
}

function makeQueuedMessage(id: string, text: string): ThreadQueuedMessage {
  return makeThreadQueuedMessage({
    id,
    threadId: "thr_prompt_pills",
    content: [{ type: "text", text, mentions: [] }],
  });
}

function makeQueuedFileMessage(id: string, name: string): ThreadQueuedMessage {
  return {
    ...makeQueuedMessage(id, ""),
    content: [
      {
        type: "localFile",
        path: `/tmp/${name}`,
        name,
      },
    ],
  };
}

function rect({ top, bottom }: { top: number; bottom: number }) {
  return new DOMRect(0, top, 100, bottom - top);
}

function renderQueuedMessages(
  queuedMessages: readonly ThreadQueuedMessage[],
  attachedToComposer = true,
) {
  return render(
    <QueuedMessagesList
      attachedToComposer={attachedToComposer}
      queuedMessages={queuedMessages}
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSend={noop}
      onReorder={noop}
      onEdit={noop}
      onDelete={noop}
    />,
  );
}

function renderQueuedMessagesWithOptions(
  queuedMessages: readonly ThreadQueuedMessage[],
  options: Pick<Parameters<typeof QueuedMessagesList>[0], "resolveMentionLink">,
) {
  return render(
    <QueuedMessagesList
      attachedToComposer={true}
      queuedMessages={queuedMessages}
      resolveMentionLink={options.resolveMentionLink}
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      onSend={noop}
      onReorder={noop}
      onEdit={noop}
      onDelete={noop}
    />,
  );
}

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
  bottomAnchorMocks.scrollElement = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("QueuedMessagesList", () => {
  it("labels non-user senders and refreshes their names from the thread cache", async () => {
    const queryClient = new QueryClient();
    const messages = [
      makeQueuedMessage("q_user", "User follow-up"),
      makeThreadQueuedMessage({
        id: "q_agent",
        initiator: "agent",
        senderThreadId: "thr_sender",
      }),
      makeThreadQueuedMessage({
        id: "q_system",
        initiator: "system",
        waitingOn: { kind: "provisioning" },
      }),
    ];
    const { container, getByText, getByRole } = render(
      <QueryClientProvider client={queryClient}>
        <QueuedMessagesList
          queuedMessages={messages}
          sendDisabled={false}
          actionDisabled={false}
          processingMessageId={null}
          processingAction={null}
          onSend={noop}
          onReorder={noop}
          onEdit={noop}
          onDelete={noop}
        />
      </QueryClientProvider>,
    );
    expect(
      container.querySelector(
        '[data-queued-message-id="q_user"] [data-queued-message-sender]',
      ),
    ).toBeNull();
    expect(
      getByText("thr_sender").closest("[data-queued-message-metadata]"),
    ).not.toBeNull();
    expect(
      getByText("System")
        .closest("[data-queued-message-metadata]")
        ?.querySelector("[data-queued-message-wait]"),
    ).not.toBeNull();
    expect(
      getByText("thr_sender").closest(".prompt-mention-pill"),
    ).not.toBeNull();
    act(() => {
      queryClient.setQueryData(threadsQueryKey(), [
        makeThreadListEntry({ id: "thr_sender", title: "Code review" }),
      ]);
    });
    await waitFor(() => expect(getByText("Code review")).toBeTruthy());
    fireEvent.keyDown(
      getByRole("button", { name: "Drag up to open the queue workspace" }),
      { key: "ArrowUp" },
    );
    expect(getByText("Code review")).toBeTruthy();
    expect(getByText("System")).toBeTruthy();
    queryClient.clear();
  });

  it.each([
    { initiator: "system" as const, senderThreadId: null, height: "61px" },
    {
      initiator: "agent" as const,
      senderThreadId: "thr_sender",
      height: "67px",
    },
  ])(
    "reserves the metadata height for $initiator senders",
    ({ initiator, senderThreadId, height }) => {
      const { container } = renderQueuedMessages([
        makeThreadQueuedMessage({ initiator, senderThreadId }),
      ]);
      expect(
        container.querySelector<HTMLElement>(
          'section[aria-label="Queued messages"]',
        )?.style.height,
      ).toBe(height);
    },
  );

  it("renders as a standalone card when it is not attached to the composer", () => {
    const { container } = renderQueuedMessages(
      [makeQueuedMessage("q_one", "First queued message")],
      false,
    );
    const surface = container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    );

    expect(surface?.classList.contains("mb-0")).toBe(true);
    expect(surface?.classList.contains("-mb-5")).toBe(false);
    expect(surface?.classList.contains("rounded-b-none")).toBe(false);
    expect(surface?.classList.contains("border-b-0")).toBe(false);
  });

  it("toggles a few messages between the fitted drawer and collapsed modes", () => {
    const { container, getByRole, queryByText } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ]);
    const header = container.querySelector<HTMLElement>(
      "[data-queued-messages-mode]",
    );
    const surface = container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    );

    expect(queryByText("Queue")).toBeNull();
    expect(container.querySelector("header")).toBeNull();
    const scrollFrame = container.querySelector<HTMLElement>(
      "[data-queued-messages-scroll-frame]",
    );
    expect(scrollFrame?.hidden).toBe(false);
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("drawer");
    expect(surface?.style.height).toBe("74px");
    expect(
      getByRole("button", { name: "Collapse queued messages" }).querySelector(
        '[data-icon="ChevronDown"]',
      ),
    ).not.toBeNull();

    fireEvent.click(getByRole("button", { name: "Collapse queued messages" }));
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("collapsed");
    expect(
      getByRole("button", { name: "Show queued messages" }).querySelector(
        '[data-icon="ChevronUp"]',
      ),
    ).not.toBeNull();
    expect(surface?.style.height).toBe("54px");
    expect(scrollFrame?.hidden).toBe(true);

    fireEvent.click(getByRole("button", { name: "Show queued messages" }));
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("drawer");
    expect(surface?.style.height).toBe("74px");
    expect(scrollFrame?.hidden).toBe(false);
  });

  it("gives a row that renders a wait line room for it", () => {
    const plain = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
    ]);
    const plainHeight = plain.container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    )?.style.height;
    cleanup();

    const waiting = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_one", "First queued message"),
        waitingOn: {
          kind: "plugin",
          pluginId: "provider-retry",
          reason: "Rate limited",
        },
        sendAt: Date.now() + 60_000,
      },
    ]);
    const waitingHeight = waiting.container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    )?.style.height;

    expect(plainHeight).toBe("45px");
    expect(waitingHeight).toBe("61px");
  });

  it("toggles an overflowing queue between the workspace and collapsed modes", () => {
    const { container, getByRole } = renderQueuedMessages(
      Array.from({ length: 5 }, (_, index) =>
        makeQueuedMessage(`q_${index}`, `Queued message ${index + 1}`),
      ),
    );
    const header = container.querySelector<HTMLElement>(
      "[data-queued-messages-mode]",
    );

    expect(header?.getAttribute("data-queued-messages-mode")).toBe("drawer");
    fireEvent.click(getByRole("button", { name: "Expand queued messages" }));
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("workspace");
    fireEvent.click(getByRole("button", { name: "Collapse queued messages" }));
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("collapsed");
    fireEvent.click(getByRole("button", { name: "Expand queued messages" }));
    expect(header?.getAttribute("data-queued-messages-mode")).toBe("workspace");
  });

  it("opens the fitted drawer when a queued message arrives while collapsed", async () => {
    const sharedProps = {
      sendDisabled: false,
      actionDisabled: false,
      processingMessageId: null,
      processingAction: null,
      onSend: noop,
      onReorder: noop,
      onEdit: noop,
      onDelete: noop,
    } as const;
    const firstMessage = makeQueuedMessage("q_one", "First queued message");
    const { container, getByRole, rerender } = render(
      <QueuedMessagesList {...sharedProps} queuedMessages={[firstMessage]} />,
    );

    fireEvent.click(getByRole("button", { name: "Collapse queued messages" }));
    expect(
      container
        .querySelector("[data-queued-messages-mode]")
        ?.getAttribute("data-queued-messages-mode"),
    ).toBe("collapsed");

    rerender(
      <QueuedMessagesList
        {...sharedProps}
        queuedMessages={[
          firstMessage,
          makeQueuedMessage("q_two", "Second queued message"),
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-queued-messages-mode]")
          ?.getAttribute("data-queued-messages-mode"),
      ).toBe("drawer");
    });
  });

  it("moves through all three modes with the header drag handle", () => {
    const { container, getByRole } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ]);
    const handle = getByRole("button", {
      name: "Drag up to open the queue workspace",
    });
    Object.defineProperty(handle, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 100, pointerId: 1 });

    expect(
      container
        .querySelector("[data-queued-messages-mode]")
        ?.getAttribute("data-queued-messages-mode"),
    ).toBe("workspace");

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 100,
      pointerId: 2,
    });
    fireEvent.pointerMove(handle, { clientY: 200, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientY: 200, pointerId: 2 });

    expect(
      container
        .querySelector("[data-queued-messages-mode]")
        ?.getAttribute("data-queued-messages-mode"),
    ).toBe("drawer");

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 100,
      pointerId: 3,
    });
    fireEvent.pointerMove(handle, { clientY: 200, pointerId: 3 });
    fireEvent.pointerUp(handle, { clientY: 200, pointerId: 3 });

    expect(
      container
        .querySelector("[data-queued-messages-mode]")
        ?.getAttribute("data-queued-messages-mode"),
    ).toBe("collapsed");
  });

  it("uses labeled inline icon actions with tooltips", async () => {
    const { container, findByRole, getByRole, queryByRole } =
      renderQueuedMessages([
        makeQueuedMessage("q_one", "First queued message"),
      ]);

    const sendButton = getByRole("button", {
      name: "Send queued message 1 now",
    });
    const editButton = getByRole("button", {
      name: "Edit queued message 1",
    });
    const deleteButton = getByRole("button", {
      name: "Delete queued message 1",
    });

    expect(
      getByRole("button", { name: "Queued message 1 actions" }),
    ).toBeTruthy();
    expect(editButton).toBeTruthy();
    expect(deleteButton).toBeTruthy();
    expect(container.querySelector('[data-icon="Sent"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Edit"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Trash2"]')).not.toBeNull();
    expect(
      container.querySelector('[data-icon="MoreHorizontal"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-icon="DragDropVertical"]'),
    ).not.toBeNull();

    for (const [button, label] of [
      [sendButton, "Send now"],
      [editButton, "Edit"],
      [deleteButton, "Delete"],
    ] as const) {
      focusWithKeyboard(button);
      expect((await findByRole("tooltip")).textContent).toBe(label);
      fireEvent.blur(button);
      await waitFor(() => {
        expect(queryByRole("tooltip")).toBeNull();
      });
    }
  });

  it("limits collapsed action hiding to compact widths", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
    ]);
    const actions = container.querySelector("[data-queued-message-actions]");

    expect(actions?.classList.contains("max-md:hidden")).toBe(true);
    expect(actions?.classList.contains("hidden")).toBe(false);
    expect(actions?.classList.contains("md:flex")).toBe(true);
  });

  it("expands one row's actions inline and resets them outside the queue", () => {
    const { getByRole, getByText, queryByRole } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ]);
    const firstActions = getByRole("button", {
      name: "Queued message 1 actions",
    });
    const secondActions = getByRole("button", {
      name: "Queued message 2 actions",
    });

    fireEvent.click(firstActions);
    expect(firstActions.getAttribute("aria-expanded")).toBe("true");
    expect(queryByRole("menu")).toBeNull();
    expect(queryByRole("dialog")).toBeNull();

    fireEvent.pointerDown(getByText("Second queued message"));
    expect(firstActions.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(secondActions);
    expect(firstActions.getAttribute("aria-expanded")).toBe("false");
    expect(secondActions.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(document.body);
    expect(secondActions.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(firstActions);
    fireEvent.click(getByRole("button", { name: "Collapse queued messages" }));
    fireEvent.click(getByRole("button", { name: "Show queued messages" }));
    expect(firstActions.getAttribute("aria-expanded")).toBe("false");
  });

  it.each([
    { sendDisabled: false, expectedAction: "Send queued message 1 now" },
    { sendDisabled: true, expectedAction: "Edit queued message 1" },
  ])(
    "focuses $expectedAction after keyboard expansion",
    ({ sendDisabled, expectedAction }) => {
      const { getByRole } = render(
        <QueuedMessagesList
          queuedMessages={[makeQueuedMessage("q_one", "First queued message")]}
          sendDisabled={sendDisabled}
          actionDisabled={false}
          processingMessageId={null}
          processingAction={null}
          onSend={noop}
          onReorder={noop}
          onEdit={noop}
          onDelete={noop}
        />,
      );
      const trigger = getByRole("button", {
        name: "Queued message 1 actions",
      });

      focusWithKeyboard(trigger);
      fireEvent.click(trigger, { detail: 0 });

      expect(document.activeElement).toBe(
        getByRole("button", { name: expectedAction }),
      );
    },
  );

  it("does not move focus into actions after pointer expansion", () => {
    const { getByRole } = renderQueuedMessages([
      makeQueuedMessage("q_one", "First queued message"),
    ]);
    const reorderButton = getByRole("button", {
      name: "Reorder queued message 1",
    });
    focusWithKeyboard(reorderButton);

    fireEvent.click(getByRole("button", { name: "Queued message 1 actions" }), {
      detail: 1,
    });

    expect(document.activeElement).toBe(reorderButton);
  });

  it("replaces the edited row with the real inline composer", () => {
    const onDismiss = vi.fn();
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ];

    const { container, getByRole, getByText, getByTestId } = render(
      <QueuedMessagesList
        queuedMessages={queuedMessages}
        inlineEditor={{
          queuedMessageId: "q_two",
          queuedMessageIndex: 0,
          content: <div data-testid="inline-queue-editor">Inline editor</div>,
          onDismiss,
        }}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSend={noop}
        onReorder={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(
      container.querySelector("[data-queued-message-inline-editor]"),
    ).not.toBeNull();
    const inlineEditorSlot = container.querySelector(
      "[data-queued-message-inline-editor]",
    );
    expect(
      inlineEditorSlot?.querySelector(
        '[data-overflow-fade="above"][data-overflow-fade-tone="surface-raised"]',
      ),
    ).not.toBeNull();
    expect(
      inlineEditorSlot?.querySelector(
        '[data-overflow-fade="below"][data-overflow-fade-tone="surface-raised"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("First queued message");
    expect(container.textContent).not.toContain("Second queued message");
    const queueItems = container.querySelectorAll("ul > li");
    expect(queueItems[0]?.textContent).toContain("First queued message");
    expect(
      Array.from(queueItems).some((item) =>
        item.hasAttribute("data-queued-message-inline-editor"),
      ),
    ).toBe(true);
    const editingLabel = getByText(/Editing queued message/u);
    expect(
      editingLabel.closest('[data-inline-message-editor-frame="embedded"]'),
    ).not.toBeNull();
    expect(getByTestId("inline-queue-editor")).toBeTruthy();

    fireEvent.click(
      getByRole("button", { name: "Stop editing queued message" }),
    );
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps an active inline editor usable when the queue is empty", async () => {
    const { container } = render(
      <QueuedMessagesList
        queuedMessages={[]}
        inlineEditor={{
          queuedMessageId: "q_missing",
          queuedMessageIndex: 0,
          content: <div>Inline editor</div>,
          onDismiss: noop,
        }}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSend={noop}
        onReorder={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-queued-messages-mode]")
          ?.getAttribute("data-queued-messages-mode"),
      ).toBe("workspace");
    });

    const scrollFrame = container.querySelector(
      "[data-queued-messages-scroll-frame]",
    );
    expect(scrollFrame?.hasAttribute("inert")).toBe(false);
    expect(scrollFrame?.getAttribute("aria-hidden")).not.toBe("true");
  });

  it("returns to the fitted drawer height after inline editing ends", async () => {
    const queuedMessages = Array.from({ length: 4 }, (_, index) =>
      makeQueuedMessage(`q_${index}`, `Queued message ${index + 1}`),
    );
    const sharedProps = {
      queuedMessages,
      sendDisabled: false,
      actionDisabled: false,
      processingMessageId: null,
      processingAction: null,
      onSend: noop,
      onReorder: noop,
      onEdit: noop,
      onDelete: noop,
    } as const;
    const { container, rerender } = render(
      <QueuedMessagesList
        {...sharedProps}
        inlineEditor={{
          queuedMessageId: "q_0",
          queuedMessageIndex: 0,
          content: <div>Inline editor</div>,
          onDismiss: noop,
        }}
      />,
    );
    const surface = container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    );

    expect(surface?.style.height).toBe("240px");

    rerender(<QueuedMessagesList {...sharedProps} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-queued-messages-mode]")
          ?.getAttribute("data-queued-messages-mode"),
      ).toBe("drawer");
      expect(surface?.style.height).toBe("123px");
    });
  });

  it("keeps an explicitly collapsed inline editor collapsed after dismissal", async () => {
    const onDismiss = vi.fn();
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ];
    const sharedProps = {
      queuedMessages,
      sendDisabled: false,
      actionDisabled: false,
      processingMessageId: null,
      processingAction: null,
      onSend: noop,
      onReorder: noop,
      onEdit: noop,
      onDelete: noop,
    } as const;
    const { container, getByRole, rerender } = render(
      <QueuedMessagesList
        {...sharedProps}
        inlineEditor={{
          queuedMessageId: "q_one",
          queuedMessageIndex: 0,
          content: <div>Inline editor</div>,
          onDismiss,
        }}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Collapse queued messages" }));
    expect(onDismiss).toHaveBeenCalledOnce();

    rerender(<QueuedMessagesList {...sharedProps} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-queued-messages-mode]")
          ?.getAttribute("data-queued-messages-mode"),
      ).toBe("collapsed");
    });
  });

  it("fits edit mode above the real composer at constrained heights and restores the drawer", async () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 320 });
    bottomAnchorMocks.scrollElement = viewport;

    const nativeGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-queue-test-footer")) {
          return new DOMRect(0, 0, 600, 420);
        }
        if (this.getAttribute("aria-label") === "Queued messages") {
          return new DOMRect(0, 0, 600, 240);
        }
        return nativeGetBoundingClientRect.call(this);
      },
    );

    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
    ];
    const sharedProps = {
      queuedMessages,
      sendDisabled: false,
      actionDisabled: false,
      processingMessageId: null,
      processingAction: null,
      onSend: noop,
      onReorder: noop,
      onEdit: noop,
      onDelete: noop,
    } as const;
    const renderSurface = (editing: boolean) => (
      <div data-queue-test-footer="">
        <div data-app-composer="">
          <QueuedMessagesList
            {...sharedProps}
            inlineEditor={
              editing
                ? {
                    queuedMessageId: "q_one",
                    queuedMessageIndex: 0,
                    content: <div>Inline editor</div>,
                    onDismiss: noop,
                  }
                : undefined
            }
          />
          <div data-test-bottom-composer="">Bottom composer</div>
        </div>
      </div>
    );
    const { container, rerender } = render(renderSurface(true));
    const surface = container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    );
    const composer = container.querySelector("[data-test-bottom-composer]");

    await waitFor(() => expect(surface?.style.height).toBe("140px"));
    expect(surface?.compareDocumentPosition(composer as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    rerender(renderSurface(false));

    await waitFor(() => {
      expect(surface?.style.height).toBe("74px");
      expect(
        container
          .querySelector("[data-queued-messages-mode]")
          ?.getAttribute("data-queued-messages-mode"),
      ).toBe("drawer");
    });
  });

  it("grows edit mode to fit the measured editor and its immediate neighbors", async () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 500 });
    bottomAnchorMocks.scrollElement = viewport;

    const nativeGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-queue-test-footer")) {
          return new DOMRect(0, 0, 600, 340);
        }
        if (this.getAttribute("aria-label") === "Queued messages") {
          return new DOMRect(0, 0, 600, 240);
        }
        if (this.hasAttribute("data-queued-messages-scroll")) {
          return new DOMRect(0, 32, 600, 180);
        }
        if (this.hasAttribute("data-queued-message-inline-editor")) {
          return new DOMRect(0, 112, 600, 130);
        }
        if (this.hasAttribute("data-queued-message-row")) {
          if (this.textContent?.includes("Previous queued message")) {
            return new DOMRect(0, 32, 600, 80);
          }
          if (this.textContent?.includes("Following queued message")) {
            return new DOMRect(0, 242, 600, 90);
          }
        }
        return nativeGetBoundingClientRect.call(this);
      },
    );

    const queuedMessages = [
      makeQueuedMessage("q_previous", "Previous queued message"),
      makeQueuedMessage("q_editing", "Edited queued message"),
      makeQueuedMessage("q_following", "Following queued message"),
    ];
    const { container } = render(
      <div data-queue-test-footer="">
        <div data-app-composer="">
          <QueuedMessagesList
            queuedMessages={queuedMessages}
            inlineEditor={{
              queuedMessageId: "q_editing",
              queuedMessageIndex: 1,
              content: <div>Inline editor</div>,
              onDismiss: noop,
            }}
            sendDisabled={false}
            actionDisabled={false}
            processingMessageId={null}
            processingAction={null}
            onSend={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
          <div>Bottom composer</div>
        </div>
      </div>,
    );
    const surface = container.querySelector<HTMLElement>(
      'section[aria-label="Queued messages"]',
    );

    await waitFor(() => expect(surface?.style.height).toBe("360px"));
  });

  it("realigns both neighbors as the edit surface finishes growing", async () => {
    let notifyResize = noop;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientHeight", { value: 500 });
    bottomAnchorMocks.scrollElement = viewport;

    let queueViewportBottom = 180;
    const nativeGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-queue-test-footer")) {
          return new DOMRect(0, 0, 600, 340);
        }
        if (this.getAttribute("aria-label") === "Queued messages") {
          return new DOMRect(0, 0, 600, 240);
        }
        if (this.hasAttribute("data-queued-messages-scroll")) {
          return new DOMRect(0, 32, 600, queueViewportBottom - 32);
        }
        const queueScrollTop =
          this.closest<HTMLElement>("[data-queued-messages-scroll]")
            ?.scrollTop ?? 0;
        if (this.hasAttribute("data-queued-message-inline-editor")) {
          return new DOMRect(0, 132 - queueScrollTop, 600, 180);
        }
        if (this.hasAttribute("data-queued-message-row")) {
          if (this.textContent?.includes("Previous queued message")) {
            return new DOMRect(0, 92 - queueScrollTop, 600, 40);
          }
          if (this.textContent?.includes("Following queued message")) {
            return new DOMRect(0, 312 - queueScrollTop, 600, 30);
          }
        }
        return nativeGetBoundingClientRect.call(this);
      },
    );

    const queuedMessages = [
      makeQueuedMessage("q_previous", "Previous queued message"),
      makeQueuedMessage("q_editing", "Edited queued message"),
      makeQueuedMessage("q_following", "Following queued message"),
    ];
    const { container } = render(
      <div data-queue-test-footer="">
        <div data-app-composer="">
          <QueuedMessagesList
            queuedMessages={queuedMessages}
            inlineEditor={{
              queuedMessageId: "q_editing",
              queuedMessageIndex: 1,
              content: <div>Inline editor</div>,
              onDismiss: noop,
            }}
            sendDisabled={false}
            actionDisabled={false}
            processingMessageId={null}
            processingAction={null}
            onSend={noop}
            onReorder={noop}
            onEdit={noop}
            onDelete={noop}
          />
          <div>Bottom composer</div>
        </div>
      </div>,
    );
    const scroll = container.querySelector<HTMLElement>(
      "[data-queued-messages-scroll]",
    );
    expect(scroll).not.toBeNull();
    if (!scroll) return;
    scroll.scrollTop = 100;

    act(() => notifyResize());
    expect(scroll.scrollTop).toBe(100);

    queueViewportBottom = 300;
    act(() => notifyResize());
    expect(scroll.scrollTop).toBe(60);
  });

  it.each([
    {
      label: "first",
      expectedScrollTop: 0,
      messages: [
        makeQueuedMessage("q_editing", "Edited queued message"),
        makeQueuedMessage("q_neighbor", "Following queued message"),
      ],
      editorTop: 32,
      neighborTop: 310,
    },
    {
      label: "last",
      expectedScrollTop: 80,
      messages: [
        makeQueuedMessage("q_neighbor", "Previous queued message"),
        makeQueuedMessage("q_editing", "Edited queued message"),
      ],
      editorTop: 112,
      neighborTop: 32,
    },
  ])(
    "reserves and scroll-aligns a $label queued editor in a constrained drawer",
    async ({ editorTop, expectedScrollTop, messages, neighborTop }) => {
      const viewport = document.createElement("div");
      Object.defineProperty(viewport, "clientHeight", { value: 500 });
      bottomAnchorMocks.scrollElement = viewport;

      const nativeGetBoundingClientRect =
        HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute("data-queue-test-footer")) {
          return new DOMRect(0, 0, 600, 340);
        }
        if (this.getAttribute("aria-label") === "Queued messages") {
          return new DOMRect(0, 0, 600, 240);
        }
        if (this.hasAttribute("data-queued-messages-scroll")) {
          return new DOMRect(0, 32, 600, 180);
        }
        if (this.hasAttribute("data-queued-message-inline-editor")) {
          const scrollTop =
            this.closest<HTMLElement>("[data-queued-messages-scroll]")
              ?.scrollTop ?? 0;
          return new DOMRect(0, editorTop - scrollTop, 600, 278);
        }
        if (this.getAttribute("data-queued-message-id") === "q_neighbor") {
          const scrollTop =
            this.closest<HTMLElement>("[data-queued-messages-scroll]")
              ?.scrollTop ?? 0;
          return new DOMRect(0, neighborTop - scrollTop, 600, 80);
        }
        return nativeGetBoundingClientRect.call(this);
      });

      const { container } = render(
        <div data-queue-test-footer="">
          <div data-app-composer="">
            <QueuedMessagesList
              queuedMessages={messages}
              inlineEditor={{
                queuedMessageId: "q_editing",
                queuedMessageIndex: messages.findIndex(
                  (message) => message.id === "q_editing",
                ),
                content: (
                  <TypeaheadLayoutFixture
                    layout={{ height: 120, isOpen: true }}
                  />
                ),
                onDismiss: noop,
              }}
              sendDisabled={false}
              actionDisabled={false}
              processingMessageId={null}
              processingAction={null}
              onSend={noop}
              onReorder={noop}
              onEdit={noop}
              onDelete={noop}
            />
            <div>Bottom composer</div>
          </div>
        </div>,
      );
      const surface = container.querySelector<HTMLElement>(
        'section[aria-label="Queued messages"]',
      );
      const scroll = container.querySelector<HTMLElement>(
        "[data-queued-messages-scroll]",
      );

      await waitFor(() => expect(surface?.style.height).toBe("400px"));
      const reservation = container.querySelector<HTMLElement>(
        "[data-queued-editor-typeahead-reservation]",
      );
      if (!reservation) throw new Error("Expected typeahead reservation");
      expect(reservation?.style.paddingTop).toBe("128px");
      const editorFrame = reservation.closest(
        '[data-inline-message-editor-frame="embedded"]',
      );
      expect(editorFrame?.firstElementChild?.textContent).toContain(
        "Editing queued message",
      );
      expect(scroll?.scrollTop).toBe(expectedScrollTop);
    },
  );

  it("reserves the actual occupied composer and footer height", () => {
    expect(
      getInlineEditorSurfaceMaxHeight({
        containerHeight: 420,
        surfaceHeight: 240,
        viewportHeight: 320,
      }),
    ).toBe(140);
    expect(
      getInlineEditorSurfaceMaxHeight({
        containerHeight: 420,
        surfaceHeight: 240,
        viewportHeight: 200,
      }),
    ).toBe(36);
  });

  it("renders queued blockquote markdown as a compact quote preview", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage(
        "q_quote",
        "> first quoted line\n> second quoted line\nreply underneath",
      ),
    ]);

    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("br")).toBeNull();
    expect(container.textContent?.replace(/\s+/gu, " ")).toContain(
      "first quoted line second quoted line reply underneath",
    );
    expect(container.textContent).not.toContain("> first quoted line");
  });

  it("renders queued markdown formatting instead of raw delimiters", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage(
        "q_markdown",
        "## Heading\nReview **bold** and `code`.",
      ),
    ]);

    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).toContain("Heading");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.textContent).not.toContain("## Heading");
    expect(container.textContent).not.toContain("**bold**");
    expect(container.textContent).not.toContain("`code`");
  });

  it("does not add hard-break elements for multi-line queued markdown", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage("q_multiline", "first line\nsecond line"),
    ]);

    expect(container.querySelector("br")).toBeNull();
    expect(container.textContent?.replace(/\s+/gu, " ")).toContain(
      "first line second line",
    );
  });

  it("does not render full markdown preview controls in queued rows", () => {
    const { container, queryByLabelText } = renderQueuedMessages([
      makeQueuedMessage("q_code_block", "```ts\nconst value = 1;\n```"),
    ]);

    expect(queryByLabelText("Copy code")).toBeNull();
    expect(queryByLabelText("Wrap long lines")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain(
      "const value = 1;",
    );
  });

  it("flattens images and links in queued markdown previews", () => {
    const { container } = renderQueuedMessages([
      makeQueuedMessage(
        "q_media",
        "![Diagram](https://example.test/a.png) [docs](https://example.test)",
      ),
    ]);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a[href]")).toBeNull();
    expect(container.textContent).toContain("Diagram");
    expect(container.textContent).toContain("docs");
  });

  it("renders attachment-only fallback text literally", () => {
    const { container } = renderQueuedMessages([
      makeQueuedFileMessage("q_attachment", "[notes](https://example.test).md"),
    ]);

    expect(container.querySelector("a[href]")).toBeNull();
    expect(container.textContent).toContain(
      "Attachment only ([notes](https://example.test).md)",
    );
  });

  it("keeps attachment state visible while processing and counts multiple files", () => {
    const queuedMessage = makeQueuedMessage(
      "q_multiple_attachments",
      "Review both attached screenshots",
    );
    queuedMessage.content.push(
      {
        type: "localFile",
        path: "/tmp/first.png",
        name: "first.png",
      },
      {
        type: "localFile",
        path: "/tmp/second.png",
        name: "second.png",
      },
    );

    const { getByRole, getByText } = render(
      <QueuedMessagesList
        queuedMessages={[queuedMessage]}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={queuedMessage.id}
        processingAction="send"
        onSend={noop}
        onReorder={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    const attachment = getByRole("img", { name: "2 attachments" });
    expect(attachment.textContent).toBe("2");
    expect(getByText("Sending…")).not.toBeNull();
  });

  it("renders prompt mentions as pills in queued previews", () => {
    const text =
      "Run /goal and open @apps/app/src/foo.ts from @thread:thr_prompt_pills";
    const commandToken = "/goal";
    const pathToken = "@apps/app/src/foo.ts";
    const threadToken = "@thread:thr_prompt_pills";
    const commandStart = text.indexOf(commandToken);
    const pathStart = text.indexOf(pathToken);
    const threadStart = text.indexOf(threadToken);
    const openPath = vi.fn();

    const { container, getByText } = renderQueuedMessagesWithOptions(
      [
        {
          ...makeQueuedMessage("q_mentions", text),
          content: [
            {
              type: "text",
              text,
              mentions: [
                {
                  start: commandStart,
                  end: commandStart + commandToken.length,
                  resource: {
                    kind: "command",
                    trigger: "/",
                    name: "goal",
                    source: "command",
                    origin: "user",
                    label: "goal",
                    argumentHint: null,
                  },
                },
                {
                  start: pathStart,
                  end: pathStart + pathToken.length,
                  resource: {
                    kind: "path",
                    source: "workspace",
                    entryKind: "file",
                    path: "apps/app/src/foo.ts",
                    label: "foo.ts",
                  },
                },
                {
                  start: threadStart,
                  end: threadStart + threadToken.length,
                  resource: {
                    kind: "thread",
                    threadId: "thr_prompt_pills",
                    label: "Prompt pills QA",
                  },
                },
              ],
            },
          ],
        },
      ],
      {
        resolveMentionLink: (resource) =>
          resource.kind === "path" ? openPath : null,
      },
    );

    expect(container.querySelectorAll(".prompt-mention-pill")).toHaveLength(3);
    expect(container.querySelector('[data-icon="Target"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="File"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Laptop"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="MessageSquare"]')).toBeNull();
    expect(container.textContent).toContain(
      "Run goal and open foo.ts from Prompt pills QA",
    );
    expect(container.textContent).not.toContain(commandToken);
    expect(container.textContent).not.toContain(pathToken);
    expect(container.textContent).not.toContain(threadToken);

    fireEvent.click(getByText("foo.ts"));

    expect(openPath).toHaveBeenCalledTimes(1);
  });

  it("shows a bottom fade when the expanded queue overflows", async () => {
    const { container } = renderQueuedMessages(
      Array.from({ length: 8 }, (_, index) =>
        makeQueuedMessage(
          `q_${index}`,
          `Queued follow-up ${index}: check the compact scroll fade.`,
        ),
      ),
    );
    const scroll = container.querySelector<HTMLDivElement>(
      "[data-queued-messages-scroll]",
    );
    expect(scroll).not.toBeNull();
    if (!scroll) return;

    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(scroll, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(scroll);

    await waitFor(() => {
      const fade = container.querySelector(
        '[data-overflow-fade="below"][data-overflow-fade-tone="surface-raised"][data-overflow-fade-inset]',
      );
      expect(fade).not.toBeNull();
    });
  });

  it("resolves a row drag into a neighbor reorder request", () => {
    const queuedMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];

    expect(
      resolveQueuedMessageDrag({
        activeId: "q_three",
        overId: "q_one",
        orderedMessages: queuedMessages,
      }),
    ).toMatchObject({
      request: {
        queuedMessageId: "q_three",
        previousQueuedMessageId: null,
        nextQueuedMessageId: "q_one",
      },
      orderedMessages: [{ id: "q_three" }, { id: "q_one" }, { id: "q_two" }],
    });
  });

  it("clamps queued-message drags to the rendered list bottom", () => {
    expect(
      clampQueuedMessageDragTransform({
        draggingNodeRect: rect({ top: 24, bottom: 40 }),
        listRect: rect({ top: 0, bottom: 72 }),
        scrollRect: rect({ top: 0, bottom: 128 }),
        transform: { x: 12, y: 96, scaleX: 1, scaleY: 1 },
      }),
    ).toEqual({ x: 0, y: 32, scaleX: 1, scaleY: 1 });
  });

  it("re-adopts queued-message order from props when the same rows are restored", () => {
    const originalMessages = [
      makeQueuedMessage("q_one", "First queued message"),
      makeQueuedMessage("q_two", "Second queued message"),
      makeQueuedMessage("q_three", "Third queued message"),
    ];
    const { container, rerender } = renderQueuedMessages(originalMessages);

    rerender(
      <QueuedMessagesList
        queuedMessages={[
          originalMessages[1]!,
          originalMessages[0]!,
          originalMessages[2]!,
        ]}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSend={noop}
        onReorder={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );
    expect(
      Array.from(container.querySelectorAll("[data-queued-message-row]")).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Second queued message"),
      expect.stringContaining("First queued message"),
      expect.stringContaining("Third queued message"),
    ]);

    rerender(
      <QueuedMessagesList
        queuedMessages={originalMessages}
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSend={noop}
        onReorder={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(
      Array.from(container.querySelectorAll("[data-queued-message-row]")).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("First queued message"),
      expect.stringContaining("Second queued message"),
      expect.stringContaining("Third queued message"),
    ]);
  });

  it("does not show a fade when stale observer entries report hidden sentinels without overflow", async () => {
    interface ObserverControl {
      targets: Element[];
      trigger(entries: readonly Partial<IntersectionObserverEntry>[]): void;
    }

    const observers: ObserverControl[] = [];

    class IntersectionObserverMock implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly scrollMargin = "";
      readonly thresholds = [0];
      readonly targets: Element[] = [];

      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push(this);
      }

      disconnect() {}

      observe(target: Element) {
        this.targets.push(target);
      }

      takeRecords() {
        return [];
      }

      trigger(entries: readonly Partial<IntersectionObserverEntry>[]) {
        this.callback(entries as IntersectionObserverEntry[], this);
      }

      unobserve() {}
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const { container } = renderQueuedMessages([
      makeQueuedMessage("q_one", "single queued message"),
    ]);
    const scroll = container.querySelector<HTMLDivElement>(
      "[data-queued-messages-scroll]",
    );
    expect(scroll).not.toBeNull();
    if (!scroll) return;

    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 48,
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 48,
    });

    await waitFor(() => {
      expect(observers[0]?.targets).toHaveLength(2);
    });

    const currentObserver = observers[0];
    expect(currentObserver).toBeDefined();
    if (!currentObserver) return;

    const [topSentinel, bottomSentinel] = currentObserver.targets;
    expect(topSentinel).toBeDefined();
    expect(bottomSentinel).toBeDefined();
    if (!topSentinel || !bottomSentinel) return;

    act(() => {
      currentObserver.trigger([
        { target: topSentinel, isIntersecting: false },
        { target: bottomSentinel, isIntersecting: false },
      ]);
    });

    expect(container.querySelector('[data-overflow-fade="above"]')).toBeNull();
    expect(container.querySelector('[data-overflow-fade="below"]')).toBeNull();
  });
});

describe("queued row affordances", () => {
  it("uses the holding plugin's registered icon without a generic fallback", () => {
    setPluginLogoUrls(
      new Map([
        [
          "drafts",
          {
            displayName: "Drafts",
            icon: "EditFile",
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
    const { container, getByText } = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_draft", "Draft message"),
        waitingOn: {
          kind: "plugin",
          pluginId: "drafts",
          reason: "Draft",
        },
      },
    ]);

    const waitLine = getByText("Held by Drafts · Draft").closest(
      "[data-queued-message-wait]",
    );
    expect(waitLine?.querySelector("[data-icon=EditFile]")).not.toBeNull();
    expect(container.querySelector("[data-icon=Limitation]")).toBeNull();
  });

  it("explains the waits a reader cannot infer, and stays quiet otherwise", () => {
    const { getByText, queryByText, container } = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_busy", "Ordinary queued"),
        waitingOn: { kind: "thread-busy" },
      },
      {
        ...makeQueuedMessage("q_prov", "Behind provisioning"),
        waitingOn: { kind: "provisioning" },
      },
      {
        ...makeQueuedMessage("q_plugin", "Held by a limiter"),
        waitingOn: {
          kind: "plugin",
          pluginId: "concurrency-limit",
          reason: "4 of 4 running",
        },
      },
    ]);

    expect(getByText("Waiting for workspace")).toBeDefined();
    expect(
      getByText("Held by concurrency-limit · 4 of 4 running"),
    ).toBeDefined();
    expect(queryByText("Waiting for the current turn")).toBeNull();
    expect(
      container.querySelectorAll("[data-queued-message-wait]"),
    ).toHaveLength(2);
  });

  it("hides Send now only where a re-attempt could not clear the wait", () => {
    const { queryByLabelText } = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_busy", "Ordinary queued"),
        waitingOn: { kind: "thread-busy" },
      },
    ]);
    expect(queryByLabelText("Send queued message 1 now")).not.toBeNull();

    cleanup();
    const queued = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_wait", "Waiting on a reply"),
        waitingOn: { kind: "interaction" },
      },
    ]);
    expect(queued.queryByLabelText("Send queued message 1 now")).toBeNull();
  });

  it("offers to steer a provisioning row when the thread is ready", () => {
    const onSend = vi.fn();
    const { getByLabelText } = render(
      <QueuedMessagesList
        queuedMessages={[
          {
            ...makeQueuedMessage("q_provisioning", "Steer after startup"),
            waitingOn: { kind: "provisioning" },
          },
        ]}
        sendAction="steer-when-ready"
        sendDisabled={false}
        actionDisabled={false}
        processingMessageId={null}
        processingAction={null}
        onSend={onSend}
        onReorder={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    fireEvent.click(getByLabelText("Steer queued message 1 when ready"));
    expect(onSend).toHaveBeenCalledWith("q_provisioning");
  });

  it("names the absent machine on a host-offline row and hides Send now", () => {
    const { getByText, queryByLabelText } = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_offline", "Capture the Safari trace"),
        waitingOn: { kind: "host-offline", hostName: "M4" },
      },
    ]);
    expect(getByText("Waiting for M4 to be ready")).toBeDefined();
    expect(queryByLabelText("Send queued message 1 now")).toBeNull();
  });

  it("lets a drain failure take over the line the wait would have used", () => {
    const { getByText, queryByText, container } = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_failed", "Post the summary"),
        waitingOn: { kind: "provisioning" },
        failureReason: "Thread stopped before the message could dispatch",
      },
    ]);
    expect(
      getByText("Thread stopped before the message could dispatch"),
    ).toBeDefined();
    expect(queryByText("Waiting for workspace")).toBeNull();
    expect(
      container.querySelector("[data-queued-message-failed]"),
    ).not.toBeNull();
  });

  it("gives a retry row a title of its own when it has no message to show", () => {
    const { getByText } = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_retry_title", ""),
        content: [
          {
            type: "text",
            text: "The original question",
            mentions: [],
            visibility: "agent-only",
          },
        ],
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req_1",
          attempt: 2,
          reason: "Rate limited",
        },
        editable: false,
        waitingOn: { kind: "time" },
        sendAt: 0,
      },
    ]);
    expect(getByText(/^Retry failed turn from /u)).toBeDefined();
    expect(
      getByText(/^Rate limited · retrying at .* · attempt 2$/u),
    ).toBeDefined();
  });

  it("offers no edit on a row the server says is not editable", () => {
    const { queryByLabelText } = renderQueuedMessages([
      {
        ...makeQueuedMessage("q_retry", ""),
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req_1",
          attempt: 2,
          reason: "Rate limited",
        },
        editable: false,
        waitingOn: { kind: "time" },
        sendAt: 0,
      },
    ]);
    expect(queryByLabelText("Edit queued message 1")).toBeNull();
    expect(queryByLabelText("Delete queued message 1")).not.toBeNull();
  });
});

function queueProps(
  queuedMessages: readonly ThreadQueuedMessage[],
  overrides: Partial<QueuedMessagesListProps> = {},
): QueuedMessagesListProps {
  return {
    attachedToComposer: true,
    queuedMessages,
    sendAction: "send-now",
    sendDisabled: false,
    actionDisabled: false,
    processingMessageId: null,
    processingAction: null,
    onSend: noop,
    onReorder: noop,
    onEdit: noop,
    onDelete: noop,
    ...overrides,
  };
}

function threeQueuedMessages() {
  return [
    makeQueuedMessage("q_alpha", "Alpha"),
    makeQueuedMessage("q_bravo", "Bravo"),
    makeQueuedMessage("q_charlie", "Charlie"),
  ];
}

function queueMode(container: HTMLElement) {
  return container
    .querySelector("[data-queued-messages-mode]")
    ?.getAttribute("data-queued-messages-mode");
}

function queueHeight(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    'section[aria-label="Queued messages"]',
  )?.style.height;
}

function summaryOf(container: HTMLElement, variant: "strip" | "stack") {
  return container.querySelector<HTMLElement>(
    `[data-queued-messages-summary="${variant}"]`,
  );
}

function summaryTriggerOf(container: HTMLElement, variant: "strip" | "stack") {
  return summaryOf(container, variant)?.querySelector<HTMLElement>(
    "[data-queued-messages-summary-trigger]",
  ) as HTMLElement;
}

function ordinalsOf(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll("[data-queued-message-ordinal]"),
    (ordinal) => ordinal.textContent,
  );
}

describe("queue summary, ordinals, and pending states", () => {
  it("summarizes the first message in queue order with the total count", () => {
    const view = renderQueue(queueProps(threeQueuedMessages()));
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );

    const summary = summaryOf(view.container, "strip");
    expect(summary?.textContent).toContain("Alpha");
    expect(summary?.textContent).not.toContain("Bravo");
    expect(
      summary?.querySelector("[data-queued-messages-count]")?.textContent,
    ).toBe("3 queued");
  });

  it("keeps head mention links out of the summary trigger", () => {
    const text = "Ask @thread:thr_other about it";
    const start = text.indexOf("@thread:thr_other");
    const view = render(
      <MemoryRouter>
        <QueuedMessagesList
          {...queueProps([
            makeThreadQueuedMessage({
              id: "q_mention",
              threadId: "thr_prompt_pills",
              content: [
                {
                  type: "text",
                  text,
                  mentions: [
                    {
                      start,
                      end: start + "@thread:thr_other".length,
                      resource: {
                        kind: "thread",
                        threadId: "thr_other",
                        label: "Other",
                        projectId: "prj_1",
                      },
                    },
                  ],
                },
              ],
            }),
          ])}
        />
      </MemoryRouter>,
    );
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );

    const summary = summaryOf(view.container, "strip") as HTMLElement;
    const trigger = summaryTriggerOf(view.container, "strip");
    expect(trigger.querySelector("a, [role=link], button")).toBeNull();
    expect(trigger.getAttribute("aria-label")).toContain(
      "First in queue: Ask @thread:thr_other about it",
    );
    expect(
      summary
        .querySelector("[inert]")
        ?.contains(summary.querySelector("a, [role=link]")),
    ).toBe(true);
  });

  it("shows the new head after a reorder rerenders the queue", () => {
    const [alpha, bravo, charlie] = threeQueuedMessages();
    const view = renderQueue(queueProps([alpha, bravo, charlie]));
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );

    view.rerender(
      <QueuedMessagesList {...queueProps([charlie, alpha, bravo])} />,
    );

    const summary = summaryOf(view.container, "strip");
    expect(summary?.textContent).toContain("Charlie");
    expect(summary?.textContent).not.toContain("Alpha");
    expect(
      summary?.querySelector("[data-queued-messages-count]")?.textContent,
    ).toBe("3 queued");
  });

  it("counts failures across the whole queue and shows the head's failure line", () => {
    const [alpha, bravo, charlie] = threeQueuedMessages();
    const view = renderQueue(
      queueProps([
        {
          ...bravo,
          failureReason: "Thread stopped before the message could dispatch",
        },
        alpha,
        { ...charlie, failureReason: "Host went away" },
      ]),
    );
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );

    const summary = summaryOf(view.container, "strip");
    expect(
      summary?.querySelector("[data-queued-messages-failed-count]")
        ?.textContent,
    ).toBe("2 failed");
    expect(summary?.textContent).toContain(
      "Thread stopped before the message could dispatch",
    );
  });

  it("counts only confirmed rows as queued and reports optimistic rows as queuing", () => {
    const [alpha, bravo] = threeQueuedMessages();
    const optimistic = makeQueuedMessage(
      "optimistic-queued-1",
      "Still being queued",
    );
    const view = renderQueue(queueProps([alpha, bravo, optimistic]));
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );

    const summary = summaryOf(view.container, "strip");
    expect(
      summary?.querySelector("[data-queued-messages-count]")?.textContent,
    ).toBe("2 queued");
    expect(
      summary?.querySelector("[data-queued-messages-unconfirmed-count]")
        ?.textContent,
    ).toBe("1 queuing…");
  });

  it("omits the queued count while every row is still queuing", () => {
    const view = renderQueue(
      queueProps([
        makeQueuedMessage("optimistic-queued-1", "Still being queued"),
      ]),
    );
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );

    const summary = summaryOf(view.container, "strip");
    expect(summary?.querySelector("[data-queued-messages-count]")).toBeNull();
    expect(
      summary?.querySelector("[data-queued-messages-unconfirmed-count]")
        ?.textContent,
    ).toBe("1 queuing…");
  });

  it("keeps the stack queue order header to confirmed and queuing counts", () => {
    const [alpha, bravo] = threeQueuedMessages();
    const view = renderQueue(
      queueProps(
        [
          alpha,
          bravo,
          makeQueuedMessage("optimistic-queued-1", "Still being queued"),
        ],
        { summaryVariant: "stack" },
      ),
    );

    const header = view.container.querySelector(
      "[data-queued-messages-header]",
    );
    expect(
      header?.querySelector("[data-queued-messages-count]")?.textContent,
    ).toBe("2 queued");
    expect(
      header?.querySelector("[data-queued-messages-unconfirmed-count]")
        ?.textContent,
    ).toBe("1 queuing…");
  });

  it("hides only the strip head's wait label on narrow cards, keeping it in the DOM", () => {
    const waiting = {
      ...makeQueuedMessage("q_alpha", "Alpha"),
      waitingOn: { kind: "provisioning" as const },
    };
    const strip = renderQueue(
      queueProps([waiting, makeQueuedMessage("q_bravo", "Bravo")]),
    );
    fireEvent.click(
      strip.getByRole("button", { name: "Collapse queued messages" }),
    );
    const stripLabel = within(
      summaryOf(strip.container, "strip") as HTMLElement,
    ).getByText("Waiting for workspace");
    expect(stripLabel.classList.contains("@max-md/queue:sr-only")).toBe(true);
    cleanup();

    const stack = renderQueue(
      queueProps([waiting, makeQueuedMessage("q_bravo", "Bravo")], {
        summaryVariant: "stack",
      }),
    );
    fireEvent.click(
      stack.getByRole("button", { name: "Collapse queued messages" }),
    );
    const stackLabel = within(
      summaryOf(stack.container, "stack") as HTMLElement,
    ).getByText("Waiting for workspace");
    expect(stackLabel.classList.contains("@max-md/queue:sr-only")).toBe(false);
  });

  it("labels a pending send as Sending or Steering and never as sent or running", () => {
    const [alpha, bravo] = threeQueuedMessages();
    const messages = [alpha, bravo];
    const view = renderQueue(
      queueProps(messages, {
        pendingSend: { queuedMessageId: "q_alpha", mode: "auto" },
      }),
    );
    expect(
      view.container.querySelector(
        '[data-queued-messages-status] [data-queued-messages-pending-send="auto"]',
      )?.textContent,
    ).toContain("Sending…");

    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );
    const pending = () =>
      summaryOf(view.container, "strip")?.querySelector(
        "[data-queued-messages-pending-send]",
      );
    expect(pending()?.textContent).toContain("Sending…");

    view.rerender(
      <QueuedMessagesList
        {...queueProps(messages, {
          pendingSend: { queuedMessageId: "q_alpha", mode: "steer" },
        })}
      />,
    );
    expect(pending()?.getAttribute("data-queued-messages-pending-send")).toBe(
      "steer",
    );
    expect(pending()?.textContent).toContain("Steering…");
    expect(view.container.textContent).not.toMatch(
      /\bsent\b|running|accepted|next to send/iu,
    );
  });

  it("shows only the pending send when the queue is empty", () => {
    const view = renderQueue(
      queueProps([], {
        pendingSend: { queuedMessageId: "q_gone", mode: "steer" },
      }),
    );

    expect(view.getByText("Steering…")).toBeDefined();
    expect(queueHeight(view.container)).toBe("54px");
    expect(
      view.container.querySelector("[data-queued-message-row]"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-queued-messages-summary]"),
    ).toBeNull();
    expect(
      view.container
        .querySelector("[data-queued-messages-mode]")
        ?.classList.contains("hidden"),
    ).toBe(true);
    expect(view.container.textContent).not.toMatch(
      /\bsent\b|running|accepted|next to send/iu,
    );
  });

  it("renders nothing for an empty queue with no pending send", () => {
    const { container } = renderQueue(queueProps([]));
    expect(
      container.querySelector('section[aria-label="Queued messages"]'),
    ).toBeNull();
  });

  it("labels an optimistic row as unconfirmed and gates its actions on actionDisabled", () => {
    const optimistic = makeQueuedMessage(
      "optimistic-queued-1",
      "Still being queued",
    );
    const actionNames = [
      "Send queued message 1 now",
      "Edit queued message 1",
      "Delete queued message 1",
      "Queued message 1 actions",
    ];
    const view = renderQueue(
      queueProps([optimistic], { actionDisabled: true }),
    );

    const row = view.container.querySelector(
      '[data-queued-message-id="optimistic-queued-1"]',
    );
    expect(
      row?.querySelector("[data-queued-message-unconfirmed]")?.textContent,
    ).toBe("Queuing… waiting for server");
    expect(row?.querySelector("[data-queued-message-wait]")).toBeNull();
    for (const name of actionNames) {
      expect((view.getByLabelText(name) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }

    view.rerender(<QueuedMessagesList {...queueProps([optimistic])} />);
    for (const name of actionNames) {
      expect((view.getByLabelText(name) as HTMLButtonElement).disabled).toBe(
        false,
      );
    }
  });

  it("disables only send while sendDisabled, leaving edit and delete live", () => {
    const view = renderQueue(
      queueProps([makeQueuedMessage("q_one", "One")], { sendDisabled: true }),
    );

    expect(
      (view.getByLabelText("Send queued message 1 now") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (view.getByLabelText("Edit queued message 1") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (view.getByLabelText("Delete queued message 1") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it.each<[string, ThreadQueuedMessage["waitingOn"]]>([
    ["time", { kind: "time" }],
    ["thread-busy", { kind: "thread-busy" }],
    [
      "plugin",
      {
        kind: "plugin",
        pluginId: "concurrency-limit",
        reason: "4 of 4 running",
      },
    ],
  ])("offers send-now on a %s wait", (_, waitingOn) => {
    const { queryByLabelText } = renderQueue(
      queueProps([{ ...makeQueuedMessage("q_one", "One"), waitingOn }]),
    );
    expect(queryByLabelText("Send queued message 1 now")).not.toBeNull();
  });

  it.each<[string, ThreadQueuedMessage["waitingOn"]]>([
    ["provisioning", { kind: "provisioning" }],
    ["host-offline", { kind: "host-offline", hostName: "M4" }],
    ["interaction", { kind: "interaction" }],
    ["turn-starting", { kind: "turn-starting" }],
    ["stopping", { kind: "stopping" }],
  ])(
    "withholds send-now on a %s wait but keeps edit and delete",
    (_, waitingOn) => {
      const { queryByLabelText } = renderQueue(
        queueProps([{ ...makeQueuedMessage("q_one", "One"), waitingOn }]),
      );
      expect(queryByLabelText("Send queued message 1 now")).toBeNull();
      expect(queryByLabelText("Edit queued message 1")).not.toBeNull();
      expect(queryByLabelText("Delete queued message 1")).not.toBeNull();
    },
  );

  it("keeps steer-when-ready on a blocked wait, named as steering", () => {
    const blocked = {
      ...makeQueuedMessage("q_one", "One"),
      waitingOn: { kind: "interaction" as const },
    };
    const view = renderQueue(
      queueProps([blocked], {
        sendAction: "steer-when-ready",
        sendDisabled: true,
      }),
    );
    expect(
      (
        view.getByLabelText(
          "Steer queued message 1 when ready",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    view.rerender(
      <QueuedMessagesList
        {...queueProps([blocked], { sendAction: "steer-when-ready" })}
      />,
    );
    expect(
      (
        view.getByLabelText(
          "Steer queued message 1 when ready",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("numbers strip rows 1 to N in queue order and drops the numbers in stack", () => {
    const [alpha, bravo, charlie] = threeQueuedMessages();
    const view = renderQueue(queueProps([alpha, bravo, charlie]));
    expect(ordinalsOf(view.container)).toEqual(["1", "2", "3"]);

    view.rerender(
      <QueuedMessagesList {...queueProps([charlie, alpha, bravo])} />,
    );
    expect(ordinalsOf(view.container)).toEqual(["1", "2", "3"]);
    expect(
      view.container.querySelector(
        '[data-queued-message-id="q_charlie"] [data-queued-message-ordinal]',
      )?.textContent,
    ).toBe("1");

    cleanup();
    const stack = renderQueue(
      queueProps(threeQueuedMessages(), { summaryVariant: "stack" }),
    );
    expect(ordinalsOf(stack.container)).toEqual([]);
  });

  it("adds a queue order header and one stack edge for two messages, two for three", () => {
    const [alpha, bravo, charlie] = threeQueuedMessages();
    const view = renderQueue(
      queueProps([alpha, bravo], { summaryVariant: "stack" }),
    );

    const header = view.container.querySelector(
      "[data-queued-messages-header]",
    );
    expect(header?.textContent).toContain("Queue order");
    expect(header?.textContent).toContain("2 queued");
    expect(queueHeight(view.container)).toBe("94px");

    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );
    expect(
      view.container.querySelector("[data-queued-messages-header]"),
    ).toBeNull();
    expect(
      view.container.querySelectorAll("[data-queued-messages-stack-edge]"),
    ).toHaveLength(1);

    cleanup();
    const threeMessageStack = renderQueue(
      queueProps([alpha, bravo, charlie], { summaryVariant: "stack" }),
    );
    fireEvent.click(
      threeMessageStack.getByRole("button", {
        name: "Collapse queued messages",
      }),
    );
    expect(
      threeMessageStack.container.querySelectorAll(
        "[data-queued-messages-stack-edge]",
      ),
    ).toHaveLength(2);
  });

  it("adds the stack header height to the drawer and the workspace", () => {
    const messages = threeQueuedMessages();
    const strip = renderQueue(queueProps(messages.slice(0, 2)));
    expect(queueHeight(strip.container)).toBe("74px");
    cleanup();

    const stack = renderQueue(
      queueProps(messages.slice(0, 2), { summaryVariant: "stack" }),
    );
    expect(queueHeight(stack.container)).toBe("94px");
    cleanup();

    const longQueue = Array.from({ length: 5 }, (_, index) =>
      makeQueuedMessage(`q_${index}`, `Queued message ${index + 1}`),
    );
    const stripWorkspace = renderQueue(queueProps(longQueue));
    fireEvent.click(
      stripWorkspace.getByRole("button", { name: "Expand queued messages" }),
    );
    const stripHeight = Number.parseFloat(
      queueHeight(stripWorkspace.container) ?? "",
    );
    cleanup();

    const stackWorkspace = renderQueue(
      queueProps(longQueue, { summaryVariant: "stack" }),
    );
    fireEvent.click(
      stackWorkspace.getByRole("button", { name: "Expand queued messages" }),
    );
    expect(
      Number.parseFloat(queueHeight(stackWorkspace.container) ?? "") -
        stripHeight,
    ).toBe(20);
  });

  it.each<["strip" | "stack", string]>([
    ["strip", "54px"],
    ["stack", "72px"],
  ])("collapses the %s variant to %s", (summaryVariant, height) => {
    const view = renderQueue(
      queueProps(threeQueuedMessages().slice(0, 2), { summaryVariant }),
    );
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );
    expect(queueHeight(view.container)).toBe(height);
  });

  it("names the head in the stack summary and counts the messages behind it", () => {
    const [alpha] = threeQueuedMessages();
    const single = renderQueue(
      queueProps([alpha], { summaryVariant: "stack" }),
    );
    fireEvent.click(
      single.getByRole("button", { name: "Collapse queued messages" }),
    );
    const onlySummary = summaryOf(single.container, "stack");
    expect(onlySummary?.textContent).toContain("Alpha");
    expect(onlySummary?.textContent).toContain("Only message");
    cleanup();

    const queue = renderQueue(
      queueProps(threeQueuedMessages(), { summaryVariant: "stack" }),
    );
    fireEvent.click(
      queue.getByRole("button", { name: "Collapse queued messages" }),
    );
    const summary = summaryOf(queue.container, "stack");
    expect(summary?.textContent).toContain("First in queue");
    expect(summary?.textContent).toContain("+2 more");
  });

  it.each<["strip" | "stack"]>([["strip"], ["stack"]])(
    "opens the drawer from a collapsed %s summary when the queue fits",
    (summaryVariant) => {
      const view = renderQueue(
        queueProps(threeQueuedMessages(), { summaryVariant }),
      );
      fireEvent.click(
        view.getByRole("button", { name: "Collapse queued messages" }),
      );

      fireEvent.click(summaryTriggerOf(view.container, summaryVariant), {
        detail: 1,
      });
      expect(queueMode(view.container)).toBe("drawer");
    },
  );

  it.each<["strip" | "stack"]>([["strip"], ["stack"]])(
    "opens the workspace from a collapsed %s summary above three messages",
    (summaryVariant) => {
      const view = renderQueue(
        queueProps(
          [...threeQueuedMessages(), makeQueuedMessage("q_delta", "Delta")],
          { summaryVariant },
        ),
      );
      fireEvent.click(
        view.getByRole("button", { name: "Expand queued messages" }),
      );
      fireEvent.click(
        view.getByRole("button", { name: "Collapse queued messages" }),
      );
      expect(queueMode(view.container)).toBe("collapsed");

      fireEvent.click(summaryTriggerOf(view.container, summaryVariant), {
        detail: 1,
      });
      expect(queueMode(view.container)).toBe("workspace");
    },
  );

  it("moves focus to the caret after a keyboard-activated summary expands", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const view = renderQueue(queueProps(threeQueuedMessages()));
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );
    const summary = summaryTriggerOf(view.container, "strip");
    summary.focus();

    fireEvent.click(summary);
    expect(queueMode(view.container)).toBe("drawer");
    const caret = view.getByRole("button", {
      name: "Collapse queued messages",
    });
    expect(document.activeElement).not.toBe(caret);

    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(document.activeElement).toBe(caret);
  });

  it("keeps composer focus when the summary is pressed", () => {
    const view = renderQueue(queueProps(threeQueuedMessages()));
    fireEvent.click(
      view.getByRole("button", { name: "Collapse queued messages" }),
    );

    expect(fireEvent.mouseDown(summaryTriggerOf(view.container, "strip"))).toBe(
      false,
    );
  });

  it("keeps send, edit, and delete bound to each row's message after a reorder", () => {
    const onSend = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const [alpha, bravo, charlie] = threeQueuedMessages();
    const view = renderQueue(
      queueProps([alpha, bravo, charlie], { onSend, onEdit, onDelete }),
    );

    fireEvent.click(view.getByLabelText("Delete queued message 2"));
    expect(onDelete).toHaveBeenCalledWith("q_bravo");
    fireEvent.click(view.getByLabelText("Edit queued message 2"));
    expect(onEdit).toHaveBeenLastCalledWith({
      queuedMessageId: "q_bravo",
      queuedMessageIndex: 1,
    });

    view.rerender(
      <QueuedMessagesList
        {...queueProps([charlie, alpha, bravo], { onSend, onEdit, onDelete })}
      />,
    );
    fireEvent.click(view.getByLabelText("Send queued message 1 now"));
    expect(onSend).toHaveBeenCalledWith("q_charlie");
    fireEvent.click(view.getByLabelText("Edit queued message 1"));
    expect(onEdit).toHaveBeenLastCalledWith({
      queuedMessageId: "q_charlie",
      queuedMessageIndex: 0,
    });
  });
});

function renderQueue(props: QueuedMessagesListProps) {
  return render(<QueuedMessagesList {...props} />);
}
