import {
  PendingInteractionShell,
  type PendingInteractionSourceThread,
} from "./PendingInteractionShell";
import { useMemo, useState, type ReactNode } from "react";
import {
  buildPendingInteractionApprovalResolution,
  type PendingInteractionToolUseAsk,
} from "@cloudroom/core-ui";
import {
  isPluginPendingInteraction,
  type ApprovalPendingInteractionPayload,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type PendingInteractionApprovalSubject,
  type PendingInteractionResolution,
  type PendingInteractionUserQuestionQuestion,
} from "@cloudroom/domain";
import { Button } from "@cloudroom/shared-ui/button";
import { Icon } from "@cloudroom/shared-ui/icon";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { getDetailScrollMaxHeightClass } from "@/components/ui/detail-scroll-size.js";
import { UserQuestionAnswerForm } from "@/components/thread/user-questions/UserQuestionInteractionContent.js";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import {
  classifyInteractionRequest,
  type InteractionRequestView,
} from "./interaction-request";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  presentationIconName,
  presentationTintStyle,
} from "@/components/thread/timeline/presentation-display";
import { PluginCompactIconMask } from "@/components/plugin/PluginIcon";
import { usePluginIconUrl } from "@/lib/plugin-logos";
import { cn } from "@cloudroom/shared-ui/lib/utils";
import {
  buildApprovalCardView,
  orderApprovalDecisions,
  type ApprovalCardView,
  type ApprovalDecisionScope,
  type ApprovalPermissionList,
} from "./approval-card-view";

export type ApprovalCardLayout = "summary" | "decisions";

interface ThreadPendingInteractionBannerProps {
  interaction: PendingInteraction;
  sourceThread?: PendingInteractionSourceThread;
  threadId: string;
}

interface PendingInteractionBannerPreviewProps extends ThreadPendingInteractionBannerProps {
  approvalLayout: ApprovalCardLayout;
}

type ApprovalBannerSubject = Extract<
  InteractionRequestView,
  { family: "approval" }
>["subject"];

interface ApprovalPendingInteractionBannerProps {
  layout: ApprovalCardLayout;
  interaction: PendingInteraction;
  payload: ApprovalPendingInteractionPayload;
  subject: ApprovalBannerSubject;
  sourceThread?: PendingInteractionSourceThread;
  threadId: string;
}

interface UserQuestionPendingInteractionBannerProps {
  interaction: PendingInteraction;
  questions: readonly PendingInteractionUserQuestionQuestion[];
  sourceThread?: PendingInteractionSourceThread;
  threadId: string;
}

const COMMAND_PREVIEW_LINE_COUNT = 4;
const SUMMARY_PATH_LIMIT = 3;

interface UseApprovalDecisionSubmissionArgs {
  fallbackMessage: string;
  interaction: PendingInteraction;
  threadId: string;
}

interface ApprovalDecisionSubmission {
  errorMessage: string | null;
  loadingDecision: PendingInteractionApprovalDecision | null;
  sendingDecision: PendingInteractionApprovalDecision | null;
  isSending: boolean;
  submitDecision: (decision: PendingInteractionApprovalDecision) => void;
  submitDisabled: boolean;
}

export function ThreadPendingInteractionBanner(
  props: ThreadPendingInteractionBannerProps,
) {
  return (
    <PendingInteractionBanner
      key={props.interaction.id}
      {...props}
      approvalLayout="summary"
    />
  );
}

export function PendingInteractionBannerPreview(
  props: PendingInteractionBannerPreviewProps,
) {
  return <PendingInteractionBanner key={props.interaction.id} {...props} />;
}

