import type { RemoteModule } from "@mfe/contract";
import { registerKit } from "./kit";
import { registerPaymentsView } from "./payments-view";

export { manifest } from "./manifest";

export const register: RemoteModule["register"] = () => {
  registerKit();
  registerPaymentsView();
};
