import { register } from "./entry";

// Самостоятельный запуск ремоута, без хоста.
register();
document.body.append(document.createElement("mfe-legacy-react"));
