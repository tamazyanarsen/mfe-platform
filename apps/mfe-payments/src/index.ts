import { createRoot } from "@rwcjs/core";
import { register } from "./entry";
import { paymentsView } from "./payments-view";

// Самостоятельный запуск ремоута, без хоста.
register();
document.body.append(createRoot(() => paymentsView()));
