import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type PlatformEvent, type PlatformState, patchEvent } from "@mfe/contract";
import {
  DEFAULT_STORE_ACCESS,
  filterPatch,
  listenStorePatches,
  type StoreAccess,
  validateStoreAccess,
} from "../src";

const session = { userId: "u-2", name: "Мэллори" };

describe("filterPatch", () => {
  const access: StoreAccess = { "*": ["selected", "theme"], auth: ["session"] };

  test("общие поля доступны всем, свои — только своему ремоуту", () => {
    expect(filterPatch(access, "accounts", { theme: "dark", session })).toEqual({
      allowed: { theme: "dark" },
      denied: ["session"],
    });
    expect(filterPatch(access, "auth", { theme: "dark", session })).toEqual({
      allowed: { theme: "dark", session },
      denied: [],
    });
  });

  test("анонимная просьба получает только общие поля", () => {
    expect(filterPatch<PlatformState>(access, null, { locale: "en-US", theme: "dark" })).toEqual({
      allowed: { theme: "dark" },
      denied: ["locale"],
    });
  });

  test("по умолчанию сессию не меняет никто", () => {
    expect(filterPatch(DEFAULT_STORE_ACCESS, "accounts", { session }).denied).toEqual(["session"]);
    expect(filterPatch(DEFAULT_STORE_ACCESS, "accounts", { locale: "en-US" }).denied).toEqual([]);
  });
});

describe("validateStoreAccess", () => {
  test("форма прав из конфигурации", () => {
    expect(validateStoreAccess({ "*": ["theme"], auth: ["session"] })).toEqual([]);
    expect(validateStoreAccess([])).toHaveLength(1);
    expect(validateStoreAccess({ auth: "session", cards: [1] })).toEqual([
      'storeAccess["auth"] must be a list of field names',
      'storeAccess["cards"] must be a list of field names',
    ]);
  });
});

describe("listenStorePatches", () => {
  let dispose = () => {};
  afterEach(() => {
    dispose();
    document.body.replaceChildren();
  });

  /** outlet с ремоутом внутри; элемент ремоута — с shadow root, как у настоящих ремоутов. */
  const remote = (name: string) => {
    const outlet = document.createElement("test-store-outlet");
    outlet.setAttribute("remote", name);
    const element = document.createElement("div");
    const inner = document.createElement("button");
    element.attachShadow({ mode: "open" }).append(inner);
    outlet.append(element);
    document.body.append(outlet);
    return inner;
  };

  const start = () => {
    const applied: Array<[Partial<PlatformState>, string | null]> = [];
    const events: PlatformEvent[] = [];
    dispose = listenStorePatches<PlatformState>({
      access: { "*": ["theme"], auth: ["session"] },
      outletTag: "test-store-outlet",
      apply: (patch, from) => applied.push([patch, from]),
      transport: { send: (event) => events.push(event) },
    });
    return { applied, events };
  };

  test("ремоут определяется по outlet, даже из shadow DOM; запрет уходит в транспорт", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const { applied, events } = start();

    remote("accounts").dispatchEvent(patchEvent({ theme: "dark", session }));
    remote("auth").dispatchEvent(patchEvent({ session }));

    expect(applied).toEqual([
      [{ theme: "dark" }, "accounts"],
      [{ session }, "auth"],
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "store:denied",
      name: "accounts",
      details: { fields: ["session"] },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("событие не из ремоута — анонимная просьба; целиком запрещённая ничего не применяет", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const { applied, events } = start();
    document.body.dispatchEvent(patchEvent({ session }));
    expect(applied).toEqual([]);
    expect(events[0]?.name).toBe("unknown");
    warn.mockRestore();
  });

  test("после отключения события не обрабатываются", () => {
    const { applied } = start();
    dispose();
    remote("auth").dispatchEvent(patchEvent({ session }));
    expect(applied).toEqual([]);
  });
});
