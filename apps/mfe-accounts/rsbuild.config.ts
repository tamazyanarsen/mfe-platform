import { defineRemoteConfig } from "../../config/rsbuild-remote";

export default defineRemoteConfig({ name: "accounts", port: 3001, kits: ["@rwcjs/ui"] });
