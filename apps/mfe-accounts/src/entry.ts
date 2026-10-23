import type { RemoteModule } from "@mfe/contract";
import { registerAccountsView } from "./accounts-view";
import { registerKit } from "./kit";

export { manifest } from "./manifest";

// Повторный вызов безопасен: реестр и rwc не регистрируют теги второй раз.
export const register: RemoteModule["register"] = () => {
  registerKit();
  registerAccountsView();
};
