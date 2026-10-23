import type { ObservabilityTransport, PlatformEvent } from "@mfe/contract";

/** Пишет события в консоль браузера. Ошибки — через console.error, остальное — debug. */
export const consoleTransport: ObservabilityTransport = {
  send(event) {
    const log = event.type === "mount:error" ? console.error : console.debug;
    log(`[mfe] ${event.type} ${event.name}`, event);
  },
};

export interface MemoryTransport extends ObservabilityTransport {
  /** События в порядке поступления, не больше `capacity` последних. */
  events(): PlatformEvent[];
  clear(): void;
}

/** Кольцевой буфер в памяти: последние `capacity` событий. */
export const createMemoryTransport = (capacity = 500): MemoryTransport => {
  const buffer: PlatformEvent[] = [];
  return {
    send(event) {
      buffer.push(event);
      if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
    },
    events: () => [...buffer],
    clear: () => {
      buffer.length = 0;
    },
  };
};

/** Раздаёт событие нескольким приёмникам; падение одного не мешает остальным. */
export const combineTransports = (
  ...transports: readonly ObservabilityTransport[]
): ObservabilityTransport => ({
  send(event) {
    for (const transport of transports) {
      try {
        transport.send(event);
      } catch (error) {
        console.error("[mfe] transport failed", error);
      }
    }
  },
});
