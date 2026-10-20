// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptDraftAttachment } from "@cloudroom/client-core";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import type { NewThreadPromptBoxProps } from "./NewThreadPromptBox";
import { NewThreadComposer } from "./NewThreadComposer";

const mocks = vi.hoisted(() => ({ copy: vi.fn() }));

vi.mock("@/lib/sdk", () => ({
  sdk: { projects: { attachments: { copy: mocks.copy } } },
}));

vi.mock("./NewThreadPromptBox", () => ({
  NewThreadPromptBox: ({
    attachments,
    disabledReason,
    onSubmit,
    project,
  }: NewThreadPromptBoxProps) => (
    <div>
      <p data-testid="attachment-error">{attachments?.error ?? ""}</p>
      <p data-testid="disabled-reason">{disabledReason ?? ""}</p>
      <button type="button" onClick={() => void project?.onChange("proj_c")}>
        Move to C
      </button>
      <button type="button" onClick={onSubmit}>
        Send
      </button>
    </div>
  ),
}));

const project = (id: string) => ({
  id,
  name: id,
  sources: [],
  threads: [],
  gitRemoteUrl: null,
  defaultExecutionOptions: null,
});

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      projects: ["proj_a", "proj_b", "proj_c"].map(project),
      personalProject: project("proj_personal"),
    },
    isError: false,
    isPlaceholderData: false,
    isSuccess: true,
  }),
}));
vi.mock("@/hooks/queries/cloudroom-queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCloudroomConnection: () => ({ data: undefined }),
}));
vi.mock("@/hooks/useCloudLocked", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCloudLocked: () => false,
}));
vi.mock("@cloudroom/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));
vi.mock("@/hooks/queries/host-queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHosts: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));
vi.mock("@/hooks/queries/environment-provider-queries", () => ({
  useSystemEnvironmentProviders: () => ({ providers: [] }),
}));
vi.mock("@/hooks/queries/machine-provider-queries", () => ({
  useSystemMachineProviders: () => ({ providers: [] }),
}));
vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: () => ({ data: { plugins: [] } }),
}));
vi.mock("@/hooks/queries/project-default-execution-options-query", () => ({
  useProjectDefaultExecutionOptions: () => ({
    data: null,
    isError: false,
    isPlaceholderData: false,
    isSuccess: true,
  }),
}));
vi.mock("@/hooks/queries/project-queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProjectPromptHistory: () => ({ data: [] }),
}));
vi.mock("@/hooks/usePromptHistoryEnabled", () => ({
  usePromptHistoryEnabled: () => false,
}));
vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    triggers: [],
    results: [],
    isLoading: false,
    isError: false,
    setQuery: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: () => ({
    trigger: null,
    suggestions: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
  }),
}));
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ environmentProviderInputs: [] }),
}));
vi.mock("@/components/pickers/machine-provider-inputs", () => ({
  useMachineProviderInputs: () => ({
    value: null,
    blockedReason: null,
    control: null,
  }),
}));
vi.mock("@/hooks/thread-creation-options/persisted-selection-fields", () => ({
  usePromptBoxMachinePreference: () => ({ value: "", setValue: vi.fn() }),
}));
vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: () => ({
    activeModel: null,
    executionInputSources: {},
    executionOptionsRouting: { hostId: null, environmentId: null },
    environmentSelectionValue: "",
    hasMultipleProviders: false,
    isLoadingModels: false,
    modelLoadError: null,
    modelLoadFailed: false,
    modelOptions: [],
    moreModelOptions: [],
    permissionMode: "auto",
    permissionModeOptions: [],
    providerOptions: [{ value: "codex", label: "Codex" }],
    reasoningLevel: "medium",
    reasoningOptions: [],
    selectedModel: "test-model",
    selectedProviderComposerActions: [],
    selectedProviderDisplayName: "Codex",
    selectedProviderId: "codex",
    serviceTier: undefined,
    serviceTierSupportByProvider: {},
    serviceTierFastLabel: "Fast",
    setEnvironmentSelectionValue: vi.fn(),
    setPermissionMode: vi.fn(),
    setProviderModelReasoning: vi.fn(),
    setReasoningLevel: vi.fn(),
    setSelectedModel: vi.fn(),
    setSelectedProviderId: vi.fn(),
    setServiceTier: vi.fn(),
    supportsPermissionModeSelection: false,
    supportsServiceTier: false,
    clearReuseEnvironment: vi.fn(),
  }),
}));

const draft = getPromptDraftAccessor({ kind: "new-thread" });

