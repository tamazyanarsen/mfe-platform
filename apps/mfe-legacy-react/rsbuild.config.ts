import { defineRemoteConfig } from "@mfe-platform/rsbuild";
import { pluginReact } from "@rsbuild/plugin-react";

// React не шарится между ремоутами: изоляция важнее размера.
export default defineRemoteConfig({
  name: "legacy",
  port: 3003,
  extend: { plugins: [pluginReact()] },
});
