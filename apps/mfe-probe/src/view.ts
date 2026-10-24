import type { PlatformState } from "@mfe/contract";
import { configCustomComponent, css, defineComponent, div, h2 } from "@rwcjs/core";
import { rwcButton } from "@rwcjs/ui";
import { KIT_VERSION } from "./kit";

class ProbeView extends defineComponent({
  props: { basename: "", platform: null as PlatformState | null },
  styles: css`
    :host { display: block; font-family: system-ui, sans-serif }
  `,
}) {
  render() {
    return div(
      h2("Probe"),
      rwcButton({ attrs: { "data-testid": "probe-button" } }, `kit ${KIT_VERSION}`),
    );
  }
}

export const [probeView, registerProbeView] = configCustomComponent(ProbeView, "mfe-probe");
