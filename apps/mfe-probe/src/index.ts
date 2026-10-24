import { createRoot } from "@rwcjs/core";
import { register } from "./entry";
import { probeView } from "./view";

// Самостоятельный запуск ремоута, без хоста.
register();
document.body.append(createRoot(() => probeView()));
