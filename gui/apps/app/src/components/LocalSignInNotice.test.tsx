// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocalSignInNotice } from "./LocalSignInNotice";

afterEach(cleanup);

it("says Codex needs authorization without claiming a login expired", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LocalSignInNotice threadId="thr_1" providerId="codex" authFailed started />
    </QueryClientProvider>,
  );
  expect(screen.getByText(/Codex needs authorization/)).toBeTruthy();
  expect(screen.queryByText(/expired/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});
