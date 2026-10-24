import { defineRemoteConfig } from "@mfe-platform/rsbuild";

// Чтобы подключить UI-кит, добавьте его в kits: версия попадёт в реестр платформы.
export default defineRemoteConfig({ name: "probe", port: 3004, kits: ["@rwcjs/ui"] });
