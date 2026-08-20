import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetAppVersion = vi.fn().mockResolvedValue("0.1.2");
const mockOpenReleases = vi.fn().mockResolvedValue(undefined);
const mockOpenGitHubRepo = vi.fn().mockResolvedValue(undefined);
const mockCheck = vi.fn();
const mockInstallUpdateAndRestart = vi.fn().mockResolvedValue(undefined);
const mockOnProgress = vi.fn().mockResolvedValue(() => {});

const createStoreState = (
  overrides: Partial<{
    available: boolean;
    version: string;
    progress: { downloaded: number; total: number | null } | null;
    set: ReturnType<typeof vi.fn>;
    setFromInfo: ReturnType<typeof vi.fn>;
    setProgress: ReturnType<typeof vi.fn>;
  }> = {},
) => ({
  available: false,
  version: "",
  progress: null as { downloaded: number; total: number | null } | null,
  set: vi.fn(),
  setFromInfo: vi.fn(),
  setProgress: vi.fn((progress: { downloaded: number; total: number | null } | null) => {
    storeState.progress = progress;
  }),
  ...overrides,
});

vi.mock("@lobehub/icons", () => ({
  Github: ({ size }: { size?: number }) => (
    <svg width={size} height={size} aria-hidden="true" />
  ),
}));

vi.mock("@/services/modules/update", () => ({
  getAppVersion: (...args: unknown[]) => mockGetAppVersion(...args),
  openReleases: (...args: unknown[]) => mockOpenReleases(...args),
  openGitHubRepo: (...args: unknown[]) => mockOpenGitHubRepo(...args),
  GITHUB_RELEASES_URL: "https://github.com/VkRainB/ccMesh/releases",
  updateApi: {
    check: (...args: unknown[]) => mockCheck(...args),
    installUpdateAndRestart: (...args: unknown[]) =>
      mockInstallUpdateAndRestart(...args),
    onProgress: (...args: unknown[]) => mockOnProgress(...args),
  },
}));

let storeState = createStoreState();
vi.mock("@/stores/modules/update", () => ({
  useUpdateStore: Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    { getState: () => storeState },
  ),
}));

import { VersionPopover } from "@/components/business/VersionPopover";

describe("VersionPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockGetAppVersion.mockResolvedValue("0.1.2");
  });

  it("渲染版本号文本", async () => {
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
  });

  it("compact 触发器与侧栏图标按钮同尺寸，且不把版本号排进文档流", async () => {
    render(<VersionPopover compact />);
    const trigger = await screen.findByRole("button", { name: /版本 v0\.1\.2/ });
    expect(trigger.className).toMatch(/size-9/);
    expect(trigger.className).toMatch(/justify-center/);
    expect(screen.queryByText("v0.1.2")).not.toBeInTheDocument();
  });

  it("available=false 时不渲染更新图标", async () => {
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("下载更新")).not.toBeInTheDocument();
  });

  it("available=true 时渲染更新图标，点击调用 installUpdateAndRestart", async () => {
    storeState = createStoreState({ available: true, version: "0.2.0" });
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    const icon = screen.getByLabelText(/下载更新/);
    expect(icon).toBeInTheDocument();
    fireEvent.click(icon);
    expect(mockInstallUpdateAndRestart).toHaveBeenCalledTimes(1);
  });

  it("连点下载图标只触发一次 installUpdateAndRestart", async () => {
    storeState = createStoreState({ available: true, version: "0.2.0" });
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    const icon = screen.getByLabelText(/下载更新/);
    fireEvent.click(icon);
    fireEvent.click(icon);
    expect(mockInstallUpdateAndRestart).toHaveBeenCalledTimes(1);
  });

  it("下载进行中禁用「下载并安装」且再点图标不再 install", async () => {
    storeState = createStoreState({
      available: true,
      version: "0.2.0",
      progress: { downloaded: 10, total: 100 },
    });
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("v0.1.2"));
    const btn = await screen.findByRole("button", { name: "正在下载…" });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/下载更新/));
    expect(mockInstallUpdateAndRestart).not.toHaveBeenCalled();
  });

  it("手动检查发现新版本时回写全局更新状态", async () => {
    const info = {
      available: true,
      version: "0.2.0",
      currentVersion: "0.1.2",
      notes: "更新日志",
    };
    mockCheck.mockResolvedValue(info);
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("v0.1.2"));
    await waitFor(() => {
      expect(screen.getByLabelText("手动检查更新")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("手动检查更新"));
    await waitFor(() => {
      expect(storeState.setFromInfo).toHaveBeenCalledWith(info);
    });
  });

  it("打开 Popover 后点「查看发布」调用 openReleases", async () => {
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("v0.1.2"));
    await waitFor(() => {
      expect(screen.getByText("查看发布")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("查看发布"));
    expect(mockOpenReleases).toHaveBeenCalled();
  });

  it("打开 Popover 后点 GitHub 图标调用 openGitHubRepo", async () => {
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("v0.1.2"));
    await waitFor(() => {
      expect(screen.getByLabelText("GitHub 仓库")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("GitHub 仓库"));
    expect(mockOpenGitHubRepo).toHaveBeenCalled();
  });

  it("手动检查返回 available=false 时显示已是最新", async () => {
    mockCheck.mockResolvedValue({
      available: false,
      version: "0.1.2",
      currentVersion: "0.1.2",
      notes: "",
    });
    render(<VersionPopover />);
    await waitFor(() => {
      expect(screen.getByText("v0.1.2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("v0.1.2"));
    await waitFor(() => {
      expect(screen.getByLabelText("手动检查更新")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("手动检查更新"));
    await waitFor(() => {
      expect(screen.getByText("已是最新版本")).toBeInTheDocument();
    });
  });
});