const image = (
  path: string,
  projectId?: string,
  copyToken?: string,
): PromptDraftAttachment => ({
  type: "localImage",
  path,
  name: path,
  mimeType: "image/png",
  sizeBytes: 4,
  ...(projectId === undefined ? {} : { projectId }),
  ...(copyToken === undefined ? {} : { copyToken }),
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderComposer(attachments: PromptDraftAttachment[]) {
  draft.setDraft({ text: "look", mentions: [], attachments, contexts: [] });
  const onProjectChange = vi.fn();
  const onSubmit = vi.fn();
  render(
    <MemoryRouter>
      <NewThreadComposer
        projectId="proj_b"
        onProjectChange={onProjectChange}
        draftStorage={{ kind: "new-thread" }}
        selectionScope="new-thread"
        seed={{
          providerId: "codex",
          model: "test-model",
          reasoningLevel: "medium",
          permissionMode: "auto",
          environment: { type: "reuse", environmentId: "env_b" },
        }}
        onSubmit={onSubmit}
      >
        {(composer) => composer.renderPromptBox({})}
      </NewThreadComposer>
    </MemoryRouter>,
  );
  return { onProjectChange, onSubmit };
}

const flush = () => act(async () => {});

beforeEach(() => {
  localStorage.setItem("cloudroom.executionTarget", "local");
});

afterEach(() => {
  cleanup();
  draft.setDraft({ text: "", mentions: [], attachments: [], contexts: [] });
  vi.clearAllMocks();
});

describe("NewThreadComposer attachment copies", () => {
  it("blocks a project switch for an attachment without an upload token and names it", async () => {
    const legacy = image("legacy.png");
    const { onProjectChange } = renderComposer([legacy]);

    fireEvent.click(screen.getByRole("button", { name: "Move to C" }));
    await flush();

    expect(screen.getByTestId("attachment-error").textContent).toBe(
      "legacy.png can't be moved to another project. Remove it and attach again.",
    );
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(draft.getCurrent().attachments).toEqual([legacy]);
  });

  it("moves to the next project only after copying every attachment it does not own by token", async () => {
    const copy = deferred();
    mocks.copy.mockReturnValue(copy.promise);
    const { onProjectChange } = renderComposer([
      image("a.png", "proj_a", "token-a"),
      image("b.png", "proj_b", "token-b"),
      image("c.png", "proj_c", "token-c"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Move to C" }));
    await flush();
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith({
      projectId: "proj_c",
      tokens: ["token-a", "token-b"],
    });
    expect(onProjectChange).not.toHaveBeenCalled();

    await act(async () => copy.resolve());
    expect(onProjectChange).toHaveBeenCalledExactlyOnceWith("proj_c");
  });

  it("stays on the current project and keeps the draft when the copy fails", async () => {
    mocks.copy.mockRejectedValue(new Error("Attachment changed after it was uploaded"));
    const attachments = [image("a.png", "proj_b", "token-b")];
    const { onProjectChange } = renderComposer(attachments);

    fireEvent.click(screen.getByRole("button", { name: "Move to C" }));
    await flush();

    expect(screen.getByTestId("attachment-error").textContent).toBe(
      "Attachment changed after it was uploaded",
    );
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(draft.getCurrent().attachments).toEqual(attachments);
  });

  it("creates the thread only after copying foreign attachments into its project", async () => {
    const copy = deferred();
    mocks.copy.mockReturnValue(copy.promise);
    const { onSubmit } = renderComposer([
      image("a.png", "proj_a", "token-a"),
      image("b.png", "proj_b", "token-b"),
    ]);
    expect(screen.getByTestId("disabled-reason").textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith({
      projectId: "proj_b",
      tokens: ["token-a"],
    });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => copy.resolve());
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      projectId: "proj_b",
      input: [
        { type: "text", text: "look" },
        { type: "localImage", path: "a.png" },
        { type: "localImage", path: "b.png" },
      ],
    });
    expect(draft.getCurrent().attachments).toEqual([]);
  });

  it("never creates the thread and keeps the draft when the copy fails", async () => {
    mocks.copy.mockRejectedValue(new Error("Project is unavailable"));
    const attachments = [image("a.png", "proj_a", "token-a")];
    const { onSubmit } = renderComposer(attachments);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("attachment-error").textContent).toBe(
      "Project is unavailable",
    );
    expect(draft.getCurrent().attachments).toEqual(attachments);
  });

  it("names a foreign attachment without an upload token instead of sending it", async () => {
    const attachments = [image("a.png", "proj_a")];
    const { onSubmit } = renderComposer(attachments);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await flush();

    expect(screen.getByTestId("attachment-error").textContent).toBe(
      "a.png can't be moved to another project. Remove it and attach again.",
    );
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(draft.getCurrent().attachments).toEqual(attachments);
  });
});
