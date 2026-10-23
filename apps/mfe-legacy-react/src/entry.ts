import { registerReactElement } from "@mfe/adapter-react";
import type { RemoteModule } from "@mfe/contract";
import { Reports } from "./reports";

export { manifest } from "./manifest";

export const register: RemoteModule["register"] = () => {
  registerReactElement("mfe-legacy-react", Reports as never, {
    props: ["basename", "platform"],
    events: { onNavigate: "platform:navigate" },
  });
};
