import type { NavigateFunction } from "react-router-dom";
import { ThreadHelpButton } from "@/components/thread-help/ThreadHelp";
import {
  THREAD_HELP_HASH,
  type ThreadHelpTopicId,
} from "@/components/thread-help/thread-help-topics";
import { useRouteState } from "@/hooks/useRouteState";
import {
  getThreadRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { usePaneContext } from "./PaneContext";

export function ThreadHeaderHelpButton({
  threadId,
  relevantTopicIds,
}: {
  threadId: string;
  relevantTopicIds: readonly ThreadHelpTopicId[];
}) {
  const { isFocused } = usePaneContext();
  const route = useRouteState();
  return (
    <ThreadHelpButton
      label="Thread help"
      variant="header"
      className="max-md:hidden"
      listenToHash={isFocused && route.threadId === threadId}
      relevantTopicIds={relevantTopicIds}
    />
  );
}

export function threadHelpMenuAction(
  navigate: NavigateFunction,
  thread: ThreadRoutePathArgs,
) {
  return {
    icon: "CircleQuestion" as const,
    label: "Help",
    onSelect: () => {
      const pathname = getThreadRoutePath(thread);
      const current = window.location.pathname;
      void navigate(
        current === pathname || current.startsWith(`${pathname}/`)
          ? { search: window.location.search, hash: THREAD_HELP_HASH }
          : { pathname, hash: THREAD_HELP_HASH },
      );
    },
  };
}
