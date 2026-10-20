// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSelector } from "./ProjectSelector";

const PROJECTS = [
  { id: "proj_alpha", name: "Alpha Web" },
  { id: "proj_bravo", name: "Bravo API" },
  { id: "proj_charlie", name: "Charlie Docs" },
  { id: "proj_delta", name: "Delta Mobile" },
  { id: "proj_echo", name: "Echo Infra" },
  { id: "proj_foxtrot", name: "Foxtrot Design" },
] as const;

afterEach(cleanup);

describe("ProjectSelector", () => {
  it("exposes the current project separately from keyboard highlight", () => {
    render(
      <ProjectSelector
        projects={PROJECTS}
        value="proj_charlie"
        onChange={() => {}}
        defaultOpen
        modal={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Project: Charlie Docs" }),
    ).toBeTruthy();
    const search = screen.getByRole("combobox", { name: "Search projects" });
    const alpha = screen.getByRole("option", { name: "Alpha Web" });
    const bravo = screen.getByRole("option", { name: "Bravo API" });
    const charlie = screen.getByRole("option", { name: "Charlie Docs" });
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    expect(charlie.getAttribute("aria-selected")).toBe("false");
    expect(charlie.getAttribute("aria-current")).toBe("true");

    fireEvent.keyDown(search, { key: "ArrowDown" });

    expect(alpha.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(search, { key: "ArrowDown" });

    expect(bravo.getAttribute("aria-selected")).toBe("true");
    expect(charlie.getAttribute("aria-current")).toBe("true");
  });

  it("shows search only when there are more than five projects", () => {
    const result = render(
      <ProjectSelector
        projects={PROJECTS.slice(0, 5)}
        value="proj_alpha"
        onChange={() => {}}
        defaultOpen
        modal={false}
      />,
    );

    expect(
      screen.queryByRole("combobox", { name: "Search projects" }),
    ).toBeNull();

    result.rerender(
      <ProjectSelector
        projects={PROJECTS}
        value="proj_alpha"
        onChange={() => {}}
        defaultOpen
        modal={false}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Search projects" }),
    ).toBeTruthy();
  });

  it("fuzzy-matches project names case-insensitively and selects the match", () => {
    const onChange = vi.fn();
    render(
      <ProjectSelector
        projects={PROJECTS}
        value="proj_alpha"
        onChange={onChange}
        defaultOpen
        modal={false}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Search projects" }),
      { target: { value: "CD" } },
    );

    expect(screen.queryByRole("option", { name: "Alpha Web" })).toBeNull();
    expect(screen.getByRole("option", { name: "Charlie Docs" })).toBeTruthy();
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Search projects" }),
      { key: "Enter" },
    );

    expect(onChange).toHaveBeenCalledWith("proj_charlie");
    expect(screen.queryByRole("dialog", { name: "Project" })).toBeNull();
  });

  it("keeps keyboard selection for short project lists", () => {
    const onChange = vi.fn();
    render(
      <ProjectSelector
        projects={PROJECTS.slice(0, 5)}
        value="proj_alpha"
        onChange={onChange}
        defaultOpen
        modal={false}
      />,
    );

    const command = document.querySelector<HTMLElement>("[cmdk-root]");
    expect(command).not.toBeNull();
    expect(document.activeElement).toBe(command);

    if (command === null) return;
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    fireEvent.keyDown(command, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(command, { key: "ArrowDown" });
    fireEvent.keyDown(command, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("proj_alpha");
  });

  it("keeps project actions visible and resets search after closing", () => {
    const onCreate = vi.fn();
    render(
      <ProjectSelector
        projects={PROJECTS}
        value={null}
        onChange={() => {}}
        allowNoProject
        createProject={{ onCreate }}
        defaultOpen
        modal={false}
      />,
    );

    expect(
      screen
        .getByRole("option", { name: "Don't work in a project" })
        .getAttribute("aria-current"),
    ).toBe("true");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search projects" }),
      { target: { value: "missing" } },
    );

    expect(screen.getByText("No projects found")).toBeTruthy();
    expect(screen.getByRole("option", { name: "New project" })).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Don't work in a project" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("option", { name: "New project" }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Project: Work in a project" }),
    );
    expect(
      screen.getByRole<HTMLInputElement>("combobox", {
        name: "Search projects",
      }).value,
    ).toBe("");
    expect(screen.getByRole("option", { name: "Alpha Web" })).toBeTruthy();
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
  });

  it("keeps empty-list actions in the project group", () => {
    render(
      <ProjectSelector
        projects={[]}
        value={null}
        onChange={() => {}}
        allowNoProject
        createProject={{ onCreate: () => {} }}
        defaultOpen
        modal={false}
      />,
    );

    const groups = document.querySelectorAll("[cmdk-group]");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.querySelector("[cmdk-group-heading]")?.textContent).toBe(
      "Project",
    );
    expect(groups[0]?.querySelectorAll("[cmdk-item]")).toHaveLength(2);
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
  });

  it("keeps the search fixed while the project results scroll", () => {
    render(
      <ProjectSelector
        projects={Array.from({ length: 20 }, (_, index) => ({
          id: `proj_${index}`,
          name: `Project ${index}`,
        }))}
        value="proj_0"
        onChange={() => {}}
        defaultOpen
        modal={false}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Project" });
    expect(dialog.className).toContain(
      "max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))]",
    );
    expect(dialog.className).toContain("overflow-hidden");

    const list = document.querySelector<HTMLElement>("[cmdk-list]");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("overflow-y-auto");
    expect(list?.className).toContain("overscroll-contain");

    if (list === null) return;
    list.scrollTop = 120;
    fireEvent.change(
      screen.getByRole("combobox", { name: "Search projects" }),
      { target: { value: "Project 19" } },
    );
    expect(list.scrollTop).toBe(0);
  });

  describe("recent projects", () => {
    const optionNames = (group: Element | undefined) =>
      Array.from(group?.querySelectorAll("[cmdk-item]") ?? []).map(
        (item) => item.textContent,
      );
    const groupByHeading = (heading: string) =>
      Array.from(document.querySelectorAll("[cmdk-group]")).find((group) =>
        group
          .querySelector("[cmdk-group-heading]")
          ?.textContent?.startsWith(heading),
      );

    it("lists up to five existing recents first and the rest once, in sidebar order", () => {
      render(
        <ProjectSelector
          projects={PROJECTS}
          value="proj_echo"
          onChange={() => {}}
          allowNoProject
          createProject={{ onCreate: () => {} }}
          recentProjectIds={[
            "proj_echo",
            "proj_deleted",
            "proj_bravo",
            "proj_foxtrot",
            "proj_alpha",
            "proj_delta",
            "proj_charlie",
          ]}
          defaultOpen
          modal={false}
        />,
      );

      expect(optionNames(groupByHeading("Recent"))).toEqual([
        "Echo Infra",
        "Bravo API",
        "Foxtrot Design",
        "Alpha Web",
        "Delta Mobile",
      ]);
      expect(optionNames(groupByHeading("Other projects"))).toEqual([
        "Charlie Docs",
      ]);
      expect(
        screen.getAllByRole("option", { name: "Echo Infra" }),
      ).toHaveLength(1);
      expect(
        document.querySelectorAll('[cmdk-item][aria-current="true"]'),
      ).toHaveLength(1);
      expect(screen.getByRole("option", { name: "New project" })).toBeTruthy();
      expect(
        screen.getByRole("option", { name: "Don't work in a project" }),
      ).toBeTruthy();
    });

    it("shows the current name of a renamed project and skips unknown ids", () => {
      render(
        <ProjectSelector
          projects={[
            { id: "proj_alpha", name: "Alpha Renamed" },
            ...PROJECTS.slice(1),
          ]}
          value="proj_bravo"
          onChange={() => {}}
          recentProjectIds={["proj_gone", "proj_alpha"]}
          defaultOpen
          modal={false}
        />,
      );

      expect(optionNames(groupByHeading("Recent"))).toEqual(["Alpha Renamed"]);
    });

    it("keeps today's picker when there is no history", () => {
      render(
        <ProjectSelector
          projects={PROJECTS}
          value="proj_alpha"
          onChange={() => {}}
          recentProjectIds={["proj_unavailable"]}
          defaultOpen
          modal={false}
        />,
      );

      expect(groupByHeading("Recent")).toBeUndefined();
      expect(optionNames(groupByHeading("Project"))).toEqual(
        PROJECTS.map((project) => project.name),
      );
    });

    it("searches every project and hides the recent section while searching", () => {
      const onChange = vi.fn();
      render(
        <ProjectSelector
          projects={PROJECTS}
          value="proj_alpha"
          onChange={onChange}
          recentProjectIds={["proj_alpha", "proj_bravo"]}
          defaultOpen
          modal={false}
        />,
      );

      const search = screen.getByRole("combobox", { name: "Search projects" });
      fireEvent.change(search, { target: { value: "bravo" } });
      expect(groupByHeading("Recent")).toBeUndefined();
      expect(screen.getAllByRole("option", { name: "Bravo API" })).toHaveLength(
        1,
      );

      fireEvent.change(search, { target: { value: "a" } });
      expect(screen.getByRole("option", { name: "Alpha Web" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "Charlie Docs" })).toBeTruthy();
      fireEvent.change(search, { target: { value: "cd" } });
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("proj_charlie");
    });

    it("moves through recents before other projects with the keyboard", () => {
      const onChange = vi.fn();
      render(
        <ProjectSelector
          projects={PROJECTS}
          value="proj_alpha"
          onChange={onChange}
          recentProjectIds={["proj_delta", "proj_bravo"]}
          defaultOpen
          modal={false}
        />,
      );

      const search = screen.getByRole("combobox", { name: "Search projects" });
      fireEvent.keyDown(search, { key: "ArrowDown" });
      expect(
        screen
          .getByRole("option", { name: "Delta Mobile" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(search, { key: "ArrowDown" });
      expect(
        screen
          .getByRole("option", { name: "Alpha Web" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(
        screen
          .getByRole("option", { name: "Alpha Web" })
          .getAttribute("aria-current"),
      ).toBe("true");
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("proj_alpha");
    });

    it("keeps the order stable while open and refreshes it on the next open", () => {
      const props = {
        projects: PROJECTS,
        value: "proj_alpha",
        onChange: () => {},
        modal: false,
      };
      const view = render(
        <ProjectSelector
          {...props}
          recentProjectIds={["proj_bravo", "proj_charlie"]}
        />,
      );
      const trigger = screen.getByRole("button", {
        name: "Project: Alpha Web",
      });
      fireEvent.click(trigger);
      expect(optionNames(groupByHeading("Recent"))).toEqual([
        "Bravo API",
        "Charlie Docs",
      ]);

      view.rerender(
        <ProjectSelector
          {...props}
          recentProjectIds={["proj_echo", "proj_bravo", "proj_charlie"]}
        />,
      );
      expect(optionNames(groupByHeading("Recent"))).toEqual([
        "Bravo API",
        "Charlie Docs",
      ]);

      fireEvent.keyDown(
        screen.getByRole("combobox", { name: "Search projects" }),
        { key: "Escape" },
      );
      fireEvent.click(trigger);
      expect(optionNames(groupByHeading("Recent"))).toEqual([
        "Echo Infra",
        "Bravo API",
        "Charlie Docs",
      ]);
    });

    it("keeps the other projects in place when the list changes while open", () => {
      const props = {
        value: "proj_alpha",
        onChange: () => {},
        recentProjectIds: ["proj_alpha"],
        modal: false,
      };
      const view = render(
        <ProjectSelector {...props} projects={PROJECTS.slice(0, 4)} />,
      );
      const trigger = screen.getByRole("button", {
        name: "Project: Alpha Web",
      });
      fireEvent.click(trigger);
      expect(optionNames(groupByHeading("Other projects"))).toEqual([
        "Bravo API",
        "Charlie Docs",
        "Delta Mobile",
      ]);

      view.rerender(
        <ProjectSelector
          {...props}
          projects={[
            PROJECTS[3],
            PROJECTS[4],
            PROJECTS[0],
            { id: "proj_charlie", name: "Charlie Renamed" },
          ]}
        />,
      );
      expect(optionNames(groupByHeading("Other projects"))).toEqual([
        "Charlie Renamed",
        "Delta Mobile",
        "Echo Infra",
      ]);

      fireEvent.click(trigger);
      fireEvent.click(trigger);
      expect(optionNames(groupByHeading("Other projects"))).toEqual([
        "Delta Mobile",
        "Echo Infra",
        "Charlie Renamed",
      ]);
    });

    it("counts only the matching projects while searching", () => {
      render(
        <ProjectSelector
          projects={PROJECTS}
          value="proj_alpha"
          onChange={() => {}}
          createProject={{
            onCreate: () => {},
            suggestions: {
              repos: [],
              githubConnected: true,
              isLoading: false,
              addingKey: null,
              onAdd: () => Promise.resolve("proj_new"),
            },
          }}
          recentProjectIds={["proj_alpha"]}
          defaultOpen
          modal={false}
        />,
      );
      expect(groupByHeading("Other projects")?.textContent).toContain("5");
      fireEvent.change(
        screen.getByRole("combobox", { name: "Search projects" }),
        { target: { value: "bravo" } },
      );
      expect(
        groupByHeading("In Cloudroom")?.querySelector("[cmdk-group-heading]")
          ?.textContent,
      ).toBe("In Cloudroom 1");
    });
  });
});
