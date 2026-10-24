import { describe, expect, test } from "bun:test";
import config from "../public/platform.config.json";
import { validatePlatformConfig } from "../src/remotes";

const valid = {
  remotes: [{ name: "accounts", entry: "https://cdn.bank.example/accounts/mf-manifest.json" }],
  nav: [{ href: "/accounts", title: "Счета" }],
  overview: [{ remote: "accounts", basename: "/accounts" }],
};

describe("validatePlatformConfig", () => {
  test("конфигурация стенда валидна", () => {
    expect(validatePlatformConfig(config)).toEqual([]);
  });

  test("минимальная конфигурация и права на стор", () => {
    expect(validatePlatformConfig(valid)).toEqual([]);
    expect(
      validatePlatformConfig({ ...valid, storeAccess: { "*": ["theme"], auth: ["session"] } }),
    ).toEqual([]);
  });

  test("перечисляет все проблемы сразу", () => {
    expect(
      validatePlatformConfig({
        remotes: [{ name: "credit-cards", entry: "x", integrity: "md5-1" }],
        nav: [{ href: "/" }],
        overview: "all",
        storeAccess: { auth: "session" },
      }),
    ).toEqual([
      "remotes[0].name must be an identifier",
      'remotes[0].integrity must be an SRI hash like "sha384-…"',
      "nav must be a list of {href, title}",
      "overview must be a list of {remote, basename}",
      'storeAccess["auth"] must be a list of field names',
    ]);
    expect(validatePlatformConfig(null)).toEqual(["config is not an object"]);
  });
});
