import { describe, expect, test } from "bun:test";
import { pathInBasename } from "../src";

describe("pathInBasename", () => {
  test.each([
    ["/accounts", "/accounts", "/"],
    ["/accounts", "/accounts/", "/"],
    ["/accounts", "/accounts/42", "/42"],
    ["/bank/accounts/", "/bank/accounts/42", "/42"],
    ["", "/anything", "/anything"],
  ])("basename %p, адрес %p → %p", (basename, pathname, path) => {
    expect(pathInBasename(basename, pathname)).toBe(path);
  });

  test("адрес вне basename — null: ремоут показан не на своей странице", () => {
    expect(pathInBasename("/accounts", "/")).toBeNull();
    expect(pathInBasename("/accounts", "/accountsx")).toBeNull();
    expect(pathInBasename("/bank/accounts", "/bank/")).toBeNull();
  });
});
