import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "@/components/ui/Pagination";

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
});