function PendingInteractionBanner({
  approvalLayout,
  interaction,
  sourceThread,
  threadId,
}: PendingInteractionBannerPreviewProps) {
  const request = classifyInteractionRequest(interaction);
  if (request.family === "approval") {
    return (
      <ApprovalPendingInteractionBanner
        layout={approvalLayout}
        interaction={interaction}
        payload={request.payload}
        subject={request.subject}
        sourceThread={sourceThread}
        threadId={threadId}
      />
    );
  }
  switch (request.kind) {
    case "user_question":
      return (
        <ThreadUserQuestionPendingInteractionBanner
          interaction={interaction}
          questions={request.questions}
          sourceThread={sourceThread}
          threadId={threadId}
        />
      );
    case "plan_review":
      return (
        <PlanReviewRequestBanner
          interaction={interaction}
          request={request}
          sourceThread={sourceThread}
          threadId={threadId}
        />
      );
    default:
      return (
        <div
          data-testid="plugin-request-banner"
          data-request-kind={request.kind}
        >
          <PluginPendingInteractionComposer
            sourceThread={sourceThread}
            interaction={interaction}
            request={{
              pluginId: request.pluginId,
              rendererId: request.name,
              title: request.title,
              data: request.data,
            }}
            dismissal={
              isPluginPendingInteraction(interaction) ? "cancel" : "stop-turn"
            }
          />
        </div>
      );
  }
}

interface PlanReviewRequestBannerProps {
  interaction: PendingInteraction;
  request: Extract<InteractionRequestView, { kind: "plan_review" }>;
  sourceThread?: PendingInteractionSourceThread;
  threadId: string;
}

function useApprovalDecisionSubmission({
  fallbackMessage,
  interaction,
  threadId,
}: UseApprovalDecisionSubmissionArgs): ApprovalDecisionSubmission {
  const resolvePendingInteraction = useResolveThreadPendingInteraction();
  const isResolving = interaction.status === "resolving";
  const errorMessage = resolvePendingInteraction.error
    ? getMutationErrorMessage({
        error: resolvePendingInteraction.error,
        fallbackMessage,
        lifecycleOperation: "resolve_interaction",
      })
    : null;
  const submitDecision = (
    decision: PendingInteractionApprovalDecision,
  ): void => {
    const resolution = buildPendingInteractionApprovalResolution(
      interaction,
      decision,
    );
    void resolvePendingInteraction
      .mutateAsync({ threadId, interactionId: interaction.id, resolution })
      .catch(() => {});
  };
  const loadingDecision = isResolving
    ? approvalResolutionDecision(interaction.resolution)
    : null;
  const requestedDecision = resolvePendingInteraction.isPending
    ? approvalResolutionDecision(
        resolvePendingInteraction.variables?.resolution ?? null,
      )
    : null;
  return {
    errorMessage,
    loadingDecision,
    sendingDecision: loadingDecision ?? requestedDecision,
    isSending: resolvePendingInteraction.isPending || isResolving,
    submitDecision,
    submitDisabled: resolvePendingInteraction.isPending || isResolving,
  };
}

function PlanReviewRequestBanner({
  interaction,
  request,
  sourceThread,
  threadId,
}: PlanReviewRequestBannerProps) {
  const { errorMessage, loadingDecision, submitDecision, submitDisabled } =
    useApprovalDecisionSubmission({
      fallbackMessage: "Failed to resolve plan review",
      interaction,
      threadId,
    });
  const { approval } = request;
  const { plan, planFilePath } = request.review;
  return (
    <PendingInteractionShell
      label="Plan review"
      title={approval.reason ?? "Ready to code?"}
      initiallyExpanded={false}
      errorMessage={errorMessage}
      sourceThread={sourceThread}
      testId="plan-review-banner"
      footer={
        <ApprovalDecisionButtons
          decisions={approval.availableDecisions}
          disabled={submitDisabled}
          loadingDecision={loadingDecision}
          onDecide={submitDecision}
          subjectKind="plan"
        />
      }
    >
      {() => (
        <div
          className="overflow-hidden rounded-lg border border-border bg-card"
          data-testid="plan-review-request"
        >
          <div
            className={cn(
              getDetailScrollMaxHeightClass("base"),
              "overflow-auto px-3 py-2",
            )}
          >
            <MarkdownPreview content={plan} className="text-xs" />
          </div>
          {planFilePath ? (
            <p className="truncate border-t border-border px-3 py-2 font-mono text-xs text-muted-foreground">
              {planFilePath}
            </p>
          ) : null}
        </div>
      )}
    </PendingInteractionShell>
  );
}

