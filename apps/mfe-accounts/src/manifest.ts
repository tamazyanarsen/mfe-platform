import { CONTRACT_VERSION, type RemoteManifest } from "@mfe-platform/contract";

// Лёгкий модуль без rwc: хост читает его, не загружая код ремоута.
export const manifest: RemoteManifest = {
  contractVersion: CONTRACT_VERSION,
  version: __MFE_REMOTE_VERSION__,
  name: "accounts",
  tag: "mfe-accounts",
  routes: ["/accounts", "/accounts/*"],
  requires: { "@rwcjs/ui": `^${__MFE_KIT_VERSIONS__["@rwcjs/ui"]}` },
  extra: { team: "accounts", owner: "accounts-team@bank.example" },
};
