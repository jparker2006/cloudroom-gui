// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: openUrl,
}));

import { ThreadHelpButton, ThreadHelpPanel } from "./ThreadHelp";

afterEach(() => {
  cleanup();
  openUrl.mockReset();
});

const search = () =>
  screen.getByRole("searchbox", { name: "Search thread help" });

it("lists thread-relevant topics first and filters by search", () => {
  render(<ThreadHelpPanel relevantTopicIds={["reconnecting"]} />);
  expect(screen.getByRole("heading", { name: "For this thread" })).toBeTruthy();
  expect(screen.getAllByRole("button")[0]?.textContent).toContain(
    "Reconnecting or offline",
  );
  fireEvent.change(search(), { target: { value: "compaction" } });
  expect(screen.queryByRole("heading", { name: "For this thread" })).toBeNull();
  expect(
    screen.getByRole("button", { name: /Context compacted/ }),
  ).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/topics? found/);
});

it("shows an explicit no-results state that can be cleared", () => {
  render(<ThreadHelpPanel />);
  fireEvent.change(search(), { target: { value: "kubernetes" } });
  expect(screen.getAllByText(/No help topics match/)).toHaveLength(2);
  expect(screen.getByRole("status").textContent).toBe(
    "No help topics match “kubernetes”",
  );
  fireEvent.click(screen.getByRole("button", { name: "Show all topics" }));
  expect((search() as HTMLInputElement).value).toBe("");
  expect(document.activeElement).toBe(search());
  expect(
    screen.getByRole("button", { name: /Host disconnected/ }),
  ).toBeTruthy();
});

it("opens a topic, follows related links, and returns with search and focus kept", async () => {
  render(<ThreadHelpPanel />);
  fireEvent.change(search(), { target: { value: "context" } });
  fireEvent.click(screen.getByRole("button", { name: /^Context usage/ }));
  const heading = screen.getByRole("heading", {
    level: 3,
    name: "Context usage",
  });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(screen.getByText(/does not mean zero/)).toBeTruthy();
  expect(screen.getByText("Next step:")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Context compacted" }));
  const related = screen.getByRole("heading", {
    level: 3,
    name: "Context compacted",
  });
  await waitFor(() => expect(document.activeElement).toBe(related));

  fireEvent.click(screen.getByRole("button", { name: "All help topics" }));
  expect((search() as HTMLInputElement).value).toBe("context");
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.helpTopic).toBe(
      "context-usage",
    ),
  );
});

it("returns focus to search when a topic was opened directly", async () => {
  render(<ThreadHelpPanel initialTopicId="limits" />);
  fireEvent.click(screen.getByRole("button", { name: "All help topics" }));
  await waitFor(() => expect(document.activeElement).toBe(search()));
});

it("opens docs through the external browser route", () => {
  render(<ThreadHelpPanel initialTopicId="where-it-runs" />);
  fireEvent.click(screen.getByRole("link", { name: /Docs: Local or Cloud/ }));
  expect(openUrl).toHaveBeenCalledWith(
    "https://www.cloudroom.dev/docs/local-threads#local-or-cloud",
  );
});

it("opens from its button and from a stable topic link", async () => {
  const { unmount } = render(
    <MemoryRouter>
      <ThreadHelpButton
        label="About reconnecting"
        initialTopicId="reconnecting"
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "About reconnecting" }));
  expect(
    await screen.findByRole("heading", {
      level: 3,
      name: "Reconnecting or offline",
    }),
  ).toBeTruthy();
  unmount();

  const where = vi.fn();
  function Where() {
    const current = useLocation();
    useEffect(() =>
      where(`${current.pathname}${current.search}${current.hash}`),
    );
    return null;
  }
  render(
    <MemoryRouter initialEntries={["/threads/thr_1?view=x#thread-help/limits"]}>
      <ThreadHelpButton label="Thread help" listenToHash />
      <Where />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole("heading", {
      level: 3,
      name: "Provider quota, context, and plan limits",
    }),
  ).toBeTruthy();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  await waitFor(() =>
    expect(where).toHaveBeenLastCalledWith("/threads/thr_1?view=x"),
  );
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
});

it("needs no router unless it listens for topic links", () => {
  render(<ThreadHelpButton label="About limits" initialTopicId="limits" />);
  expect(screen.getByRole("button", { name: "About limits" })).toBeTruthy();
});