function ApprovalPendingInteractionBanner({
  layout,
  interaction,
  payload,
  subject,
  sourceThread,
  threadId,
}: ApprovalPendingInteractionBannerProps) {
  const submission = useApprovalDecisionSubmission({
    fallbackMessage: "Failed to resolve pending interaction",
    interaction,
    threadId,
  });
  const view = useMemo(
    () => buildApprovalCardView(interaction, payload, subject),
    [interaction, payload, subject],
  );
  const decide = {
    disabled: submission.submitDisabled,
    loadingDecision: submission.loadingDecision,
    onDecide: submission.submitDecision,
    subjectKind: subject.kind,
  };

  return (
    <PendingInteractionShell
      label="Approval needed"
      initiallyExpanded={false}
      errorMessage={submission.errorMessage}
      sourceThread={sourceThread}
      testId="approval-banner"
      status={
        <ApprovalWaitingState
          hasError={submission.errorMessage !== null}
          isSending={submission.isSending}
          sendingDecision={submission.sendingDecision}
          subjectKind={subject.kind}
        />
      }
      summary={
        <div data-approval-layout={layout} data-testid="approval-summary">
          <ApprovalHeadline view={view} />
          {layout === "summary" ? (
            <>
              <ApprovalScopeSummary view={view} />
              <p className="mt-2 text-xs text-subtle-foreground">
                {payload.availableDecisions.includes("allow_once")
                  ? "Allow once applies to this request. "
                  : ""}
                {payload.availableDecisions.includes("allow_for_session")
                  ? "Allow for session applies for the rest of the session."
                  : ""}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ApprovalDecisionButtons
                  decisions={payload.availableDecisions}
                  {...decide}
                />
              </div>
            </>
          ) : (
            <>
              {view.requested ? (
                <div className="mt-2">
                  <PermissionListSection
                    heading="Requested access"
                    list={view.requested}
                    limit={SUMMARY_PATH_LIMIT}
                  />
                </div>
              ) : null}
              <ApprovalDecisionRows view={view} {...decide} />
            </>
          )}
        </div>
      }
    >
      {() => <ApprovalDetails view={view} />}
    </PendingInteractionShell>
  );
}

function ApprovalWaitingState({
  hasError,
  isSending,
  sendingDecision,
  subjectKind,
}: {
  hasError: boolean;
  isSending: boolean;
  sendingDecision: PendingInteractionApprovalDecision | null;
  subjectKind: PendingInteractionApprovalSubject["kind"];
}) {
  const text = isSending
    ? "Sending…"
    : hasError
      ? "Not sent"
      : "Waiting for you";
  return (
    <span
      role="status"
      data-testid="approval-waiting-state"
      title={
        sendingDecision
          ? `Sending ${labelForApprovalDecision(sendingDecision, subjectKind)}`
          : undefined
      }
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs",
        hasError && !isSending
          ? "text-destructive-text"
          : "text-subtle-foreground",
      )}
    >
      {isSending ? (
        <Icon name="Spinner" className="size-3 animate-spin" />
      ) : null}
      {text}
    </span>
  );
}

function ApprovalHeadline({ view }: { view: ApprovalCardView }) {
  return (
    <div className="min-w-0">
      <p
        className="whitespace-pre-wrap text-sm font-medium text-foreground [overflow-wrap:anywhere]"
        data-testid="approval-title"
      >
        {view.title}
      </p>
      <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-xs font-medium text-foreground">
          {view.action}
        </span>
        {view.target !== null ? (
          <span
            title={view.target}
            data-testid="approval-target"
            className={cn(
              "min-w-0 truncate",
              view.targetIsCode
                ? "rounded bg-card px-1 font-mono text-foreground"
                : "text-muted-foreground",
            )}
          >
            {view.target}
          </span>
        ) : null}
      </div>
      {view.toolUse?.detail ? (
        <MarkdownPreview
          content={view.toolUse.detail}
          className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]"
          imagePolicy="alt-text"
        />
      ) : null}
      {view.location !== null ? (
        <p
          title={view.location}
          className="mt-0.5 truncate font-mono text-subtle-foreground"
        >
          in {view.location}
        </p>
      ) : null}
    </div>
  );
}

