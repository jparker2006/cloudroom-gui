import { describe, expect, it } from "vitest";
import { BbHttpError } from "@cloudroom/sdk/browser";
import { classifyDraftProject } from "./new-thread-draft-lookup";

function httpError(status: number, code: string | null) {
  return new BbHttpError({ body: null, code, message: "x", status });
}

describe("classifyDraftProject", () => {
  it("calls a project that still exists outside the list 'not in your list'", async () => {
    expect(await classifyDraftProject(async () => ({ id: "proj_hidden" }), "proj_hidden")).toBe(
      "not-in-list",
    );
  });

  it.each(["project_not_found", "project_unavailable"])(
    "calls a project the server reports as %s 'no longer available'",
    async (code) => {
      expect(
        await classifyDraftProject(async () => {
          throw httpError(404, code);
        }, "proj_gone"),
      ).toBe("no-longer-available");
    },
  );

  it.each([
    ["another 404", httpError(404, "route_not_found")],
    ["a server error", httpError(500, null)],
    ["a forbidden response", httpError(403, "forbidden")],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("never treats %s as gone", async (_, error) => {
    expect(
      await classifyDraftProject(async () => {
        throw error;
      }, "proj_maybe"),
    ).toBe("couldnt-check");
  });
});
