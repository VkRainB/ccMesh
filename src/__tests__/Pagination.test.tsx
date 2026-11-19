import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { pageItems, Pagination } from "@/components/ui/Pagination";

describe("Pagination", () => {
  it("第 1 页禁用上一页，点击下一页回调 page+1", () => {
    const onChange = vi.fn();
    render(
      <Pagination page={1} pageSize={10} total={35} onPageChange={onChange} />,
    );
    // ceil(35/10) = 4 总页
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByLabelText("上一页")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("下一页"));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("最后一页禁用下一页", () => {
    render(
      <Pagination page={4} pageSize={10} total={35} onPageChange={() => {}} />,
    );
    expect(screen.getByLabelText("下一页")).toBeDisabled();
    expect(screen.getByLabelText("上一页")).not.toBeDisabled();
  });

  it("页数超出窗口时折叠省略号，点击页码跳转", () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageSize={10} total={500} onPageChange={onChange} />);
    expect(screen.getByRole("button", { name: "第 6 页" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "第 7 页" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第 50 页" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "第 3 页" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("页码窗口随当前页在首尾和中间切换", () => {
    expect(pageItems(1, 50)).toEqual([1, 2, 3, 4, 5, 6, 0, 50]);
    expect(pageItems(25, 50)).toEqual([1, 0, 23, 24, 25, 26, 27, 0, 50]);
    expect(pageItems(50, 50)).toEqual([1, 0, 45, 46, 47, 48, 49, 50]);
    expect(pageItems(2, 4)).toEqual([1, 2, 3, 4]);
  });
});
