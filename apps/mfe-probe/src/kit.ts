import { useKit } from "@mfe/adapter-rwc";
import * as ui from "@rwcjs/ui";
import { manifest } from "./manifest";

export const KIT = "@rwcjs/ui";
export const KIT_VERSION = __MFE_KIT_VERSIONS__[KIT] ?? "0.0.0";

/** Кит регистрируется через реестр платформы: постфикс по версии, учёт, политики. */
export const registerKit = () =>
  useKit({ name: KIT, version: KIT_VERSION, consumer: manifest.name, kit: ui, control: ui.Button });
