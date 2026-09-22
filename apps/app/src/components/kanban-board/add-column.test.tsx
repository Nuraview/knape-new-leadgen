import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddColumn, AddColumnButton } from "./add-column";

const canManageProjects = vi.fn();
const isCheckingPermissions = vi.fn();
const createColumn = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageProjects: () => canManageProjects(),
    isCheckingPermissions: isCheckingPermissions(),
  }),
}));

vi.mock("@/hooks/mutations/column/use-create-column", () => ({
  useCreateColumn: () => ({ mutateAsync: createColumn, isPending: false }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (message: string) => toastSuccess(message),
    error: (message: string) => toastError(message),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// @base-ui's popover reads react through `use-sync-external-store`, which bun
// resolves to its OWN nested react copy — two dispatchers, so rendering a real
// popover in jsdom throws "Cannot read properties of null (reading
// 'useSyncExternalStore')". The icon picker is not what these tests are about,
// so it renders as plain markup instead.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

beforeEach(() => {
  canManageProjects.mockReturnValue(true);
  isCheckingPermissions.mockReturnValue(false);
  createColumn.mockResolvedValue({ id: "column-1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("AddColumn", () => {
  it("renders nothing for a member who cannot update the project", () => {
    canManageProjects.mockReturnValue(false);

    const { container } = render(<AddColumn projectId="project-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden until the capability check resolves", () => {
    isCheckingPermissions.mockReturnValue(true);

    const { container } = render(<AddColumn projectId="project-1" />);

    // Rendering the tile optimistically would flash it on then off for every
    // member on every board load.
    expect(container).toBeEmptyDOMElement();
  });

  it("creates a column with the trimmed name and keeps the composer open", async () => {
    render(<AddColumn projectId="project-1" />);

    fireEvent.click(screen.getByText("tasks:kanban.addColumn"));

    const input = screen.getByPlaceholderText(
      "settings:columnEditor.newColumnPlaceholder",
    );
    fireEvent.change(input, { target: { value: "  Blocked  " } });
    fireEvent.click(screen.getByText("settings:columnEditor.add"));

    expect(createColumn).toHaveBeenCalledWith({
      projectId: "project-1",
      data: { name: "Blocked", icon: "Circle" },
    });

    expect(await screen.findByPlaceholderText(
      "settings:columnEditor.newColumnPlaceholder",
    )).toHaveValue("");
    expect(toastSuccess).toHaveBeenCalledWith(
      "settings:columnEditor.toastCreated",
    );
  });

  it("surfaces the API message when the slug is taken", async () => {
    createColumn.mockRejectedValue(new Error("Column already exists"));

    render(<AddColumn projectId="project-1" />);
    fireEvent.click(screen.getByText("tasks:kanban.addColumn"));
    fireEvent.change(
      screen.getByPlaceholderText(
        "settings:columnEditor.newColumnPlaceholder",
      ),
      { target: { value: "Done" } },
    );
    fireEvent.click(screen.getByText("settings:columnEditor.add"));

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Column already exists"),
    );
  });

  it("creates from the toolbar without scrolling the board", async () => {
    // The strip tile is past the right edge on a four-column board, so the
    // toolbar mount is the one that has to work.
    render(<AddColumnButton projectId="project-1" />);

    fireEvent.change(
      screen.getByPlaceholderText("settings:columnEditor.newColumnPlaceholder"),
      { target: { value: "Blocked" } },
    );
    fireEvent.click(screen.getByText("settings:columnEditor.add"));

    expect(createColumn).toHaveBeenCalledWith({
      projectId: "project-1",
      data: { name: "Blocked", icon: "Circle" },
    });
  });

  it("renders no toolbar button before a project has loaded", () => {
    const { container } = render(<AddColumnButton projectId={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("closes the composer on cancel", () => {
    render(<AddColumn projectId="project-1" />);

    fireEvent.click(screen.getByText("tasks:kanban.addColumn"));
    fireEvent.click(screen.getByText("common:actions.cancel"));

    expect(
      screen.queryByPlaceholderText(
        "settings:columnEditor.newColumnPlaceholder",
      ),
    ).toBeNull();
    expect(screen.getByText("tasks:kanban.addColumn")).toBeTruthy();
  });
});
