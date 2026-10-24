import { subscribeInRender } from "@mfe-platform/adapter-rwc";
import { navigateEvent, type PlatformState, pathInBasename } from "@mfe-platform/contract";
import {
  configCustomComponent,
  css,
  defineComponent,
  div,
  each,
  form,
  h2,
  h3,
  li,
  nav,
  onMount,
  output,
  p,
  signal,
  span,
  ul,
} from "@rwcjs/core";
import { createRouter } from "@rwcjs/router";
import { rwcBadge, rwcButton, rwcInput, rwcTooltip } from "@rwcjs/ui";
import { bus } from "./bus";
import { KIT_VERSION } from "./kit";

interface Payment {
  readonly id: string;
  readonly to: string;
  readonly amount: string;
}

const PAYMENTS: readonly Payment[] = [
  { id: "p-1", to: "ООО «Ромашка»", amount: "15000.00" },
  { id: "p-2", to: "ИП Иванов", amount: "780.50" },
];

const formEntries = (element: HTMLFormElement) =>
  [...new FormData(element)].map(([key, value]) => `${key}=${String(value)}`).join("&");

class PaymentsView extends defineComponent({
  props: { basename: "", platform: null as PlatformState | null },
  styles: css`
    :host { display: block; font-family: system-ui, sans-serif }
    nav { display: flex; gap: 12px; align-items: center; margin-bottom: 12px }
    a[aria-current="page"] { font-weight: 600 }
    .title { display: flex; gap: 8px; align-items: center }
    ul { list-style: none; padding: 0 }
    li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb }
    form { display: flex; gap: 8px; align-items: end }
  `,
}) {
  render() {
    const quick = signal("");
    const notice = signal("");
    // Разовое уведомление из шины; подписка умирает вместе с компонентом.
    subscribeInRender(bus, "account:selected", ({ title }) => notice.set(`Выбран счёт: ${title}`));

    const basename = this.props.basename.peek();
    const home = () =>
      div(
        div(
          { class: "title" },
          h2("Платежи"),
          rwcBadge(
            { ".variant": "accent", attrs: { "data-testid": "kit-version" } },
            `kit ${KIT_VERSION}`,
          ),
        ),
        ul(
          {},
          each(
            () => PAYMENTS,
            (payment) =>
              li(
                { attrs: { "data-testid": "payment" } },
                span(() => payment().to),
                span(() => `${payment().amount} RUB`),
              ),
            (payment) => payment.id,
          ),
        ),
        h3("Быстрый платёж"),
        p(
          { attrs: { "data-testid": "debit-account" } },
          () => `Счёт списания: ${this.props.platform()?.selected?.title ?? "не выбран"}`,
        ),
        form(
          {
            attrs: { "data-testid": "payments-form" },
            "@submit": (event) => {
              event.preventDefault();
              quick.set(formEntries(event.currentTarget));
            },
          },
          rwcInput({ attrs: { name: "amount" }, ".placeholder": "Сумма" }),
          rwcInput({ attrs: { name: "to" }, ".placeholder": "Получатель" }),
          rwcButton({ ".type": "submit", ".variant": "primary" }, "Отправить"),
        ),
        output({ attrs: { "data-testid": "payments-form-result" } }, quick),
      );
    const router = createRouter(
      {
        "/": home,
        "/new": () =>
          div({ attrs: { "data-testid": "payment-form" } }, h2("Новый платёж"), p("Форма платежа")),
        "*": () => p("Раздел платежей не найден"),
      },
      { base: basename },
    );
    onMount(() => () => router.dispose());

    return [
      nav(
        router.link({ to: "/", exact: true }, "Список"),
        router.link({ to: "/new" }, "Создать"),
        rwcTooltip(
          {},
          rwcButton(
            {
              ".variant": "ghost",
              "@press": () => this.dispatchEvent(navigateEvent("/accounts")),
            },
            "К счетам",
          ),
          span({ attrs: { slot: "content" } }, "Раздел счетов"),
        ),
      ),
      p({ attrs: { "aria-live": "polite", "data-testid": "payments-notice" } }, notice),
      // Адрес вне basename — ремоут показан не на своей странице (обзор хоста): стартовая
      // страница, а не чужой путь, сопоставленный маршрутам ремоута.
      pathInBasename(basename) === null ? home() : router.view(),
    ];
  }
}

export const [paymentsView, registerPaymentsView] = configCustomComponent(
  PaymentsView,
  "mfe-payments",
);
