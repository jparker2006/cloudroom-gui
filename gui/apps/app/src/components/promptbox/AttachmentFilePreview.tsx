import { useEffect, useState } from "react";
import {
  FilePreview,
  type FilePreviewState,
} from "@/components/secondary-panel/FilePreview";

export default function AttachmentFilePreview({
  name,
  url,
}: {
  name: string;
  url: string;
}) {
  const [state, setState] = useState<FilePreviewState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Couldn't load this attachment preview. It is still attached.",
          );
        const contents = await response.text();
        if (controller.signal.aborted) return;
        setState(
          contents.length === 0
            ? { kind: "empty" }
            : {
                kind: "ready",
                file: { name, contents },
                lineRange: null,
                textPreviewKind: /\.(md|markdown)$/i.test(name)
                  ? "markdown"
                  : /\.csv$/i.test(name)
                    ? "csv"
                    : null,
              },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            kind: "error",
            message:
              "Couldn't load this attachment preview. It is still attached.",
          });
      });
    return () => controller.abort();
  }, [name, url]);

  return (
    <div
      className="h-full"
      role={state.kind === "error" ? "status" : undefined}
    >
      <FilePreview state={state} path={name} headerMode="none" />
    </div>
  );
}
