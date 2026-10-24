import { CONTRACT_VERSION, type RemoteManifest } from "@mfe/contract";

// Лёгкий модуль без фреймворка: хост читает его, не загружая код ремоута.
export const manifest: RemoteManifest = {
  contractVersion: CONTRACT_VERSION,
  name: "probe",
  version: __MFE_REMOTE_VERSION__,
  tag: "mfe-probe",
  routes: ["/probe", "/probe/*"],
  extra: { team: "probe" },
};
