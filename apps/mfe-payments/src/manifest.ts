import { CONTRACT_VERSION, type RemoteManifest } from "@mfe/contract";

// Лёгкий модуль без rwc: хост читает его, не загружая код ремоута.
export const manifest: RemoteManifest = {
  contractVersion: CONTRACT_VERSION,
  version: __MFE_REMOTE_VERSION__,
  name: "payments",
  tag: "mfe-payments",
  routes: ["/payments", "/payments/*"],
  requires: { "@rwcjs/ui": `^${__MFE_KIT_VERSIONS__["@rwcjs/ui"]}` },
  extra: { team: "payments", owner: "payments-team@bank.example" },
};
