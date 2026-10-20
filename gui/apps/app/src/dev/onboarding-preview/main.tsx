import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@cloudroom/shared-ui/button";
import { Icon } from "@cloudroom/shared-ui/icon";
import { PersistentResponsiveDrawerShell } from "@cloudroom/shared-ui/responsive-overlay";
import { BbLogo } from "@/components/ui/bb-logo";
import {
  activeStep,
  isVerified,
  makeFixture,
  models,
  providerName,
  receiptFor,
  restoreFixture,
  scenarios,
  transition,
  type Action,
  type Scenario,
  type SetupFixture,
} from "./fixtures";
import "@/components/ui/theme.css";
import "./preview.css";

const steps = ["Sign in", "Connect provider", "Choose project", "Verify cloud"];
const descriptions = [
  "Your Cloudroom identity",
  "Your agent and billing mode",
  "A repository, or no project",
  "A tiny task with your model",
];
const params = new URLSearchParams(window.location.search);
const option = params.get("option") === "b" ? "b" : "a";
const requestedScenario = params.get("state");
const initialScenario: Scenario =
  requestedScenario && Object.hasOwn(scenarios, requestedScenario)
    ? (requestedScenario as Scenario)
    : "identity";
const storageKey = `cloudroom.onboarding-design.v1.${option}`;

function loadInitial() {
  if (params.has("state")) return makeFixture(initialScenario);
  try {
    return restoreFixture(localStorage.getItem(storageKey)) ?? makeFixture();
  } catch {
    return makeFixture();
  }
}

