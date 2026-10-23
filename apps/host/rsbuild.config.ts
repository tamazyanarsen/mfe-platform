import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  plugins: [
    pluginModuleFederation({
      name: "host",
      // Ремоуты регистрируются в рантайме из src/remotes.ts — одно место конфигурации.
      remotes: {},
      shared: {},
      dts: false,
    }),
  ],
  server: { port: 3000, strictPort: true, cors: { origin: /^http:\/\/localhost:\d+$/ } },
  html: { title: "MFE platform — host" },
});
