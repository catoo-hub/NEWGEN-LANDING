import { describe, it, expect } from "vitest";
import { money, share } from "../src/shared/types";
import { range } from "../src/server/services/files";
describe("exact amounts and private media ranges", () => {
  it("normalizes Robokassa six-decimal amounts without floating point", () => {
    expect(money("1250.120000")).toBe(125012);
    expect(money("10")).toBe(1000);
    expect(() => money("10.000001")).toThrow();
    expect(() => money("-1")).toThrow();
  });
  it("rounds commission to kopecks", () => {
    expect(share(10001, 7500)).toBe(7501);
    expect(share(1, 5000)).toBe(1);
  });
  it("handles seeking, suffix and invalid byte ranges", () => {
    expect(range("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(range("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(range("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(() => range("bytes=101-", 100)).toThrow();
    expect(() => range("bytes=0-1,5-6", 100)).toThrow();
  });
});
