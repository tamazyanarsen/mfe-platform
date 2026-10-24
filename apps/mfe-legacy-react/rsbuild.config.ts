import { pluginReact } from "@rsbuild/plugin-react";
import { defineRemoteConfig } from "../../config/rsbuild-remote";

// React не шарится между ремоутами: изоляция важнее размера.
export default defineRemoteConfig({
  name: "legacy",
  port: 3003,
  extend: { plugins: [pluginReact()] },
});
