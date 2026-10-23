import { defineRemoteConfig } from "../../config/rsbuild-remote";

export default defineRemoteConfig({ name: "payments", port: 3002, kits: ["@rwcjs/ui"] });
