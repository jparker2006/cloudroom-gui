import type { ReactNode } from "react";
import { Button } from "@cloudroom/shared-ui/button";
import { Icon, type IconName } from "@cloudroom/shared-ui/icon";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { FauxComposer, ResponsiveStage } from "./banner-story-stages";
import { PromptStackCard } from "./PromptStackCard";
import { ProviderRequirementBanner } from "./ProviderRequirementBanner";

export default {
  title: "promptbox/banner/New-thread drafts (design)",
};

const noop = () => {};

function SmallButton({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: "outline" | "ghost" | "destructive";
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className="h-8 shrink-0 px-3"
      onClick={noop}
    >
      {children}
    </Button>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex gap-1.5">{children}</div>;
}

function Note({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <PromptStackCard ariaLabel="Draft status">
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-2 text-xs text-subtle-foreground"
      >
        <Icon name={icon} className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">{children}</span>
      </div>
    </PromptStackCard>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <ResponsiveStage>
      <div className="flex flex-col gap-1.5">
        {children}
        <FauxComposer />
      </div>
    </ResponsiveStage>
  );
}

export function States() {
  return (
    <StoryCard labelWidth="230px">
      <StoryRow
        label="switched projects"
        hint="once per project pair, 4s, polite live region; banners above take priority"
      >
        <Stage>
          <Note icon="Check">
            Saved your <b className="font-medium text-foreground">Alpha</b>{" "}
            draft. Showing your{" "}
            <b className="font-medium text-foreground">Beta</b> draft.
          </Note>
        </Stage>
      </StoryRow>
      <StoryRow
        label="unassigned legacy draft"
        hint="the old global draft; never assigned without a click"
      >
        <Stage>
          <ProviderRequirementBanner
            title="Unsent draft from before this update (1 of 2)"
            description="“Refactor the login form so errors show inline…” · 2 attachments"
            action={
              <Actions>
                <SmallButton>Move to Beta</SmallButton>
                <SmallButton variant="ghost">Discard</SmallButton>
                <SmallButton variant="ghost">Not now</SmallButton>
              </Actions>
            }
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="draft from a deleted project"
        hint="a project draft whose project is gone"
      >
        <Stage>
          <ProviderRequirementBanner
            title="Unsent draft from a project that no longer exists"
            description="“Write release notes for v2…” · 1 attachment"
            action={
              <Actions>
                <SmallButton>Move to Beta</SmallButton>
                <SmallButton variant="ghost">Discard</SmallButton>
                <SmallButton variant="ghost">Not now</SmallButton>
              </Actions>
            }
          />
        </Stage>
      </StoryRow>
      <StoryRow label="confirm discard" hint="inline second step, no modal">
        <Stage>
          <ProviderRequirementBanner
            title="Discard this draft?"
            description="Its text is deleted from this device. Uploaded files are kept."
            action={
              <Actions>
                <SmallButton variant="outline">Keep</SmallButton>
                <SmallButton variant="destructive">Discard draft</SmallButton>
              </Actions>
            }
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="moved, some attachments left"
        hint="unverified attachments never join another project"
      >
        <Stage>
          <ProviderRequirementBanner
            title="1 attachment stayed behind"
            description="The text moved. screenshot.png isn't stored in Beta, so it wasn't added. Discarding removes only this attachment from the draft."
            action={
              <Actions>
                <SmallButton>Move rest to Beta</SmallButton>
                <SmallButton variant="ghost">Discard</SmallButton>
                <SmallButton variant="ghost">Not now</SmallButton>
              </Actions>
            }
          />
        </Stage>
      </StoryRow>
      <StoryRow label="move failed" hint="storage write failed; nothing changed">
        <Stage>
          <ProviderRequirementBanner
            title="Couldn't move the draft"
            description="Nothing changed. Free up browser storage and try again."
            action={
              <Actions>
                <SmallButton>Retry</SmallButton>
              </Actions>
            }
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="attachments couldn't be checked"
        hint="network error or 5xx; the text moved"
      >
        <Stage>
          <ProviderRequirementBanner
            title="Some attachments stayed behind"
            description="They couldn't be checked, so they weren't added. Check your connection and try again."
            action={
              <Actions>
                <SmallButton>Retry</SmallButton>
                <SmallButton variant="ghost">Not now</SmallButton>
              </Actions>
            }
          />
        </Stage>
      </StoryRow>
      <StoryRow
        label="storage failure"
        hint="browser storage full or blocked"
      >
        <Stage>
          <ProviderRequirementBanner
            title="Draft not saved on this device"
            description="Browser storage is full or blocked. Your draft stays in this window until you close it."
            action={
              <Actions>
                <SmallButton variant="outline">Copy draft</SmallButton>
              </Actions>
            }
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
