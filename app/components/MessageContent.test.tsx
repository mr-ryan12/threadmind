// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import MessageContent from "./MessageContent";

afterEach(cleanup);

describe("message citation links", () => {
  it("renders persisted inline citations as safe clickable links", () => {
    render(<MessageContent content="Answer. [Official source](https://example.com/page) Done." />);
    const link = screen.getByRole("link", { name: "Official source" });
    expect(link).toHaveAttribute("href", "https://example.com/page");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.parentElement).toHaveTextContent("Answer. Official source Done.");
  });

  it("keeps HTML and unsafe or unfinished links as text", () => {
    const content = '<script>alert(1)</script> [bad](javascript:alert(1)) [unfinished](https://';
    const { container } = render(<MessageContent content={content} />);
    expect(container).toHaveTextContent(content);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
