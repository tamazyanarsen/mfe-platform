import { describe, expect, spyOn, test } from "bun:test";
import type { PlatformEvent } from "@mfe-platform/contract";
import { combineTransports, consoleTransport, createMemoryTransport } from "../src";

const event = (type: PlatformEvent["type"], name = "accounts"): PlatformEvent => ({
  type,
  name,
  time: 0,
});

describe("транспорты", () => {
  test("консоль: ошибки монтирования — console.error, остальное — console.debug", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const debug = spyOn(console, "debug").mockImplementation(() => {});
    consoleTransport.send(event("mount:error"));
    consoleTransport.send(event("mount:ready"));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe("[mfe] mount:error accounts");
    expect(debug).toHaveBeenCalledTimes(1);
    error.mockRestore();
    debug.mockRestore();
  });

  test("кольцевой буфер хранит последние capacity событий и очищается", () => {
    const memory = createMemoryTransport(2);
    for (const name of ["a", "b", "c"]) memory.send(event("mount:start", name));
    expect(memory.events().map((e) => e.name)).toEqual(["b", "c"]);
    // events() отдаёт копию: снаружи буфер не испортить.
    memory.events().length = 0;
    expect(memory.events()).toHaveLength(2);
    memory.clear();
    expect(memory.events()).toEqual([]);
  });

  test("combineTransports раздаёт событие всем, упавший приёмник не мешает остальным", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const first = createMemoryTransport();
    const second = createMemoryTransport();
    const combined = combineTransports(
      first,
      {
        send() {
          throw new Error("down");
        },
      },
      second,
    );
    combined.send(event("mount:ready"));
    expect(first.events()).toHaveLength(1);
    expect(second.events()).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