function ApprovalScopeSummary({ view }: { view: ApprovalCardView }) {
  const offersSession = view.decisions.some(
    (scope) => scope.decision === "allow_for_session",
  );
  const sessionGrant = offersSession ? view.sessionGrant : null;
  if (view.requested === null && sessionGrant === null) {
    return null;
  }
  return (
    <div
      className="mt-2 rounded-md border border-border bg-card px-2.5 py-2"
      data-testid="approval-scope"
    >
      {view.requested !== null ? (
        <PermissionListSection
          heading="Requested access"
          list={view.requested}
          limit={SUMMARY_PATH_LIMIT}
        />
      ) : null}
      {sessionGrant !== null ? (
        <PermissionListSection
          heading="Allow for session also grants"
          list={sessionGrant}
          limit={SUMMARY_PATH_LIMIT}
        />
      ) : null}
    </div>
  );
}

function ApprovalDecisionRows({
  view,
  disabled,
  loadingDecision,
  onDecide,
  subjectKind,
}: {
  view: ApprovalCardView;
  disabled: boolean;
  loadingDecision: PendingInteractionApprovalDecision | null;
  onDecide: (decision: PendingInteractionApprovalDecision) => void;
  subjectKind: PendingInteractionApprovalSubject["kind"];
}) {
  const rows = [...view.decisions].reverse();
  return (
    <ul
      className="mt-3 divide-y divide-border-hairline overflow-hidden rounded-md border border-border bg-card"
      data-testid="approval-decision-rows"
    >
      {rows.map((scope) => (
        <li
          key={scope.decision}
          className="flex flex-col gap-2 px-2.5 py-2 @md:flex-row @md:items-start"
        >
          <ApprovalDecisionButton
            decision={scope.decision}
            disabled={disabled}
            isLoading={loadingDecision === scope.decision}
            onClick={() => onDecide(scope.decision)}
            subjectKind={subjectKind}
            className="w-full shrink-0 @md:w-36"
          />
          <DecisionScopeCaption scope={scope} />
        </li>
      ))}
    </ul>
  );
}

function DecisionScopeCaption({ scope }: { scope: ApprovalDecisionScope }) {
  const text =
    scope.duration === "none"
      ? "Nothing is granted. The agent is told you declined."
      : scope.duration === "request"
        ? scope.grants
          ? "Grants this access for this request only:"
          : "This request only. No extra access is granted."
        : scope.grants
          ? "Grants this access for the rest of the session:"
          : "Approves for the rest of the session. No extra access is listed.";
  return (
    <div className="min-w-0 flex-1 self-center text-xs text-muted-foreground">
      <p>{text}</p>
      {scope.grants ? (
        <PermissionListSection
          list={scope.grants}
          limit={SUMMARY_PATH_LIMIT}
          className="mt-1"
        />
      ) : null}
    </div>
  );
}

function PermissionListSection({
  className,
  heading,
  limit,
  list,
}: {
  className?: string;
  heading?: string;
  limit?: number;
  list: ApprovalPermissionList;
}) {
  return (
    <div className={cn("min-w-0 [&+&]:mt-2", className)}>
      {heading ? (
        <p className="mb-1 text-xs font-medium text-foreground">{heading}</p>
      ) : null}
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
        {list.network ? (
          <>
            <dt className="text-subtle-foreground">Network</dt>
            <dd className="text-foreground">Network access</dd>
          </>
        ) : null}
        <PathRows label="Read" paths={list.read} limit={limit} />
        <PathRows label="Write" paths={list.write} limit={limit} />
      </dl>
    </div>
  );
}

