import { describe, expect, test } from "bun:test";
import { sharedByLine } from "../src/shared";

describe("sharedByLine", () => {
  test("каждый пакет делится по своей линии совместимости и не как singleton", () => {
    expect(sharedByLine({ "@rwcjs/ui": "0.1.2", "@rwcjs/core": "3.3.1" })).toEqual({
      "@rwcjs/ui": { version: "0.1.2", requiredVersion: "^0.1.2", singleton: false },
      "@rwcjs/core": { version: "3.3.1", requiredVersion: "^3.3.1", singleton: false },
    });
  });

  test.each([
    // [версия ремоута, версия у соседа, делят ли]
    ["0.1.0", "0.1.4", true],
    ["0.1.0", "0.2.0", false],
    ["0.2.0-next.0", "0.2.0-next.3", true],
    ["0.2.0-next.0", "0.1.9", false],
    ["3.3.1", "3.9.0", true],
    ["3.3.1", "4.0.0", false],
  ])("линия %s и сосед %s: общий экземпляр — %p", (own, other, shared) => {
    const { requiredVersion } = sharedByLine({ kit: own }).kit ?? { requiredVersion: "" };
    // Линия совпадает с постфиксом реестра: v0-<minor> для 0.x, v<major> с 1.0.
    expect(Bun.semver.satisfies(other, requiredVersion)).toBe(shared);
  });
});
