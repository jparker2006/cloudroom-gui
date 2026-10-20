import { BbHttpError } from "@cloudroom/sdk/browser";

export type DraftProjectLookup = "not-in-list" | "no-longer-available" | "couldnt-check";

const NO_LONGER_AVAILABLE_CODES = new Set(["project_not_found", "project_unavailable"]);

export async function classifyDraftProject(
  getProject: (projectId: string) => Promise<unknown>,
  projectId: string,
): Promise<DraftProjectLookup> {
  try {
    await getProject(projectId);
    return "not-in-list";
  } catch (error) {
    return error instanceof BbHttpError &&
      error.status === 404 &&
      error.code !== null &&
      NO_LONGER_AVAILABLE_CODES.has(error.code)
      ? "no-longer-available"
      : "couldnt-check";
  }
}
