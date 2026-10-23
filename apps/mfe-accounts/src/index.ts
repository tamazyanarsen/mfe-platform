import { createRoot } from "@rwcjs/core";
import { accountsView } from "./accounts-view";
import { register } from "./entry";

// Самостоятельный запуск ремоута, без хоста.
register();
document.body.append(createRoot(() => accountsView()));