function Preview() {
  const [state, setState] = useState(loadInitial);
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [details, setDetails] = useState(false);
  const [left, setLeft] = useState(false);
  const [composer, setComposer] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [help, setHelp] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const step = activeStep(state);
  const verified = isVerified(state);
  const hasSession = step === 3 && state.phase !== "verification-consent";
  const dispatch = (action: Action) =>
    setState((current) => transition(current, action));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("state")) {
      url.searchParams.delete("state");
      window.history.replaceState(null, "", url);
    }
  }, [state]);
  useEffect(() => {
    if (details) detailsHeading.current?.focus();
    else heading.current?.focus();
  }, [state.phase, left, composer, details]);

  function selectScenario(value: Scenario) {
    setScenario(value);
    setState(makeFixture(value));
    setLeft(false);
    setComposer(false);
    const url = new URL(window.location.href);
    url.searchParams.set("state", value);
    window.history.replaceState(null, "", url);
  }

  const copy = stageCopy(state);
  const content = (
    <StageContent
      state={state}
      dispatch={dispatch}
      openDetails={() => setDetails(true)}
      openComposer={() => setComposer(true)}
    />
  );

  return (
    <>
      <div className="preview-toolbar">
        <span className="fixture-tag">
          <span /> INTERACTIVE FIXTURE
        </span>
        <nav aria-label="Design option">
          <a
            href="?option=a"
            aria-current={option === "a" ? "page" : undefined}
          >
            A · Selected focused steps
          </a>
          <a
            href="?option=b"
            aria-current={option === "b" ? "page" : undefined}
          >
            B · Earlier comparison
          </a>
        </nav>
        <label className="scenario-label">
          Scenario
          <select
            aria-label="Fixture scenario"
            value={scenario}
            onChange={(event) => selectScenario(event.target.value as Scenario)}
          >
            {Object.entries(scenarios).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fixture-notice">
        Design prototype. All accounts, progress, approvals, and execution
        results are simulated. No external actions.
      </div>
      {storageFailed && (
        <div role="alert" className="fixture-notice">
          Browser storage is unavailable. This preview keeps progress only while
          this tab stays open.
        </div>
      )}
      <div className={`setup-preview option-${option}`}>
        <header className="brand-header">
          <a className="brand" href={`?option=${option}`}>
            <BbLogo className="size-8" />
            <span>
              cloudroom<span className="brand-dot">®</span>
            </span>
          </a>
          <span className="header-context">
            <Icon name="Cloud" /> Cloud setup
          </span>
          {!left && !composer && (
            <Button variant="ghost" onClick={() => setLeft(true)}>
              {storageFailed ? "Leave setup" : "Save & leave"} <Icon name="X" />
            </Button>
          )}
        </header>

        {left ? (
          <main className="standalone-panel">
            <span className="large-symbol">
              <Icon name="Check" />
            </span>
            <p className="eyebrow">
              {storageFailed
                ? "PROGRESS KEPT IN THIS TAB ONLY"
                : "PROGRESS SAVED IN THIS BROWSER"}
            </p>
            <h1 ref={heading} tabIndex={-1}>
              {storageFailed
                ? "Keep this tab to keep your place."
                : "Pick up where you left off."}
            </h1>
            <p>
              {storageFailed
                ? "Browser storage is unavailable. Closing or reloading can lose recent choices or restore older progress. Keep this tab open to continue from your current place."
                : "Your choices and current operation are saved. Reopening checks the existing operation before starting another."}
            </p>
            <Button
              onClick={() => {
                setState(
                  (current) =>
                    restoreFixture(JSON.stringify(current)) ?? current,
                );
                setLeft(false);
              }}
            >
              {storageFailed ? "Return to setup" : "Resume setup"}{" "}
              <Icon name="ArrowRight" />
            </Button>
            <small>
              Fixture persistence only. Production recovery still needs
              integration.
            </small>
          </main>
        ) : composer && verified ? (
          <main className="standalone-panel composer-preview">
            <span className="status-label good">
              <Icon name="Check" /> Cloud execution verified · fixture
            </span>
            <h1 ref={heading} tabIndex={-1}>
              What would you like to build?
            </h1>
            <p>
              {providerName(state.provider)} · {state.model} · {state.project}
            </p>
            <label htmlFor="fixture-prompt" className="sr-only">
              Your first message
            </label>
            <textarea
              id="fixture-prompt"
              placeholder="Ask your agent anything…"
            />
            <div className="composer-bottom">
              <span>
                <Icon name="Cloud" /> Cloud · Read-only check passed
              </span>
              <Button
                disabled
                aria-label="Sending is unavailable in the prototype"
              >
                <Icon name="ArrowUp" />
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setComposer(false)}>
              Back to verified setup
            </Button>
            <small>Composer preview. Sending is disabled.</small>
          </main>
        ) : (
          <>
            <div className="setup-layout">
              {option === "a" && (
                <aside className="setup-rail">
                  <p className="eyebrow">A LITTLE SETUP. A LOT POSSIBLE.</p>
                  <h2>
                    Your next idea
                    <br />
                    starts here.
                  </h2>
                  <p>
                    Connect your agent.
                    <br />
                    We’ll take it from there.
                  </p>
                  <StepList state={state} />
                  <div className="rail-bottom">
                    <Icon name="Lock" />
                    <span>
                      Your account. Your permissions.
                      <br />
                      You stay in control.
                    </span>
                  </div>
                </aside>
              )}
              <main className="wizard-main">
                {option === "a" ? (
                  <>
                    <div className="section-caption">
                      <span>GET STARTED IN THE CLOUD</span>
                      <span>0{step + 1} / 04</span>
                    </div>
                    <div
                      className="step-progress"
                      aria-label={`Step ${step + 1} of 4`}
                    >
                      {steps.map((title, index) => (
                        <span
                          key={title}
                          className={index <= step ? "filled" : ""}
                        />
                      ))}
                    </div>
                    <section
                      className="focused-stage"
                      aria-labelledby="stage-heading"
                    >
                      <StageHeading state={state} headingRef={heading} />
                      <div className="stage-body">{content}</div>
                    </section>
                    <div className="session-strip">
                      <span
                        className={`session-dot ${verified ? "complete" : ""}`}
                      />
                      <div>
                        <strong>
                          {hasSession ? "Cloud setup session" : "Setup details"}
                        </strong>
                        <span>
                          {hasSession
                            ? "Progress, approvals, and recovery in one place"
                            : "Sign-in happens here before a cloud session exists"}
                        </span>
                      </div>
                      <Button variant="ghost" onClick={() => setDetails(true)}>
                        View details <Icon name="ArrowRight" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="checklist-intro">
                      <p className="eyebrow">YOUR CLOUD WORKSPACE</p>
                      <h1 ref={heading} tabIndex={-1}>
                        {verified
                          ? "Ready for your next idea."
                          : "Let’s get you ready."}
                      </h1>
                      <p>Four clear steps. Your progress stays with you.</p>
                    </div>
                    <div className="checklist-grid">
                      <div className="checklist">
                        {steps.map((title, index) => (
                          <section
                            key={title}
                            className={`checklist-item ${step === index ? "active" : ""}`}
                            aria-label={title}
                          >
                            <div className="checklist-title">
                              <StepNumber
                                index={index}
                                step={step}
                                verified={verified}
                              />
                              <div>
                                <h2>{title}</h2>
                                <p>
                                  {index < step || verified
                                    ? completedSummary(index, state)
                                    : descriptions[index]}
                                </p>
                              </div>
                              <span className="row-state">
                                {index < step || verified
                                  ? "Complete"
                                  : index === step
                                    ? "Current step"
                                    : "Up next"}
                              </span>
                            </div>
                            {index === step && (
                              <div className="checklist-content">
                                <h3 id="stage-heading">{copy.title}</h3>
                                <p className="stage-description">
                                  {copy.description}
                                </p>
                                {content}
                              </div>
                            )}
                          </section>
                        ))}
                      </div>
                      <aside className="setup-summary">
                        <div className="summary-cloud">
                          <Icon name="Cloud" />
                        </div>
                        <p className="eyebrow">YOUR SETUP</p>
                        <h2>
                          A space to
                          <br />
                          make things.
                        </h2>
                        <dl>
                          <div>
                            <dt>Agent</dt>
                            <dd>
                              {step > 0
                                ? providerName(state.provider)
                                : "Choose next"}
                            </dd>
                          </div>
                          <div>
                            <dt>Model</dt>
                            <dd>{step > 0 ? state.model : "Choose next"}</dd>
                          </div>
                          <div>
                            <dt>Project</dt>
                            <dd>
                              {step > 2
                                ? state.project
                                : "Choose after connecting"}
                            </dd>
                          </div>
                          <div>
                            <dt>Billing mode</dt>
                            <dd>Unknown</dd>
                          </div>
                        </dl>
                        <p className="summary-note">
                          We won’t switch to API billing if your provider
                          connection fails.
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => setDetails(true)}
                        >
                          View details <Icon name="ArrowUpRight" />
                        </Button>
                        <small>
                          {hasSession
                            ? "Fixture cloud setup session"
                            : "No cloud session exists yet"}
                        </small>
                      </aside>
                    </div>
                  </>
                )}
                <footer className="wizard-footer">
                  <span>
                    <Icon name="Lock" /> Secure connection. Explicit
                    permissions.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setHelp(true);
                      setAdvanced(false);
                      setDetails(true);
                    }}
                  >
                    Installation & update help
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHelp(false);
                      setAdvanced(true);
                      setDetails(true);
                    }}
                  >
                    Advanced: agent-driven setup <Icon name="ArrowUpRight" />
                  </button>
                </footer>
              </main>
            </div>
          </>
        )}
        {!left && !composer && (
          <div className="mobile-session-bar">
            <div>
              <strong>
                {verified
                  ? "Cloud execution verified"
                  : hasSession
                    ? "Cloud setup session"
                    : "Setup details"}
              </strong>
              <span>
                {hasSession
                  ? "Progress, approvals & recovery"
                  : "No cloud session exists yet"}
              </span>
            </div>
            <Button variant="outline" onClick={() => setDetails(true)}>
              View details <Icon name="ArrowUpRight" />
            </Button>
          </div>
        )}
        <div className="preview-bottom">
          <span>
            OPTION {option.toUpperCase()} /{" "}
            {option === "a" ? "FOCUSED STEPS" : "SETUP CHECKLIST"}
          </span>
          <span>Dedicated wizard · Cloudroom</span>
        </div>
      </div>
      <PersistentResponsiveDrawerShell
        open={details}
        onOpenChange={(open) => {
          setDetails(open);
          if (!open) {
            setAdvanced(false);
            setHelp(false);
          }
        }}
        srLabel={
          help
            ? "Installation and update help"
            : advanced
              ? "Advanced setup preview"
              : "Setup session details"
        }
        contentClassName="setup-details-drawer"
        onAfterCloseAutoFocus={() => heading.current?.focus()}
      >
        <div className="details-header">
          <div>
            <p className="eyebrow">
              {hasSession
                ? "CLOUD SETUP SESSION · FIXTURE"
                : "LOCAL BOOTSTRAP · FIXTURE"}
            </p>
            <h2 ref={detailsHeading} tabIndex={-1}>
              {help
                ? "Installation & updates"
                : advanced
                  ? "Agent-driven setup"
                  : "Behind the setup"}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close details"
            onClick={() => {
              setDetails(false);
              setAdvanced(false);
              setHelp(false);
            }}
          >
            <Icon name="X" />
          </Button>
        </div>
        <div className="details-body">
          <div className="details-fixture">
            Simulated session viewer. Production must link the actual setup
            thread and its existing interaction controls.
          </div>
          {help ? (
            <InstallationHelp />
          ) : advanced ? (
            <>
              <h3>Use the setup session directly</h3>
              <p>
                The guided wizard keeps your current choices. The advanced path
                would open the same real setup thread once it exists.
              </p>
              <p>
                Before sign-in and account handoff complete, a cloud agent
                cannot perform your initial login.
              </p>
              <Button variant="outline" onClick={() => setAdvanced(false)}>
                Return to setup details
              </Button>
            </>
          ) : (
            <>
              <div className="details-status">
                <span className="session-dot" />
                <strong>
                  {scenarios[state.phase as Scenario] ??
                    "Waiting for authorization"}
                </strong>
                <span>Attempt {state.attempt}</span>
              </div>
              {hasSession ? (
                <>
                  <p className="muted">
                    Operation <code>{state.operationId}</code> · selected model{" "}
                    <code>{state.model}</code>
                  </p>
                  <ol className="event-log">
                    <li>
                      <span>01</span>
                      <div>
                        <b>Cloud account handoff confirmed</b>
                        <p>
                          Identity authorized before this session was created.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <b>Provider connected</b>
                        <p>
                          {providerName(state.provider)}. Billing mode unknown;
                          no API fallback.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <b>
                          {state.project === "No project"
                            ? "No-project workspace prepared"
                            : "Repository workspace prepared"}
                        </b>
                        <p>
                          {state.project === "No project"
                            ? "No repository permissions requested."
                            : "Fixture grant for example/cloud-notes only."}
                        </p>
                      </div>
                    </li>
                    <li className="current-event">
                      <span>04</span>
                      <div>
                        <b>{stageCopy(state).title}</b>
                        <p>{stageCopy(state).description}</p>
                      </div>
                    </li>
                  </ol>
                  <div className="task-spec">
                    <p className="eyebrow">TINY READ-ONLY VERIFICATION</p>
                    <p>Do not change files or settings. Reply exactly:</p>
                    <code>CLOUDROOM_SETUP_OK</code>
                    <p>
                      Success requires a completed run from {state.model}, tied
                      to this operation.
                    </p>
                  </div>
                  {state.phase === "approval" && (
                    <div className="approval-inline">
                      <h3>Allow one read-only command?</h3>
                      <code>pwd</code>
                      <p>
                        Scope: this setup session. No file changes or network
                        access.
                      </p>
                      <div className="actions">
                        <Button onClick={() => dispatch({ type: "approve" })}>
                          1. Allow once
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => dispatch({ type: "cancel" })}
                        >
                          2. Deny & pause
                        </Button>
                      </div>
                    </div>
                  )}
                  {["failed", "resumed", "cancelled"].includes(state.phase) && (
                    <>
                      <p>
                        Check the saved operation before retrying. An unknown
                        result never triggers a second launch.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          dispatch({
                            type: "reconcile",
                            outcome:
                              state.phase === "resumed" ? "running" : "failed",
                          })
                        }
                      >
                        1. Check cloud status
                      </Button>
                    </>
                  )}
                  {verified && (
                    <div className="execution-receipt">
                      <Icon name="Check" />
                      <div>
                        <b>Completed execution receipt · fixture</b>
                        <p>
                          {state.receipt?.result} · {state.model} ·{" "}
                          {state.operationId}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="task-spec">
                  <Icon name="Lock" />
                  <h3>No cloud session exists yet.</h3>
                  <p>
                    First, the app opens secure browser sign-in and receives an
                    authenticated account handoff. Provider connection and
                    project choice follow. The setup thread is created after
                    that.
                  </p>
                  <p>
                    These initial steps run in the app and browser. They are not
                    happening inside a pre-existing cloud session.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </PersistentResponsiveDrawerShell>
    </>
  );
}

function StepNumber({
  index,
  step,
  verified,
}: {
  index: number;
  step: number;
  verified: boolean;
}) {
  return (
    <span
      className={`step-number ${index < step || verified ? "done" : index === step ? "current" : ""}`}
    >
      {index < step || verified ? <Icon name="Check" /> : `0${index + 1}`}
    </span>
  );
}

function StepList({ state }: { state: SetupFixture }) {
  const step = activeStep(state);
  return (
    <ol className="rail-steps">
      {steps.map((title, index) => (
        <li key={title} aria-current={index === step ? "step" : undefined}>
          <StepNumber index={index} step={step} verified={isVerified(state)} />
          <div>
            <strong>{title}</strong>
            <span>
              {index < step || isVerified(state)
                ? completedSummary(index, state)
                : descriptions[index]}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function completedSummary(index: number, state: SetupFixture) {
  return [
    "GitHub identity confirmed",
    `${providerName(state.provider)} connected`,
    state.project,
    "Cloud execution verified",
  ][index];
}

function stageCopy(state: SetupFixture) {
  switch (state.phase) {
    case "identity":
      return {
        label: "01 / YOUR ACCOUNT",
        title: "How would you like to sign in?",
        description:
          "Sign in to Cloudroom with GitHub. You’ll connect your coding agent in the next step.",
      };
    case "provider":
      return {
        label: "02 / YOUR AGENT",
        title: "Which provider would you like to use?",
        description:
          "Choose one provider. Connection and model choice come next, one question at a time.",
      };
    case "provider-connect":
      return {
        label: "02 / SECURE CONNECTION",
        title: `Connect ${providerName(state.provider)}?`,
        description:
          "Use the provider’s existing secure sign-in flow. This preview simulates authorization and never collects credentials.",
      };
    case "provider-approval":
      return {
        label: "02 / PROVIDER AUTHORIZATION",
        title: "Finish connecting your agent.",
        description:
          "Complete the provider’s secure sign-in in your browser, then return here.",
      };
    case "project":
      return {
        label: "03 / YOUR STARTING POINT",
        title: "Where would you like to start?",
        description:
          "Choose a repository, or start without a project. You can add one later.",
      };
    case "model":
      return {
        label: "02 / YOUR MODEL",
        title: "Which model would you like to use?",
        description: `${providerName(state.provider)} is connected in this fixture. Choose a model before choosing a project. Live model availability is not queried here.`,
      };
    case "verification-consent":
      return {
        label: "04 / READ-ONLY CHECK",
        title: "Run the read-only check?",
        description:
          "We’ll use your selected model to return one short response. A completed execution is required before the composer opens. This preview runs no paid task.",
      };
    case "repo-access":
      return {
        label: "03 / REPOSITORY ACCESS",
        title: "Review repository access.",
        description:
          "Your GitHub identity is separate from permission to use this repository.",
      };
    case "repo-denied":
      return {
        label: "03 / ACCESS NOT GRANTED",
        title: "This repository isn’t available.",
        description:
          "Access was denied. Choose No project to continue without repository permissions.",
      };
    case "verifying":
      return {
        label: "04 / ONE LAST CHECK",
        title: "A tiny task. Real confidence.",
        description:
          "Your selected model is running a read-only task in the cloud. We’ll confirm the result before you start.",
      };
    case "approval":
      return {
        label: "04 / YOUR APPROVAL NEEDED",
        title: "One step needs your OK.",
        description:
          "Your agent requested a read-only command. Review the exact request before allowing it.",
      };
    case "failed":
      return {
        label: "04 / VERIFICATION PAUSED",
        title: state.reconciled
          ? "Safe to try this step again."
          : "Your provider couldn’t finish.",
        description: state.reconciled
          ? "The saved operation ended with a provider error. A new attempt can now start safely."
          : "The provider returned a rate-limit error. Check the operation’s final status before retrying.",
      };
    case "resumed":
      return {
        label: "04 / WELCOME BACK",
        title: "Right where you left off.",
        description:
          "Your choices are saved. We’re checking the existing cloud operation before continuing. No duplicate task will start.",
      };
    case "cancelled":
      return {
        label: "04 / SETUP PAUSED",
        title: "Paused, with your place saved.",
        description:
          "A stop was requested. Confirm the cloud operation has settled before continuing or retrying.",
      };
    case "expired":
      return {
        label: "02 / SIGN-IN EXPIRED",
        title: "Reconnect your provider.",
        description:
          "Your provider authorization expired. Sign in securely again to continue with the same model.",
      };
    case "success":
      return {
        label: "04 / VERIFIED IN THE CLOUD",
        title: "You’re ready to make things.",
        description:
          "Your selected model completed the read-only check. Your cloud workspace is ready for its first idea.",
      };
  }
}

function StageHeading({
  state,
  headingRef,
}: {
  state: SetupFixture;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const copy = stageCopy(state);
  return (
    <>
      <div
        className={`stage-symbol ${isVerified(state) ? "verified-symbol" : ""}`}
      >
        <Icon
          name={
            isVerified(state)
              ? "Check"
              : state.phase === "identity"
                ? "Github"
                : state.phase === "approval"
                  ? "Lock"
                  : state.phase === "failed"
                    ? "AlertCircle"
                    : "Cloud"
          }
        />
      </div>
      <p className="eyebrow">{copy.label}</p>
      <h1 id="stage-heading" ref={headingRef} tabIndex={-1}>
        {copy.title}
      </h1>
      <p className="stage-description">{copy.description}</p>
    </>
  );
}

function Notice({
  children,
  kind = "neutral",
}: {
  children: ReactNode;
  kind?: "neutral" | "warning" | "error" | "good";
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon
        name={
          kind === "good"
            ? "Check"
            : kind === "neutral"
              ? "Info"
              : "AlertCircle"
        }
      />
      <div>{children}</div>
    </div>
  );
}

function NumberedChoice({
  number,
  label,
  description,
  onClick,
}: {
  number: number;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="choice-card numbered-choice"
      aria-label={`${number}. ${label}`}
      onClick={onClick}
    >
      <span className="answer-number" aria-hidden="true">
        {number}
      </span>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <Icon name="ArrowRight" aria-hidden="true" />
    </Button>
  );
}

function InstallationHelp() {
  return (
    <>
      <h3>Keep using your existing installation</h3>
      <p>
        If Cloudroom is already installed, open its existing icon. Completing
        setup does not require installing another copy.
      </p>
      <h3>Desktop app updates</h3>
      <p>
        Open Settings → Updates. When Cloudroom says an update is ready, use
        Relaunch. This preview cannot check for or apply updates.
      </p>
      <h3>Phone or installed web app</h3>
      <p>
        Update status cannot be verified by this preview. Keep your current
        installation and note the app address, device, and browser if it appears
        out of date.
      </p>
      <div className="notice warning">
        <div>
          <strong>User reports to verify</strong>
          <p>
            Jake reported duplicate PWA installations and missing update
            instructions. Neither report has been reproduced or confirmed here.
            Device and signed-in checks remain open.
          </p>
        </div>
      </div>
    </>
  );
}

function StageContent({
  state,
  dispatch,
  openDetails,
  openComposer,
}: {
  state: SetupFixture;
  dispatch: (action: Action) => void;
  openDetails: () => void;
  openComposer: () => void;
}) {
  const billing = (
    <Notice>
      <strong>Billing mode: unknown</strong>
      <p>
        This connection has not verified how your provider bills usage. Setup
        never switches to API billing automatically.
      </p>
    </Notice>
  );
  const selection = (
    <div className="selected-context">
      <span>{providerName(state.provider)}</span>
      <span>{state.model}</span>
      <span>{state.project}</span>
    </div>
  );
  switch (state.phase) {
    case "identity":
      return (
        <>
          <div className="identity-permissions">
            <Icon name="Github" />
            <div>
              <strong>A sign-in, with a clear boundary.</strong>
              <p>
                This identifies you to Cloudroom. Repository access and your
                agent account are separate steps.
              </p>
            </div>
          </div>
          <Button
            className="primary-cta"
            onClick={() => dispatch({ type: "signed-in" })}
          >
            <Icon name="Github" /> 1. Continue with GitHub{" "}
            <Icon name="ArrowRight" />
          </Button>
          <p className="fine-print">
            Opens secure browser sign-in in production. Simulated here.
          </p>
        </>
      );
    case "provider":
      return (
        <div
          className="question-choices"
          role="group"
          aria-label="Provider choice"
        >
          {(["codex", "claude-code"] as const).map((provider, index) => (
            <NumberedChoice
              key={provider}
              number={index + 1}
              label={providerName(provider)}
              onClick={() => dispatch({ type: "select-provider", provider })}
            />
          ))}
        </div>
      );
    case "provider-connect":
      return (
        <>
          {billing}
          <div
            className="question-choices"
            role="group"
            aria-label="Connection choice"
          >
            <NumberedChoice
              number={1}
              label={`Connect ${providerName(state.provider)}`}
              description="Secure browser authorization · simulated here"
              onClick={() => dispatch({ type: "connect" })}
            />
            <NumberedChoice
              number={2}
              label="Choose another provider"
              onClick={() => dispatch({ type: "change-provider" })}
            />
          </div>
        </>
      );
    case "model":
      return (
        <>
          <div
            className="question-choices"
            role="group"
            aria-label="Model choice"
          >
            <NumberedChoice
              number={1}
              label={models[state.provider]}
              description="Illustrative fixture model; availability is not verified"
              onClick={() =>
                dispatch({
                  type: "select-model",
                  model: models[state.provider],
                })
              }
            />
          </div>
        </>
      );
    case "verification-consent":
      return (
        <>
          {selection}
          {billing}
          <div className="task-spec">
            <strong>Read-only task</strong>
            <p>Do not change files or settings. Reply exactly:</p>
            <code>CLOUDROOM_SETUP_OK</code>
          </div>
          <div
            className="question-choices"
            role="group"
            aria-label="Verification choice"
          >
            <NumberedChoice
              number={1}
              label="Run simulated read-only check"
              description="Fixture only · no usage purchased or billing mode changed"
              onClick={() => dispatch({ type: "start-verification" })}
            />
          </div>
        </>
      );
    case "provider-approval":
      return (
        <>
          <Notice kind="warning">
            <strong>Waiting for browser authorization</strong>
            <p>
              Your provider handles your credentials. Return here when sign-in
              finishes.
            </p>
          </Notice>
          <div className="fixture-control">
            <span>Fixture control · no account is connected</span>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "connected" })}
            >
              1. Simulate connection confirmed
            </Button>
          </div>
        </>
      );
    case "expired":
      return (
        <>
          {billing}
          <Notice kind="warning">
            <strong>Provider authentication expired</strong>
            <p>
              Your project choice is saved. Reconnect before verification can
              run.
            </p>
          </Notice>
          <Button
            className="primary-cta"
            onClick={() => dispatch({ type: "connect" })}
          >
            1. Reconnect {providerName(state.provider)}{" "}
            <Icon name="ArrowRight" />
          </Button>
        </>
      );
    case "project":
      return (
        <>
          <span className="status-label good">
            <Icon name="Check" /> {providerName(state.provider)} connected
          </span>
          <div
            className="question-choices"
            role="group"
            aria-label="Project choice"
          >
            <NumberedChoice
              number={1}
              label="No project"
              description="A fresh space. No repository access needed."
              onClick={() =>
                dispatch({ type: "select-project", project: "No project" })
              }
            />
            <NumberedChoice
              number={2}
              label="example/cloud-notes"
              description="Example repository · review access next"
              onClick={() =>
                dispatch({
                  type: "select-project",
                  project: "example/cloud-notes",
                })
              }
            />
          </div>
          <p className="fine-print">
            Repository permissions are requested only when you choose a
            repository.
          </p>
        </>
      );
    case "repo-access":
      return (
        <>
          <div className="task-spec">
            <strong>{state.project}</strong>
            <p>
              Proposed grant: only the selected repository. Review permissions
              before continuing.
            </p>
          </div>
          <Notice kind="warning">
            <strong>Proposed capability · fixture only</strong>
            <p>
              The current GitHub flow requests broader scopes. Narrow repository
              authorization is not implemented by this prototype.
            </p>
          </Notice>
          <div className="actions">
            <Button onClick={() => dispatch({ type: "grant-repo" })}>
              1. Simulate access granted
            </Button>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "deny-repo" })}
            >
              2. Deny access
            </Button>
          </div>
        </>
      );
    case "repo-denied":
      return (
        <>
          <Notice kind="error">
            <strong>Repository access denied</strong>
            <p>
              No permissions were expanded. You can finish setup without a
              repository.
            </p>
          </Notice>
          <Button
            className="primary-cta"
            onClick={() => dispatch({ type: "no-project" })}
          >
            1. Choose No project <Icon name="ArrowRight" />
          </Button>
        </>
      );
    case "verifying":
      return (
        <>
          {selection}
          <div className="verification-card">
            <div className="verification-head">
              <span className="running-marker">
                <Icon name="Loading" />
              </span>
              <div>
                <strong>Waiting for the model’s result</strong>
                <p>Read-only verification · attempt {state.attempt}</p>
              </div>
              <span className="status-label">Running</span>
            </div>
            <ol className="verification-stages">
              <li>
                <Icon name="Check" /> Workspace prepared
              </li>
              <li>
                <Icon name="Check" /> Selected model started
              </li>
              <li className="running">
                <span className="pulse-dot" /> Confirm completed execution
              </li>
            </ol>
          </div>
          <p className="fine-print">
            A saved configuration or accepted launch is not a passed check.
          </p>
          <div className="fixture-control">
            <span>Fixture control · synthetic execution receipt</span>
            <Button
              variant="outline"
              onClick={() =>
                dispatch({
                  type: "execution-completed",
                  receipt: receiptFor(state),
                })
              }
            >
              Simulate completed task
            </Button>
          </div>
          <Button variant="ghost" onClick={() => dispatch({ type: "cancel" })}>
            Pause setup
          </Button>
        </>
      );
    case "approval":
      return (
        <>
          {selection}
          <Notice kind="warning">
            <strong>Approval required in the setup session</strong>
            <p>
              Requested command: <code>pwd</code>. Read-only, for this session
              only. Nothing runs until you decide.
            </p>
          </Notice>
          <Button className="primary-cta" onClick={openDetails}>
            1. Review approval <Icon name="ArrowRight" />
          </Button>
          <Button variant="ghost" onClick={() => dispatch({ type: "cancel" })}>
            Pause setup
          </Button>
        </>
      );
    case "failed":
      return (
        <>
          {selection}
          <Notice kind="error">
            <strong>Provider rate limit · verification incomplete</strong>
            <p>
              Wait for your provider’s limit to reset. Your provider and billing
              settings are unchanged.
            </p>
          </Notice>
          <div className="recovery-card">
            <strong>
              {state.reconciled
                ? "Previous attempt confirmed failed"
                : "First, reconcile the saved operation"}
            </strong>
            <p>
              {state.reconciled
                ? "The previous run ended. You can safely retry the check."
                : "A response can be lost after a task starts. Check its final state before creating a new attempt."}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                dispatch(
                  state.reconciled
                    ? { type: "retry" }
                    : { type: "reconcile", outcome: "failed" },
                )
              }
            >
              {state.reconciled
                ? "1. Retry verification"
                : "1. Check cloud status"}
              <Icon name="ArrowRight" />
            </Button>
          </div>
        </>
      );
    case "resumed":
    case "cancelled":
      return (
        <>
          {selection}
          <Notice kind="warning">
            <strong>
              {state.phase === "resumed"
                ? "Saved operation found · outcome unconfirmed"
                : "Stop requested · outcome unconfirmed"}
            </strong>
            <p>
              Operation {state.operationId}. Your provider, model, and project
              choices are preserved.
            </p>
          </Notice>
          <div className="recovery-card">
            <strong>Continue the existing operation first.</strong>
            <p>
              {state.phase === "resumed"
                ? "The preview will recover the still-running task using the same operation ID."
                : "The preview will confirm the previous attempt ended before offering a retry."}
            </p>
            <Button
              variant="outline"
              onClick={() =>
                dispatch({
                  type: "reconcile",
                  outcome: state.phase === "resumed" ? "running" : "failed",
                })
              }
            >
              1. Check cloud status <Icon name="ArrowRight" />
            </Button>
          </div>
        </>
      );
    case "success":
      return (
        <>
          {selection}
          <div className="success-card">
            <span className="success-check">
              <Icon name="Check" />
            </span>
            <div>
              <strong>Read-only task completed</strong>
              <p>{state.model} returned the expected result.</p>
              <code>CLOUDROOM_SETUP_OK</code>
            </div>
          </div>
          {billing}
          <Button
            className="primary-cta"
            onClick={openComposer}
            disabled={!isVerified(state)}
          >
            1. Open composer <Icon name="ArrowRight" />
          </Button>
          <p className="fine-print">
            Verified execution receipt is simulated in this design preview.
          </p>
        </>
      );
  }
}

createRoot(document.getElementById("root")!).render(<Preview />);
