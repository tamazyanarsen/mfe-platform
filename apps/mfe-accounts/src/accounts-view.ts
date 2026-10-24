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

interface Account {
  readonly id: string;
  readonly title: string;
  /** Сумма — строка-десятичное: деньги не хранятся в number. */
  readonly balance: string;
  readonly currency: string;
}

const ACCOUNTS: readonly Account[] = [
  { id: "40817810000000000001", title: "Текущий счёт", balance: "125430.17", currency: "RUB" },
  { id: "40817840000000000002", title: "Валютный счёт", balance: "2300.00", currency: "USD" },
];

const formEntries = (element: HTMLFormElement) =>
  [...new FormData(element)].map(([key, value]) => `${key}=${String(value)}`).join("&");

class AccountsView extends defineComponent({
  // Префикс маршрутов ремоута; хост передаёт его атрибутом.
  props: { basename: "", platform: null as PlatformState | null },
  styles: css`
    :host { display: block; font-family: system-ui, sans-serif }
    .title { display: flex; gap: 8px; align-items: center }
    ul { list-style: none; padding: 0; margin: 0 }
    li { display: flex; align-items: center; gap: 16px; padding: 8px 0; border-bottom: 1px solid #e5e7eb }
    li > :first-child { flex: 1 }
    li.selected { font-weight: 600 }
    .balance { font-variant-numeric: tabular-nums }
    .actions, form { display: flex; gap: 8px; align-items: end; margin-top: 16px }
  `,
}) {
  render() {
    const topUp = signal("");

    // basename читается при подключении: outlet выставляет его до вставки элемента.
    const basename = this.props.basename.peek();
    const home = (): HTMLElement =>
      div(
        div(
          { class: "title" },
          h2("Счета"),
          rwcBadge(
            { ".variant": "accent", attrs: { "data-testid": "kit-version" } },
            `kit ${KIT_VERSION}`,
          ),
        ),
        ul(
          {},
          each(
            () => ACCOUNTS,
            (account): HTMLElement =>
              li(
                {
                  attrs: { "data-testid": "account" },
                  // Выбранный счёт приходит из общего стора хоста свойством platform.
                  class: {
                    selected: () => this.props.platform()?.selected?.accountId === account().id,
                  },
                },
                router.link({ to: `/${account.peek().id}` }, () => account().title),
                span({ class: "balance" }, () => `${account().balance} ${account().currency}`),
                rwcButton(
                  {
                    ".size": "sm",
                    "@press": () =>
                      bus.publish("account:selected", {
                        accountId: account.peek().id,
                        title: account.peek().title,
                      }),
                  },
                  "Выбрать",
                ),
              ),
            (account) => account.id,
          ),
        ),
        div(
          { class: "actions" },
          rwcTooltip(
            {},
            // Чужой маршрут: просим хост, историю сами не трогаем.
            rwcButton(
              {
                ".variant": "primary",
                "@press": () => this.dispatchEvent(navigateEvent("/payments/new")),
              },
              "Новый платёж",
            ),
            span({ attrs: { slot: "content" } }, "Перевод в разделе платежей"),
          ),
        ),
        h3("Пополнение"),
        form(
          {
            attrs: { "data-testid": "accounts-form" },
            "@submit": (event) => {
              event.preventDefault();
              topUp.set(formEntries(event.currentTarget));
            },
          },
          rwcInput({ attrs: { name: "amount" }, ".placeholder": "Сумма" }),
          rwcButton({ ".type": "submit" }, "Пополнить"),
        ),
        output({ attrs: { "data-testid": "accounts-form-result" } }, topUp),
      );
    const router = createRouter(
      {
        "/": home,
        "/:id": ({ params }): HTMLElement => {
          const account = () => ACCOUNTS.find((a) => a.id === params().id);
          return div(
            { attrs: { "data-testid": "account-details" } },
            h2(() => account()?.title ?? "Счёт не найден"),
            p(() => (account() ? `${account()?.balance} ${account()?.currency}` : "")),
            router.link({ to: "/" }, "← Все счета"),
          );
        },
        "*": () => p("Раздел счетов не найден"),
      },
      { base: basename },
    );
    onMount(() => () => router.dispose());
    // Адрес вне basename — ремоут показан не на своей странице (обзор хоста): стартовая
    // страница, а не чужой путь, сопоставленный маршрутам ремоута.
    return pathInBasename(basename) === null ? home() : router.view();
  }
}

export const [accountsView, registerAccountsView] = configCustomComponent(
  AccountsView,
  "mfe-accounts",
);
