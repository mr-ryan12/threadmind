import { afterEach, describe, expect, it, vi } from "vitest";
import { runTool, tools } from "./tools";

afterEach(() => vi.useRealTimers());

describe("Responses tools", () => {
  it("exposes hosted search and a strict timezone function", () => {
    expect(tools).toContainEqual({ type: "web_search" });
    expect(tools).toContainEqual(expect.objectContaining({
      type: "function",
      name: "get_time_in_timezone",
      strict: true,
      parameters: expect.objectContaining({ additionalProperties: false }),
    }));
  });

  it("returns the current local time in the requested zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T03:30:00Z"));
    expect(runTool("get_time_in_timezone", { timezone: "America/Denver" }))
      .toBe("10/24/2026, 9:30:00 PM");
  });

  it.each([null, {}, { timezone: 1 }, { timezone: "" }, { timezone: "not/a/zone" }])(
    "returns a recoverable error for invalid arguments: %j", (args) => {
      expect(runTool("get_time_in_timezone", args)).toMatch(/^Error:/);
    },
  );

  it("rejects unknown functions", () => {
    expect(() => runTool("unknown", {})).toThrow("Unknown tool");
  });
});
