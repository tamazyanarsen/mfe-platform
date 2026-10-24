import type { RemoteModule } from "@mfe/contract";
import { registerKit } from "./kit";
import { manifest } from "./manifest";
import { registerProbeView } from "./view";

export { manifest };

// Повторный вызов безопасен: реестр и rwc не регистрируют теги второй раз.
export const register: RemoteModule["register"] = () => {
  registerKit();
  registerProbeView();
};
