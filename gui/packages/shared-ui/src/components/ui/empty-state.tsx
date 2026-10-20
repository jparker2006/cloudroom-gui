import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { CloudIllustration, type CloudScene } from "./cloud-illustration";
import { Icon, type IconName } from "./icon";

export type { CloudScene };

export interface EmptyStateProps {
  message: string;
  icon?: IconName;
  className?: string;
  iconClassName?: string;
  messageClassName?: string;
}

export function EmptyState({
  message,
  icon,
  className,
  iconClassName,
  messageClassName,
}: EmptyStateProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {icon ? (
        <Icon
          name={icon}
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-subtle-foreground",
            iconClassName,
          )}
        />
      ) : null}
      <p
        className={cn(
          "text-xs leading-5 text-muted-foreground",
          messageClassName,
        )}
      >
        {message}
      </p>
    </div>
  );
}

type EmptyStatePanelProps = HTMLAttributes<HTMLDivElement>;

export function EmptyStatePanel({
  className,
  children,
  ...props
}: EmptyStatePanelProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface EmptyStateSceneProps {
  scene: CloudScene;
  logoSrc: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "hero" | "panel";
  role?: "status";
  className?: string;
}

export function EmptyStateScene({
  scene,
  logoSrc,
  title,
  description,
  action,
  size = "panel",
  role,
  className,
}: EmptyStateSceneProps) {
  const hero = size === "hero";
  return (
    <div
      role={role}
      data-empty-state-scene={scene}
      className={cn(
        "flex min-w-0 flex-col motion-safe:animate-cloud-reveal items-center text-center",
        hero ? "gap-4 px-6 py-10" : "gap-3 px-4 py-6",
        className,
      )}
    >
      <CloudIllustration scene={scene} logoSrc={logoSrc} size={size} />
      <div className="flex min-w-0 max-w-[36ch] flex-col gap-1">
        <p
          className={cn(
            "font-medium text-foreground [overflow-wrap:anywhere]",
            hero ? "text-base" : "text-sm",
          )}
        >
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "text-muted-foreground [overflow-wrap:anywhere]",
              hero ? "text-sm" : "text-xs leading-5",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
