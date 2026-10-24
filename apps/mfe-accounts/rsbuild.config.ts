import { defineRemoteConfig } from "@mfe-platform/rsbuild";

export default defineRemoteConfig({ name: "accounts", port: 3001, kits: ["@rwcjs/ui"] });
