import { createBus } from "@mfe/bus";

/** Шина платформы: общий узел — document, поэтому она общая с хостом и другими ремоутами. */
export const bus = createBus();
