import { CONTRACT_VERSION, type RemoteManifest } from "@mfe-platform/contract";

// Лёгкий модуль без React: хост читает его, не загружая код ремоута.
export const manifest: RemoteManifest = {
  contractVersion: CONTRACT_VERSION,
  name: "legacy",
  version: __MFE_REMOTE_VERSION__,
  tag: "mfe-legacy-react",
  routes: ["/legacy", "/legacy/*"],
  extra: { team: "reports", owner: "reports-team@bank.example", stack: "react" },
};
