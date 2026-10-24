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
      // Хост отдаёт свой рантайм MF ремоутам: в production они его не везут
      // (sharedRuntime в @mfe-platform/rsbuild).
      experiments: { provideExternalRuntime: true },
    }),
  ],
  server: {
    port: 3000,
    strictPort: true,
    cors: { origin: /^http:\/\/localhost:\d+$/ },
    // Префикс пути, если хост развёрнут не в корне сайта: MFE_BASE=/mfe-platform/ (демо).
    base: process.env.MFE_BASE ?? "/",
  },
  html: { title: "MFE platform — host" },
});
