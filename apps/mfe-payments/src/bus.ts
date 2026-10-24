import { createBus } from "@mfe-platform/bus";

/** Шина платформы: общий узел — document, поэтому она общая с хостом и другими ремоутами. */
export const bus = createBus();
