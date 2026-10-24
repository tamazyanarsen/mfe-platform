import { expect, test } from "bun:test";
import { checkRemote } from "@mfe/testing";
import * as entry from "../src/entry";
import { manifest } from "../src/manifest";

test("legacy (React) соответствует контракту платформы", async () => {
  expect(await checkRemote(entry, { manifest })).toEqual([]);
});