function PathRows({
  label,
  limit,
  paths,
}: {
  label: string;
  limit?: number;
  paths: readonly string[];
}) {
  if (paths.length === 0) {
    return null;
  }
  const shown = limit === undefined ? paths : paths.slice(0, limit);
  const hidden = paths.length - shown.length;
  return (
    <>
      <dt className="text-subtle-foreground">{label}</dt>
      <dd className="min-w-0">
        <ul>
          {shown.map((path) => (
            <li
              key={path}
              className="font-mono text-foreground [overflow-wrap:anywhere]"
            >
              {path}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="text-subtle-foreground">
              +{hidden} more in details
            </li>
          ) : null}
        </ul>
      </dd>
    </>
  );
}

function ApprovalDetails({ view }: { view: ApprovalCardView }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="approval-details">
      {view.command ? (
        <>
          <DetailSection heading="Command">
            <CommandPreview command={view.command.formatted} />
          </DetailSection>
          <DetailSection heading="Exact command as sent">
            <pre
              data-testid="approval-raw-command"
              className={cn(
                getDetailScrollMaxHeightClass("base"),
                "overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground [overflow-wrap:anywhere]",
              )}
            >
              {view.command.raw}
            </pre>
          </DetailSection>
          {view.command.cwd !== null ? (
            <DetailSection heading="Working directory">
              <p className="font-mono text-foreground [overflow-wrap:anywhere]">
                {view.command.cwd}
              </p>
            </DetailSection>
          ) : null}
          {view.command.actions.length > 0 ? (
            <DetailSection heading="Actions">
              <ul className="font-mono text-foreground [overflow-wrap:anywhere]">
                {view.command.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </DetailSection>
          ) : null}
        </>
      ) : null}
      {view.toolUse ? <ToolUseAskCard ask={view.toolUse} /> : null}
      {view.tool !== null && view.toolUse === null ? (
        <DetailSection heading="Tool">
          <p className="font-mono text-foreground">{view.tool}</p>
        </DetailSection>
      ) : null}
      {view.target !== null && view.command === null && view.tool === null ? (
        <DetailSection heading="Write root">
          <p className="font-mono text-foreground [overflow-wrap:anywhere]">
            {view.target}
          </p>
        </DetailSection>
      ) : null}
      {view.requested !== null ? (
        <DetailSection heading="Requested access">
          <PermissionListSection list={view.requested} />
        </DetailSection>
      ) : null}
      {view.sessionGrant !== null ? (
        <DetailSection heading="Session grant">
          <PermissionListSection list={view.sessionGrant} />
        </DetailSection>
      ) : null}
      <DetailSection heading="Decisions offered">
        <ul className="text-foreground">
          {view.decisions.map((scope) => (
            <li key={scope.decision} className="font-mono">
              {scope.decision}
            </li>
          ))}
        </ul>
      </DetailSection>
      <DetailSection heading="Item">
        <p className="font-mono text-foreground [overflow-wrap:anywhere]">
          {view.itemId}
        </p>
      </DetailSection>
    </div>
  );
}

function DetailSection({
  children,
  heading,
}: {
  children: ReactNode;
  heading: string;
}) {
  return (
    <section className="min-w-0 text-xs">
      <h4 className="mb-1 text-xs font-medium text-subtle-foreground">
        {heading}
      </h4>
      {children}
    </section>
  );
}

function ThreadUserQuestionPendingInteractionBanner({
  interaction,
  questions,
  sourceThread,
  threadId,
}: UserQuestionPendingInteractionBannerProps) {
  const isResolving = interaction.status === "resolving";

  return (
    <PendingInteractionShell
      label={
        questions.length === 1 ? "Question" : `${questions.length} questions`
      }
      initiallyExpanded
      sourceThread={sourceThread}
      testId="user-question-banner"
    >
      {() => (
        <UserQuestionAnswerForm
          interactionId={interaction.id}
          isResolving={isResolving}
          questions={questions}
          threadId={threadId}
        />
      )}
    </PendingInteractionShell>
  );
}

interface ApprovalDecisionButtonsProps {
  decisions: readonly PendingInteractionApprovalDecision[];
  disabled: boolean;
  loadingDecision: PendingInteractionApprovalDecision | null;
  onDecide: (decision: PendingInteractionApprovalDecision) => void;
  subjectKind: PendingInteractionApprovalSubject["kind"];
}

function ApprovalDecisionButtons({
  decisions,
  disabled,
  loadingDecision,
  onDecide,
  subjectKind,
}: ApprovalDecisionButtonsProps) {
  const denyFirst = orderApprovalDecisions(decisions);
  return denyFirst.map((decision, index) => (
    <ApprovalDecisionButton
      key={decision}
      decision={decision}
      disabled={disabled}
      isLoading={loadingDecision === decision}
      onClick={() => onDecide(decision)}
      subjectKind={subjectKind}
      className={index === 0 && decision === "deny" ? "mr-auto" : undefined}
    />
  ));
}

interface ApprovalDecisionButtonProps {
  className?: string;
  decision: PendingInteractionApprovalDecision;
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
  subjectKind: PendingInteractionApprovalSubject["kind"];
}

function ApprovalDecisionButton({
  className,
  decision,
  disabled,
  isLoading,
  onClick,
  subjectKind,
}: ApprovalDecisionButtonProps) {
  const label = labelForApprovalDecision(decision, subjectKind);
  const spinner = isLoading ? (
    <Icon name="Spinner" className="size-3 animate-spin" />
  ) : null;
  return (
    <Button
      type="button"
      size="sm"
      variant={approvalDecisionButtonVariant(decision)}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {spinner}
      {label}
    </Button>
  );
}

function approvalDecisionButtonVariant(
  decision: PendingInteractionApprovalDecision,
): "default" | "outline" | "ghost" {
  switch (decision) {
    case "allow_once":
      return "default";
    case "allow_for_session":
      return "outline";
    case "deny":
      return "ghost";
  }
}

function approvalResolutionDecision(
  resolution: PendingInteractionResolution | null,
): PendingInteractionApprovalDecision | null {
  if (!resolution || "kind" in resolution) {
    return null;
  }
  return resolution.decision;
}

function ToolUseAskCard({ ask }: { ask: PendingInteractionToolUseAsk }) {
  const iconUrl = usePluginIconUrl(ask.icon.glyph);
  return (
    <div
      className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card px-3 py-2"
      data-testid="tool-use-ask"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-foreground">
        {iconUrl !== undefined ? (
          <PluginCompactIconMask
            url={iconUrl}
            className="size-3.5"
            style={presentationTintStyle(ask)}
          />
        ) : (
          <Icon
            name={presentationIconName(ask) ?? "Terminal"}
            fallback="Terminal"
            className="size-3.5 shrink-0"
            style={presentationTintStyle(ask)}
          />
        )}
        <span className="min-w-0 truncate font-mono">
          {ask.headline ?? ask.tool}
        </span>
      </div>
      {ask.headline !== null ? (
        <p className="mt-1 text-xs text-muted-foreground">Tool: {ask.tool}</p>
      ) : null}
      {ask.detail !== null ? (
        <MarkdownPreview
          content={ask.detail}
          className="mt-1 text-xs text-muted-foreground"
          imagePolicy="alt-text"
        />
      ) : null}
    </div>
  );
}

function CommandPreview({ command }: { command: string }) {
  const [showsAllLines, setShowsAllLines] = useState(false);
  const lines = command.split("\n");
  const hiddenLineCount = Math.max(
    0,
    lines.length - COMMAND_PREVIEW_LINE_COUNT,
  );
  const visibleCommand =
    showsAllLines || hiddenLineCount === 0
      ? command
      : lines.slice(0, COMMAND_PREVIEW_LINE_COUNT).join("\n");
  return (
    <div
      className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card"
      data-testid="command-preview"
    >
      <pre
        className={cn(
          getDetailScrollMaxHeightClass("base"),
          "max-w-full overflow-auto whitespace-pre px-3 py-2 font-mono text-xs leading-relaxed text-foreground",
        )}
      >
        $ {visibleCommand}
      </pre>
      {hiddenLineCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowsAllLines((value) => !value)}
          className="block w-full border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          {showsAllLines
            ? "Show less"
            : hiddenLineCount === 1
              ? "Show 1 more line"
              : `Show ${hiddenLineCount} more lines`}
        </button>
      ) : null}
    </div>
  );
}

function labelForApprovalDecision(
  decision: PendingInteractionApprovalDecision,
  subjectKind: PendingInteractionApprovalSubject["kind"],
): string {
  if (subjectKind === "plan") {
    return decision === "deny" ? "Keep planning" : "Approve plan";
  }
  switch (decision) {
    case "allow_once":
      return "Allow once";
    case "allow_for_session":
      return "Allow for session";
    case "deny":
      return "Deny";
  }
}
