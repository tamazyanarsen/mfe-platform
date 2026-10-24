import { defineRemoteConfig } from "@mfe-platform/rsbuild";

export default defineRemoteConfig({ name: "payments", port: 3002, kits: ["@rwcjs/ui"] });
