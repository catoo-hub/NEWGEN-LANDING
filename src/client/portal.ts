import { formatEvent } from "../shared/events";
import {
  workTypes,
  type Role,
  type Quote,
  type OrderStatus,
  type Payment,
  type Withdrawal,
} from "../shared/types";
type Me = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  member: { id: string; available: boolean } | null;
};
const root = document.querySelector<HTMLElement>("#portal")!;
const lang = root.dataset.lang === "en" ? "en" : "ru",
  ru = lang === "ru";
const t = (r: string, e: string) => (ru ? r : e);
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (n: number) =>
  new Intl.NumberFormat(ru ? "ru-RU" : "en-US", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(n / 100);
const date = (s: string | null) =>
  s ? new Date(s).toLocaleString(ru ? "ru-RU" : "en-GB") : "—";
const statuses: Record<OrderStatus, string> = {
  application: t("Новая заявка", "New application"),
  briefing: t("Согласование ТЗ", "Briefing"),
  assigning: t("Ожидает исполнителя", "Awaiting performer"),
  quoted: t("Предложение цены", "Quote ready"),
  awaiting_payment: t("Ожидает оплаты", "Awaiting payment"),
  paid_waiting_start: t(
    "Ожидает разрешения на начало",
    "Awaiting authorization to start",
  ),
  in_progress: t("В работе", "In progress"),
  review: t("Проверка финала", "Final review"),
  revision: t("Правки", "Revision"),
  completed: t("Завершён", "Completed"),
  cancel_requested: t("Запрошена отмена", "Cancellation requested"),
  canceled: t("Отменён", "Canceled"),
  payment_review: t("Проверка оплаты", "Payment review"),
  refunded: t("Возврат", "Refunded"),
};
const errors: Record<string, string> = {
  ALREADY_ASSIGNED: t(
    "Исполнитель уже назначен. Сначала снимите назначение с указанием причины.",
    "A performer is already assigned. Release the assignment with a reason first.",
  ),
  USE_ADDITIONAL_APPLICATION: t(
    "Дополнительную стоимость нужно согласовать отдельной заявкой.",
    "Agree additional charges in a separate application.",
  ),
  ACCOUNT_DISABLED: t(
    "Аккаунт заблокирован. Свяжитесь с командой.",
    "Account disabled. Contact the team.",
  ),
  ORDER_CLOSED: t(
    "Заказ закрыт; обсудите дальнейшие действия с модератором.",
    "The order is closed; discuss further action with a moderator.",
  ),
  DEADLINE_PAST: t(
    "Укажите будущую дату завершения.",
    "Choose a future delivery date.",
  ),
  QUOTE_INCOMPLETE: t(
    "Заполните ТЗ, состав результата, цену и срок.",
    "Complete the brief, deliverables, price and deadline.",
  ),
  REPLACEMENT_CONSENT_REQUIRED: t(
    "Сначала согласуйте замену предпочтительного исполнителя с клиентом.",
    "Agree replacement of the preferred performer with the client first.",
  ),
  PERFORMER_REQUIRED: t(
    "Нужен подтверждённый исполнитель с настроенным процентом.",
    "A confirmed performer with a configured share is required.",
  ),
  EMPTY_MESSAGE: t("Напишите сообщение.", "Enter a message."),
  REASON_REQUIRED: t(
    "Укажите основание решения.",
    "Provide a reason for the decision.",
  ),

  LOGIN_REQUIRED: t("Войдите в аккаунт", "Please sign in"),
  VERIFY_EMAIL: t(
    "Подтвердите почту по ссылке в письме",
    "Verify your email using the link in your inbox",
  ),
  EMAIL_NOT_VERIFIED: t(
    "Подтвердите почту по ссылке в письме",
    "Please verify your email",
  ),
  FORBIDDEN: t("Нет доступа к этому действию", "Access denied"),
  SETUP_REQUIRED: t(
    "Сервер кабинета ещё не настроен. Нужны база данных и настройки авторизации.",
    "The account server needs its database and authentication configuration.",
  ),
  SERVER_ERROR: t(
    "Не удалось выполнить действие. Попробуйте позже.",
    "Unable to complete this action. Try again later.",
  ),
  VALIDATION_ERROR: t(
    "Проверьте заполненные поля",
    "Please check the form fields",
  ),
  PROFILE_INCOMPLETE: t(
    "Администратор должен задать специализацию и процент",
    "Ask the administrator to configure your specialization and share",
  ),
  MUSIC_REQUIRED: t(
    "Укажите музыку или напишите, что нужна помощь с выбором",
    "Provide music or request help choosing it",
  ),
  INVALID_STATE: t(
    "Заказ уже изменился. Обновите страницу.",
    "The order has changed. Refresh the page.",
  ),
  ASSIGNMENT_EXPIRED: t(
    "Назначение истекло. Нужен повторный подбор.",
    "Assignment expired. A new assignment is needed.",
  ),
  QUOTE_EXPIRED: t(
    "Предложение истекло или изменилось",
    "The quote expired or changed",
  ),
  REVISION_LIMIT: t(
    "Два раунда уже использованы. Обсудите дополнительную заявку с модератором.",
    "Both rounds have been used. Discuss additional work with the moderator.",
  ),
  INSUFFICIENT_BALANCE: t(
    "Недостаточно доступных средств",
    "Insufficient available balance",
  ),
  PAYMENT_PENDING: t(
    "Платёж уже создан. Его статус нужно проверить в Robokassa.",
    "A payment has already been created. Check its status in Robokassa.",
  ),
  PAYMENT_SETUP_REQUIRED: t(
    "Рабочая оплата ещё не настроена",
    "Live payments are not configured",
  ),
  PORTFOLIO_PERMISSION_REQUIRED: t(
    "Нужно отдельное разрешение клиента на публикацию",
    "Separate client permission is required",
  ),
  UNSUPPORTED_FILE: t(
    "Формат файла не поддерживается или не совпадает с расширением",
    "Unsupported file format or incorrect extension",
  ),
  FILE_TOO_LARGE_OR_EMPTY: t(
    "Файл пустой или больше 1 ГБ",
    "File is empty or exceeds 1 GB",
  ),
  ORDER_STORAGE_LIMIT: t(
    "Достигнут лимит материалов заказа: 20 ГБ",
    "Order storage limit reached: 20 GB",
  ),
  PAID_ASSIGNMENT_LOCKED: t(
    "Оплаченный заказ нельзя переназначить без согласования",
    "Paid assignments require agreement before replacement",
  ),
  INVALID_INVITATION: t(
    "Приглашение истекло, использовано или предназначено другой почте",
    "Invitation expired, used, or belongs to a different email",
  ),
  OWNER_PROTECTED: t(
    "Аккаунт владельца защищён",
    "The owner account is protected",
  ),
};
let me: Me | null = null,
  catalog: any,
  current = "orders",
  selected: string | null = null,
  detailState: any = null,
  busy = false,
  poll: ReturnType<typeof setInterval> | undefined;
const content = document.querySelector<HTMLElement>("#content")!;
function notice(message: string) {
  const n = document.querySelector<HTMLElement>("#notice")!;
  n.textContent = message;
  n.hidden = false;
  setTimeout(() => {
    n.hidden = true;
  }, 8000);
}
async function api(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const [route, query] = path.split("?");
  const response = await fetch(
    "/api/" + route.replace(/\/$/, "") + "/" + (query ? "?" + query : ""),
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "SERVER_ERROR");
  return json;
}
const error = (e: unknown) =>
  notice(
    errors[(e as Error).message] ||
      t("Не удалось выполнить действие: ", "Unable to complete action: ") +
        (e as Error).message,
  );
const button = (label: string, action: string, cls = "secondary") =>
  `<button type="button" class="button ${cls}" data-action="${esc(action)}">${label}</button>`;
const field = (
  label: string,
  name: string,
  value = "",
  type = "text",
  required = false,
) =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${type === "number" ? 'step="0.01" min="0"' : ""}/></label>`;
const area = (label: string, name: string, value = "", required = false) =>
  `<label class="full">${label}<textarea name="${name}" ${required ? "required" : ""}>${esc(value)}</textarea></label>`;
const heading = (title: string, action = "") =>
  `<div class="page-heading"><div><p class="eyebrow">RE:STATIC / ${esc(current.toUpperCase())}</p><h1>${title}</h1></div>${action}</div>`;
const badge = (status: string) =>
  `<span class="badge ${status === "completed" ? "green" : ["payment_review", "cancel_requested"].includes(status) ? "red" : ["quoted", "awaiting_payment", "assigning"].includes(status) ? "orange" : ""}">${esc(statuses[status as OrderStatus] || status)}</span>`;
const empty = (text: string) => `<div class="empty">${text}</div>`;
const parseLines = (value: FormDataEntryValue | null) =>
  String(value || "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
function authView(kind = "login") {
  document.querySelector<HTMLElement>("#workspace")!.hidden = true;
  const panel = document.querySelector<HTMLElement>("#auth")!;
  panel.hidden = false;
  const title =
    {
      login: t("С возвращением.", "Welcome back."),
      signup: t("Начнём работу.", "Let’s create."),
      forgot: t("Восстановить доступ", "Recover access"),
      reset: t("Новый пароль", "New password"),
    }[kind] || "";
  panel.innerHTML = `<p class="eyebrow">RE:STATIC TEAM / ACCESS</p><h1>${title}</h1><p class="muted">${t("Заказы, переписка и результаты — в одном месте.", "Orders, conversations and deliveries in one place.")}</p><form data-form="auth" data-kind="${kind}">${kind === "signup" ? field(t("Имя или псевдоним", "Name or nickname"), "name", "", "text", true) : ""}${kind !== "reset" ? field("Email", "email", "", "email", true) : ""}${kind !== "forgot" ? field(t("Пароль (от 12 символов)", "Password (12 characters minimum)"), "password", "", "password", true) : ""}${kind === "signup" ? `<p class="legal-inline">${t("Данные аккаунта обрабатываются согласно", "Account data is processed according to our")} <a href="/${lang}/privacy/">${t("политике конфиденциальности", "privacy notice")}</a>.</p>` : ""}<button class="button">${t("Продолжить", "Continue")} ↗</button></form><div class="auth-links"><button data-auth="login">${t("Войти", "Sign in")}</button><button data-auth="signup">${t("Создать аккаунт", "Create account")}</button><button data-auth="forgot">${t("Забыли пароль?", "Forgot password?")}</button></div>`;
}
function nav() {
  const staff = me!.roles.some((r) => r === "moderator" || r === "admin"),
    admin = me!.roles.includes("admin");
  const items = [
    ["orders", t("Мои заказы", "My orders")],
    ["new", t("Создать заявку", "New application")],
    ["works", t("Работы команды", "Portfolio")],
    ["prices", t("Цены", "Prices")],
    ["team", t("Команда", "Team")],
    ["notifications", t("Уведомления", "Notifications")],
    ["settings", t("Безопасность", "Security")],
  ];
  if (me!.roles.includes("performer"))
    items.push(
      ["assigned", t("Заказы на меня", "Assigned orders")],
      ["finance", t("Мой заработок", "My earnings")],
    );
  if (staff) items.push(["queue", t("Модерация", "Moderation")]);
  if (admin)
    items.push(
      ["roster", t("Управление командой", "Manage team")],
      ["portfolio", t("Управление работами", "Manage portfolio")],
      ["rates", t("Управление ценами", "Manage prices")],
      ["users", t("Пользователи", "Users")],
      ["payouts", t("Финансы и выплаты", "Finance & payouts")],
      ["audit", t("Журнал действий", "Audit log")],
    );
  document.querySelector("#navigation")!.innerHTML = items
    .map(
      ([key, label]) =>
        `<button type="button" data-nav="${key}" class="${key === current ? "active" : ""}">${label}</button>`,
    )
    .join("");
  document.querySelector("#identity")!.textContent = me!.name;
  document.querySelector<HTMLElement>("#signout")!.hidden = false;
}
async function navigate(page: string) {
  current = page;
  selected = null;
  detailState = null;
  const url = new URL(location.href);
  url.searchParams.delete("order");
  history.replaceState(null, "", url);
  nav();
  content.innerHTML = empty(t("Загрузка…", "Loading…"));
  try {
    await renderPage();
  } catch (e) {
    error(e);
    content.innerHTML = empty(
      t("Не удалось загрузить раздел", "Unable to load this section"),
    );
  }
}
async function renderPage() {
  catalog = await api("catalog");
  if (["orders", "assigned", "queue"].includes(current)) {
    const mode =
      current === "assigned"
        ? "performer"
        : current === "queue"
          ? "staff"
          : "customer";
    const list = await api("orders?mode=" + mode);
    content.innerHTML =
      heading(
        current === "queue"
          ? t("Очередь заявок", "Applications queue")
          : current === "assigned"
            ? t("Ваши назначения", "Your assignments")
            : t("Мои заказы", "My orders"),
        current === "orders"
          ? button(t("Новая заявка", "New application"), "new", "")
          : "",
      ) +
      (current === "assigned"
        ? `<div class="panel split"><div><h3>${t("Доступность для новых заказов", "Availability for new orders")}</h3><p class="muted">${t("Одновременно — один заказ.", "One active order at a time.")}</p></div><label class="check"><input type="checkbox" id="availability" ${me!.member?.available ? "checked" : ""}/> ${t("Принимаю заказы", "Accepting orders")}</label></div><div class="spacer"></div>`
        : "") +
      (list.length
        ? `<div class="grid">${list.map((o: any) => `<button class="order-card" data-order="${o.id}"><div class="split"><span class="eyebrow">${esc(o.type)}</span>${badge(o.status)}</div><h3>${esc(o.title)}</h3><div class="meta"><span>#${o.id.slice(0, 8)}</span><span>${date(o.createdAt)}</span></div></button>`).join("")}</div>`
        : empty(t("Здесь пока нет заказов.", "No orders here yet.")));
    return;
  }
  if (current === "new") {
    content.innerHTML =
      heading(t("Расскажите об идее.", "Tell us your idea.")) +
      `<form class="panel form-grid" data-form="new">${field(t("Страна проживания или регистрации", "Country of residence or registration"), "country", "", "text", true)}${field(t("Название заказа", "Order title"), "title", "", "text", true)}<label>${t("Тип работы", "Work type")}<select name="type">${workTypes.map((v) => `<option>${v}</option>`).join("")}</select></label><label class="full">${t("Предпочтительный исполнитель", "Preferred performer")}<select name="preferredMemberId"><option value="">${t("Подобрать случайно", "Choose randomly")}</option>${catalog.members
        .filter((m: any) => m.available)
        .map(
          (m: any) =>
            `<option value="${m.id}" data-types="${m.types.join(",")}">${esc(m.name)} · ${m.types.join(" / ")}</option>`,
        )
        .join(
          "",
        )}</select></label>${area(t("Техническое задание", "Brief"), "brief", "", true)}${area(t("Описание и пожелания", "Description and preferences"), "description")}${area(t("Музыка: ссылка, название или помощь с выбором", "Music: link, title or help choosing"), "music")}${area(t("Ссылки на материалы (по одной на строку)", "Material links (one per line)"), "links")}<p class="muted full">${t("Файлы можно прикрепить сразу после создания заявки. Цена и срок согласуются с модератором до оплаты.", "Attach files after creating the application. Price and deadline are agreed with a moderator before payment.")}</p><button class="button full">${t("Отправить заявку", "Send application")} ↗</button></form>`;
    filterPreferred();
    return;
  }
  if (current === "works") {
    content.innerHTML =
      heading(t("Работы команды", "Team portfolio")) +
      `<div class="grid">${catalog.projects.map((p: any) => `<article class="panel"><div data-portfolio-player="${esc(p.id)}"></div><p class="eyebrow">${esc(p.platform)}</p><h3><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)} ↗</a></h3></article>`).join("")}</div>`;
    for (const p of catalog.projects)
      mountPlayer(
        content.querySelector(`[data-portfolio-player="${CSS.escape(p.id)}"]`)!,
        p.src,
        p.poster,
        p.title,
        ["GFX", "LOGO"].includes(p.platform),
      );
    return;
  }
  if (current === "prices") {
    content.innerHTML =
      heading(t("Цены", "Prices")) +
      `<p class="muted">${t("Окончательную цену модератор устанавливает после согласования ТЗ. Два раунда правок включены.", "A moderator sets the final price after agreeing the brief. Two revision rounds are included.")}</p><div class="grid">${catalog.rates.map((r: any) => `<div class="panel"><p class="eyebrow">${r.type}</p><div class="big-price">${r.amount ? t("от ", "from ") + money(r.amount) : t("По согласованию", "On request")}</div><p class="muted">${esc(ru ? r.descriptionRu : r.descriptionEn)}</p>${button(t("Создать заявку", "Create application"), "new")}</div>`).join("")}</div>`;
    return;
  }
  if (current === "team") {
    content.innerHTML =
      heading(t("Наши участники", "Our team")) +
      `<div class="grid">${catalog.members.map((m: any) => `<div class="panel roster-card"><div class="split"><span class="eyebrow">/${esc(m.id)}</span><span class="badge ${m.available ? "green" : ""}">${m.available ? t("Открыт к заказам", "Available") : t("Недоступен", "Unavailable")}</span></div><div class="roster-initial" aria-hidden="true">${esc(m.name.slice(0, 2))}</div><h3><a href="${esc(m.link)}" target="_blank" rel="noopener noreferrer">${esc(m.name)} ↗</a></h3><p class="muted">${esc(m.role)}</p></div>`).join("")}</div>`;
    return;
  }
  if (current === "notifications") {
    const items = await api("notifications");
    content.innerHTML =
      heading(
        t("Уведомления", "Notifications"),
        button(t("Прочитать все", "Mark all read"), "read_notifications"),
      ) +
      (items.length
        ? `<div class="stack">${items.map((n: any) => `<div class="panel split"><div><p>${esc(eventText(n.body))}</p><small class="muted">${date(n.createdAt)} ${n.readAt ? "" : " · " + t("Новое", "New")}</small></div>${n.orderId ? `<button class="button secondary" data-order="${n.orderId}">${t("Открыть", "Open")}</button>` : ""}</div>`).join("")}</div>`
        : empty(t("Пока нет уведомлений", "No notifications yet")));
    return;
  }
  if (current === "settings") {
    content.innerHTML =
      heading(t("Безопасность", "Security")) +
      `<div class="panel"><h3>${esc(me!.email)}</h3><p class="muted">${t("Подтверждённая почта используется для восстановления доступа и уведомлений.", "Your verified email is used for recovery and notifications.")}</p><div class="actions">${button(t("Отправить ссылку смены пароля", "Send password reset link"), "reset_link")}${button(t("Выйти на всех устройствах", "Sign out on all devices"), "revoke_sessions", "danger")}</div></div>`;
    return;
  }
  if (current === "finance") {
    const f = await api("finance");
    content.innerHTML =
      heading(t("Мой заработок", "My earnings")) +
      (f.test
        ? `<p class="badge orange">${t("Тестовые начисления — реальные деньги не переводятся", "Test balances — no real money transfers")}</p><div class="spacer"></div>`
        : "") +
      `<div class="metrics">${[
        [t("Доступно", "Available"), f.available],
        [t("Ожидает приёмки", "Awaiting acceptance"), f.expected],
        [t("Зарезервировано", "Reserved"), f.reserved],
        [t("Выплачено", "Paid out"), f.paidOut],
      ]
        .map(
          ([k, v]) =>
            `<div class="metric"><span>${k}</span><strong>${money(v as number)}</strong></div>`,
        )
        .join(
          "",
        )}</div><form class="panel form-grid" data-form="withdrawal">${field(t("Сумма, ₽", "Amount, RUB"), "amount", "", "number", true)}${area(t("Реквизиты для перевода (без полных данных карты)", "Transfer details (do not enter full card credentials)"), "details", "", true)}<button class="button full">${t("Запросить вывод", "Request withdrawal")}</button></form><div class="spacer"></div><div class="panel table-wrap"><h3>${t("История выводов", "Withdrawal history")}</h3><table><tbody>${f.withdrawals.map((w: Withdrawal) => `<tr><td>${date(w.createdAt)}</td><td>${money(w.amount)}</td><td>${esc(itemLabel(w.status))}</td><td>${esc(w.reference || "")}</td></tr>`).join("")}</tbody></table><h3>${t("Начисления", "Ledger")}</h3><table><tbody>${f.ledger.map((l: any) => `<tr><td>${date(l.createdAt)}</td><td>${esc(itemLabel(l.reason))}</td><td>${money(l.amount)}</td><td>${l.orderId ? `<button class="link-button" data-order="${l.orderId}">#${l.orderId.slice(0, 8)}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
    return;
  }
  await renderAdmin();
}
function mountPlayer(
  container: Element,
  src: string,
  poster: string,
  title: string,
  image = false,
) {
  if (image || /\.(png|jpe?g|webp|gif)$/i.test(src)) {
    container.innerHTML = `<img class="portfolio-cover" src="${esc(src)}" alt="${esc(title)}"/>`;
    return;
  }
  const template =
    document.querySelector<HTMLTemplateElement>("#player-template")!;
  const clone = template.content.cloneNode(true) as DocumentFragment;
  const video = clone.querySelector("video")!;
  video.src = src;
  video.poster = poster;
  video.setAttribute("aria-label", title);
  clone.querySelector("restatic-player")!.setAttribute("aria-label", title);
  container.replaceChildren(clone);
}
const eventText = (value: string) => formatEvent(value, lang);
async function openOrder(id: string) {
  selected = id;
  const u = new URL(location.href);
  u.searchParams.set("order", id);
  history.replaceState(null, "", u);
  content.innerHTML = empty(t("Загрузка заказа…", "Loading order…"));
  await loadDetail(true);
}
async function loadDetail(full = false) {
  if (!selected) return;
  const d = await api("orders/" + selected);
  const previous = detailState;
  if (!full && previous?.order.id === d.order.id) {
    const messages = new Map(
      [...previous.messages, ...d.messages].map((m: any) => [m.id, m]),
    );
    d.messages = [...messages.values()];
  }
  detailState = d;
  if (
    !full &&
    previous &&
    (previous.order.updatedAt !== d.order.updatedAt ||
      previous.files.length !== d.files.length ||
      JSON.stringify(
        previous.quotes.map((q: Quote) => [q.id, q.obsolete, q.acceptedAt]),
      ) !==
        JSON.stringify(
          d.quotes.map((q: Quote) => [q.id, q.obsolete, q.acceptedAt]),
        ))
  ) {
    const editing =
      [
        ...content.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input:not([type=hidden]),textarea",
        ),
      ].some((el) => el.value !== el.defaultValue) ||
      content.querySelector("video")?.currentTime;
    if (!editing) full = true;
    else
      notice(
        t(
          "В заказе есть изменения. Нажмите «Обновить» после отправки сообщения.",
          "Order updated. Select Refresh after sending your message.",
        ),
      );
  }
  if (full) {
    renderDetail(d);
    if (!d.permissions.prepay)
      void api("orders/" + selected, { action: "read" }).catch(() => {});
  } else {
    const chat = content.querySelector("#chat-messages");
    if (chat) {
      const signature = d.messages.map((m: any) => m.id).join(",");
      if (chat.getAttribute("data-signature") !== signature) {
        chat.innerHTML = messagesHtml(d.messages);
        chat.setAttribute("data-signature", signature);
        chat.scrollTop = chat.scrollHeight;
        void api("orders/" + selected, { action: "read" }).catch(() => {});
      }
    }
    const status = content.querySelector("#live-status");
    if (status) status.innerHTML = badge(d.order.status);
  }
}
function messagesHtml(list: any[]) {
  return list.length
    ? list
        .map(
          (m) =>
            `<div class="message ${m.internal ? "internal" : ""}"><div class="meta"><span>${esc(m.author)}${m.internal ? " · " + t("Внутреннее", "Internal") : ""}${m.kind !== "message" ? " · " + esc(m.kind) : ""}</span><time>${date(m.createdAt)}</time></div><p>${esc(m.kind.startsWith("replacement_") ? t("Исполнитель: ", "Performer: ") + (catalog.members.find((member: any) => member.id === m.body)?.name || m.body) : m.body)}</p>${m.links.map((l: string) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l)} ↗</a>`).join("<br/>")}${m.kind === "replacement_proposal" && detailState.permissions.customer ? button(t("Одобрить замену", "Approve replacement"), "approve_replacement").replace('data-action="approve_replacement"', 'data-action="approve_replacement" data-proposal="' + esc(m.id) + '"') : ""}</div>`,
        )
        .join("")
    : empty(t("Начните обсуждение заказа", "Start the order conversation"));
}
function renderDetail(d: any) {
  const o = d.order,
    p = d.permissions,
    q = d.quotes.find((v: Quote) => !v.obsolete),
    agreed = d.quotes.find((v: Quote) => v.acceptedAt),
    active = ["in_progress", "review", "revision"].includes(o.status);
  content.innerHTML =
    heading(esc(o.title), `<span id="live-status">${badge(o.status)}</span>`) +
    `<div class="actions">${button(t("← К списку", "← Back to list"), "back")}${button(t("Обновить", "Refresh"), "refresh")}</div><div class="spacer"></div><div class="order-layout"><div class="stack"><section class="panel"><p class="eyebrow">${esc(o.type)} / #${o.id.slice(0, 8)}</p><h3>${t("Техническое задание", "Brief")}</h3><p class="details">${esc(o.brief)}</p>${o.country ? `<p class="muted">${t("Страна: ", "Country: ")}${esc(o.country)}</p>` : ""}${o.description ? `<h3>${t("Описание", "Description")}</h3><p class="details">${esc(o.description)}</p>` : ""}${o.music ? `<h3>${t("Музыка", "Music")}</h3><p class="details">${esc(o.music)}</p>` : ""}${o.links?.length ? `<h3>${t("Материалы", "Materials")}</h3>${o.links.map((l: string) => `<p><a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l)} ↗</a></p>`).join("")}` : ""}</section>${!p.prepay ? `<section class="panel"><h3>${t("Переписка", "Conversation")}</h3>${d.messages.length >= 200 ? button(t("Загрузить ранние сообщения", "Load earlier messages"), "older_messages") : ""}<div id="chat-messages" class="chat-messages" data-signature="${d.messages.map((m: any) => m.id).join(",")}">${messagesHtml(d.messages)}</div><form class="chat-form" data-form="message">${area(t("Сообщение", "Message"), "body", "", true)}<div class="actions"><button class="button">${t("Отправить", "Send")}</button>${p.staff || p.performer ? `<label class="check"><input type="checkbox" name="internal"/>${t("Только команде", "Team only")}</label>` : ""}</div></form></section><section class="panel"><h3>${t("Файлы и версии", "Files and versions")}</h3><div class="file-list">${d.files.map((f: any) => `<div><p class="eyebrow">${esc(itemLabel(f.kind))} · ${(f.size / 1048576).toFixed(1)} MB</p>${f.mime.startsWith("video/") ? `<div data-file-player="${f.id}"></div>` : f.mime.startsWith("image/") ? `<img src="/api/files/${f.id}/" alt="${esc(f.name)}" loading="lazy"/>` : f.mime.startsWith("audio/") ? `<audio src="/api/files/${f.id}/" controls preload="none"></audio>` : ""}<a href="/api/files/${f.id}/" target="_blank" rel="noopener">${esc(f.name)} ↓</a></div>`).join("") || `<p class="muted">${t("Файлов пока нет", "No files yet")}</p>`}</div>${!["completed", "canceled", "refunded"].includes(o.status) ? `<div class="spacer"></div><form data-form="upload"><label>${t("Файл до 1 ГБ", "File up to 1 GB")}<input name="file" type="file" required accept=".mp4,.mov,.webm,.mp3,.wav,.ogg,.m4a,.flac,.jpg,.jpeg,.png,.webp,.gif,.pdf,.zip,.7z,.rar,.docx,.txt"/></label>${p.performer || p.staff ? `<label>${t("Версия", "Version")}<select name="kind">${p.staff ? `<option value="source">${t("Материалы", "Source")}</option>` : ""}<option value="preview">${t("Превью", "Preview")}</option><option value="final">${t("Финал", "Final")}</option></select></label>` : ""}<div class="spacer"></div><button class="button secondary">${t("Загрузить", "Upload")}</button><progress class="upload-progress" max="100" value="0" hidden></progress></form>` : ""}</section>` : `<section class="panel"><p class="muted">${t("Переписка и полные материалы откроются после оплаты. Сейчас можно подтвердить или отклонить назначение.", "Conversation and complete materials become available after payment. You can accept or decline the assignment now.")}</p></section>`}</div><div class="stack"><section class="panel"><h3>${t("Детали заказа", "Order details")}</h3><dl class="definition"><div><dt>${t("ИСПОЛНИТЕЛЬ", "PERFORMER")}</dt><dd>${esc(d.member?.name || "—")}</dd></div><div><dt>${t("ОПЛАТА", "PAYMENT")}</dt><dd>${date(o.paidAt)}</dd></div><div><dt>${t("СРОК", "DEADLINE")}</dt><dd>${date(agreed?.deadline || q?.deadline)}</dd></div><div><dt>${t("ПРАВКИ", "REVISIONS")}</dt><dd>${o.revisionRounds ?? 0} / 2</dd></div></dl></section>${q ? `<section class="panel"><p class="eyebrow">${q.amendment ? t("ИЗМЕНЕНИЕ УСЛОВИЙ", "AMENDMENT") : t("ПРЕДЛОЖЕНИЕ", "QUOTE")}</p><div class="big-price">${money(q.amount)}</div><h3>${t("ТЗ предложения", "Proposed brief")}</h3><p class="details">${esc(q.brief)}</p><h3>${t("Состав результата", "Deliverables")}</h3><p class="details">${esc(q.deliverables)}</p><p class="muted">${t("Предлагаемый срок", "Proposed deadline")}: ${date(q.deadline)}</p><p class="muted">${t("Действует до", "Valid until")} ${date(q.expiresAt)}<br/>${t("Два раунда правок включены", "Two revision rounds included")}${q.shareBps !== undefined ? "<br/>" + t("Доля исполнителя: ", "Performer share: ") + q.shareBps / 100 + "%" : ""}</p>${p.customer && !q.acceptedAt ? `<form data-form="accept_quote"><label class="check"><input type="checkbox" name="terms" required/> <span>${t("Принимаю ТЗ, цену, срок и", "I accept the brief, price, deadline and")} <a href="/api/orders/${o.id}/terms/?quote=${q.id}" target="_blank">${t("оферту", "terms")}</a>.</span></label>${!q.amendment ? `<div class="spacer"></div><label class="check"><input type="checkbox" name="startRequested"/><span>${t("Отдельно прошу начать работу после оплаты. Это не отменяет мои законные права на отказ и возврат.", "I separately request that work start after payment. This does not waive my statutory withdrawal or refund rights.")}</span></label><p class="muted">${t("Без этого запроса начало отдельно согласуется с модератором с учётом применимого срока отказа.", "Without this request, the moderator separately agrees the start, taking any applicable withdrawal period into account.")}</p>` : ""}<div class="spacer"></div><button class="button">${t("Подтвердить условия", "Accept terms")}</button>${q.amendment ? button(t("Отклонить изменение", "Reject amendment"), "reject_amendment") : ""}</form>` : ""}${p.customer && o.status === "awaiting_payment" ? button(t("Оплатить через Robokassa", "Pay with Robokassa"), "pay", "") : ""}<details><summary>${t("История предложений", "Quote history")}</summary>${d.quotes.map((v: any) => `<p class="muted">${money(v.amount)} · ${date(v.createdAt)}<br/>${esc(v.brief)}<br/>${esc(v.deliverables)}<br/>${date(v.deadline)} · ${v.acceptedAt ? t("Принято", "Accepted") : t("Не принято", "Not accepted")} · <a href="/api/orders/${o.id}/terms/?quote=${v.id}">${t("Скачать условия", "Download terms")}</a></p>`).join("")}</details></section>` : ""}${p.customer && o.status === "paid_waiting_start" ? `<section class="panel"><p>${t("Заказ оплачен. Начало работы ещё не согласовано.", "The order is paid. The work start has not been agreed yet.")}</p>${button(t("Отдельно прошу начать работу", "I separately request work to start"), "start_work", "")}</section>` : ""}${!q && d.quotes.length ? `<section class="panel"><h3>${t("История предложений", "Quote history")}</h3>${d.quotes.map((v: Quote) => `<p>${money(v.amount)} · ${date(v.createdAt)}<br/><a href="/api/orders/${o.id}/terms/?quote=${v.id}">${t("Скачать условия", "Download terms")}</a></p>`).join("")}</section>` : ""}${p.performer && o.status === "assigning" ? `<section class="panel"><h3>${t("Принять заказ?", "Accept this order?")}</h3><div class="actions">${button(t("Принять", "Accept"), "accept_assignment", "")}${button(t("Отказаться", "Decline"), "decline_assignment")}</div></section>` : ""}${(p.performer || p.staff) && active ? `<section class="panel"><h3>${t("Отправить версию", "Submit a version")}</h3><form data-form="delivery"><label>${t("Тип", "Type")}<select name="action"><option value="preview">${t("Превью", "Preview")}</option><option value="final">${t("Финал", "Final")}</option></select></label>${area(t("Комментарий к версии", "Version notes"), "body", "", true)}${area(t("Ссылки на файлы (по одной на строку)", "File links (one per line)"), "links")}<p class="muted">${t("Загруженные файлы доступны клиенту в блоке файлов. Отправка финала переводит заказ на проверку.", "Uploaded files are available in the files section. Submitting a final moves the order to review.")}</p><button class="button">${t("Отправить версию", "Submit version")}</button></form></section>` : ""}${p.customer && active ? `<section class="panel"><h3>${t("Проверка работы", "Review the work")}</h3>${o.status === "review" ? button(t("Принять финал", "Accept final"), "complete", "") : ""}${o.status !== "revision" && o.revisionRounds < 2 ? `<div class="spacer"></div><form data-form="revision">${area(t("Единый список правок", "Consolidated revision notes"), "body", "", true)}<div class="spacer"></div><button class="button secondary">${t("Отправить правки", "Request revisions")}</button></form>` : ""}</section>` : ""}${p.customer && o.paidAt && ["in_progress", "review", "revision", "completed"].includes(o.status) ? `<details class="panel"><summary>${t("Сообщить о несоответствии ТЗ", "Report a brief mismatch")}</summary><form data-form="defect">${area(t("Что не соответствует согласованному ТЗ", "Describe the mismatch with the agreed brief"), "body", "", true)}<p class="muted">${t("Модератор проверит замечания. Исправление подтверждённого несоответствия не расходует творческие раунды правок.", "A moderator will review your report. Correcting a confirmed mismatch does not consume creative revision rounds.")}</p><button class="button secondary">${t("Отправить модератору", "Send to moderator")}</button></form></details>` : ""}${p.customer ? `<section class="panel"><label class="check"><input type="checkbox" id="portfolio-consent" ${o.portfolioConsent ? "checked" : ""}/> ${t("Разрешаю отдельно опубликовать эту работу в портфолио RE:STATIC", "I separately allow publishing this work in RE:STATIC’s portfolio")}</label><p class="muted">${t("Это не условие заказа. Разрешение можно отозвать.", "This is optional and can be withdrawn.")}</p></section>` : ""}${p.staff ? staffForms(o, q) : ""}${p.customer && !["completed", "canceled", "refunded", "cancel_requested"].includes(o.status) ? `<details class="panel"><summary>${t("Запросить отмену", "Request cancellation")}</summary><form data-form="cancel_request">${area(t("Причина", "Reason"), "body", "", true)}<button class="button secondary">${t("Отправить запрос", "Send request")}</button></form></details>` : ""}${!p.prepay ? `<section class="panel"><h3>${t("История событий", "Activity")}</h3><ul class="timeline">${d.events.map((e: any) => `<li>${esc(eventText(e.action))}<br/>${date(e.createdAt)}</li>`).join("")}</ul></section>` : ""}</div></div>`;
  for (const f of d.files)
    if (f.mime.startsWith("video/"))
      mountPlayer(
        content.querySelector(`[data-file-player="${f.id}"]`)!,
        "/api/files/" + f.id + "/",
        "",
        f.name,
      );
  const chat = content.querySelector("#chat-messages");
  if (chat) chat.scrollTop = chat.scrollHeight;
}
function staffForms(o: any, q: any) {
  return `<section class="panel"><h3>${t("Модерация", "Moderation")}</h3>${
    !o.paidAt && !o.memberId && ["application", "briefing"].includes(o.status)
      ? `<form data-form="assign"><label>${t("Назначение", "Assignment")}<select name="memberId"><option value="">${t("Случайный доступный участник", "Random available member")}</option>${catalog.members
          .filter((m: any) => m.types.includes(o.type))
          .map(
            (m: any) =>
              `<option value="${m.id}">${esc(m.name)} · ${m.available ? t("свободен", "available") : t("занят / закрыт", "busy / unavailable")}</option>`,
          )
          .join(
            "",
          )}</select></label><label class="check"><input name="replacementApproved" type="checkbox"/>${t("Предложить замену предпочтительного исполнителя клиенту", "Propose replacing the preferred performer to the client")}</label><div class="spacer"></div><button class="button secondary">${t("Запустить подбор", "Assign performer")}</button></form>`
      : ""
  }${o.memberId && ((!o.paidAt && o.status === "briefing") || (o.paidAt && ["paid_waiting_start", "in_progress", "review", "revision"].includes(o.status))) ? `<details><summary>${o.paidAt ? t("Предложить изменение ТЗ / срока", "Propose brief / deadline amendment") : t("Выставить предложение", "Create quote")}</summary><form data-form="quote" data-amend="${!!o.paidAt}">${area(t("Согласованное ТЗ", "Agreed brief"), "brief", q?.brief || o.brief, true)}${area(t("Состав результата", "Deliverables"), "deliverables", q?.deliverables || "", true)}${field(t("Цена, ₽", "Price, RUB"), "amount", q ? (q.amount / 100).toString() : "", "number", true)}${field(t("Дедлайн", "Deadline"), "deadline", "", "datetime-local", true)}<p class="muted">${t("Цена оплаченного заказа не меняется. Дополнительный объём оформляется отдельной заявкой.", "The paid price remains fixed. Additional scope uses a separate application.")}</p><button class="button">${t("Отправить предложение", "Send quote")}</button></form></details>` : ""}${o.status === "paid_waiting_start" ? `<details><summary>${t("Разрешить начало работы", "Authorize work start")}</summary><form data-form="start_work">${area(t("Основание: отдельный запрос клиента или истечение применимого срока отказа", "Grounds: separate client request or expiry of the applicable withdrawal period"), "body", "", true)}<button class="button">${t("Зафиксировать начало", "Record work start")}</button></form></details>` : ""}${!o.paidAt && o.memberId ? `<details><summary>${t("Снять назначение", "Release assignment")}</summary><form data-form="release_assignment">${area(t("Причина", "Reason"), "body", "", true)}<button class="button secondary">${t("Освободить исполнителя", "Release performer")}</button></form></details>` : ""}${o.paidAt && ["in_progress", "review", "revision"].includes(o.status) ? `<details><summary>${t("Исправление несоответствия ТЗ", "Correct a brief mismatch")}</summary><form data-form="correction">${area(t("Подтверждённое несоответствие и необходимые исправления", "Confirmed mismatch and required corrections"), "body", "", true)}<button class="button secondary">${t("Назначить исправление без списания раунда", "Request correction without consuming a round")}</button></form></details>` : ""}${!o.paidAt ? `<details><summary>${t("Отменить неоплаченную заявку", "Cancel unpaid application")}</summary><form data-form="cancel">${area(t("Причина", "Reason"), "body", "", true)}<button class="button danger">${t("Отменить", "Cancel")}</button></form></details>` : ""}${detailState.permissions.admin && o.status === "review" ? `<details><summary>${t("Завершить вручную", "Complete manually")}</summary><form data-form="complete">${area(t("Основание решения", "Reason for decision"), "body", "", true)}<button class="button">${t("Зафиксировать завершение", "Record completion")}</button></form></details>` : ""}${detailState.permissions.admin && o.paidAt ? `<details><summary>${t("Зафиксировать возврат", "Record refund")}</summary><form data-form="refund">${field(t("Возвращённая сумма, ₽", "Refunded amount, RUB"), "amount", "", "number", true)}${field(t("Подтверждение возврата Robokassa", "Robokassa refund reference"), "reference", "", "text", true)}<p class="muted">${t("Сначала выполните возврат в Robokassa. Эта форма фиксирует уже проведённый возврат.", "Perform the refund in Robokassa first. This form records an already completed refund.")}</p><button class="button danger">${t("Зафиксировать", "Record")}</button></form></details>` : ""}</section>`;
}
async function renderAdmin() {
  const data = await api("admin/data");
  const typesChecks = (values: string[]) =>
    `<div class="full actions">${workTypes.map((type) => `<label class="check"><input type="checkbox" name="types" value="${type}" ${values.includes(type) ? "checked" : ""}/>${type}</label>`).join("")}</div>`;
  const memberOptions = `<option value="">—</option>${data.members.map((m: any) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}`;
  if (current === "roster") {
    content.innerHTML =
      heading(t("Команда", "Team management")) +
      `<details class="panel"><summary>${t("Пригласить участника", "Invite team member")}</summary><form class="form-grid" data-form="invite">${field("Email", "email", "", "email", true)}<label>${t("Профиль в ростере", "Roster profile")}<select name="memberId">${memberOptions}</select></label><div class="full actions">${["performer", "moderator", "admin"].map((r) => `<label class="check"><input type="checkbox" name="roles" value="${r}" ${r === "performer" ? "checked" : ""}/>${roleName(r)}</label>`).join("")}</div><button class="button full">${t("Отправить приглашение", "Send invitation")}</button></form></details><div class="spacer"></div><div class="stack">${data.members.map((m: any) => memberForm(m, typesChecks)).join("")}<details class="panel"><summary>+ ${t("Добавить участника", "Add member")}</summary>${memberForm({ id: crypto.randomUUID(), name: "", role: "", link: "https://www.instagram.com/", shareBps: null, types: [], active: true, position: data.members.length }, typesChecks, false)}</details></div>`;
    return;
  }
  if (current === "rates") {
    content.innerHTML =
      heading(t("Цены", "Price management")) +
      `<div class="stack">${data.rates.map((r: any) => `<form class="panel form-grid" data-form="rate"><h3 class="full">${r.type}</h3><input name="type" type="hidden" value="${r.type}"/>${field(t("Цена «от», ₽ (пусто — по согласованию)", "Starting price, RUB (empty = on request)"), "amount", r.amount ? (r.amount / 100).toString() : "", "number")}${area("Описание RU", "descriptionRu", r.descriptionRu)}${area("Description EN", "descriptionEn", r.descriptionEn)}<button class="button full">${t("Сохранить", "Save")}</button></form>`).join("")}</div>`;
    return;
  }
  if (current === "portfolio") {
    const portfolioForm = (p: any) =>
      `<form class="form-grid" data-form="portfolio"><input name="id" type="hidden" value="${esc(p.id)}"/>${field(t("Название", "Title"), "title", p.title, "text", true)}<label>${t("Категория", "Category")}<select name="platform">${workTypes.map((type) => `<option ${p.platform === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>${field(t("Ссылка на оригинал", "Original URL"), "url", p.url || "", "url", true)}${field(t("Видео / изображение", "Video / image path"), "src", p.src || "", "text", true)}${field(t("Обложка", "Cover path"), "poster", p.poster || "", "text", true)}<label>${t("Автор", "Author")}<select name="memberId">${memberOptions.replace(`value="${p.memberId}"`, `value="${p.memberId}" selected`)}</select></label>${field(t("ID заказа (если работа клиентская)", "Order ID (for client work)"), "orderId", p.orderId || "")}${field(t("Порядок", "Position"), "position", String(p.position || 0), "number")}<label class="check"><input type="checkbox" name="published" ${p.published ? "checked" : ""}/>${t("Опубликовано", "Published")}</label><button class="button full">${t("Сохранить", "Save")}</button></form>`;
    content.innerHTML =
      heading(t("Работы", "Portfolio management")) +
      `<section class="panel"><h3>${t("Загрузить видео или обложку", "Upload video or cover")}</h3><form data-form="media"><input type="file" name="file" required/><div class="spacer"></div><button class="button secondary">${t("Загрузить", "Upload")}</button><progress max="100" value="0" hidden class="upload-progress"></progress><p class="muted" id="media-path"></p></form></section><div class="spacer"></div><details class="panel"><summary>+ ${t("Добавить работу", "Add work")}</summary>${portfolioForm({ id: crypto.randomUUID(), platform: "AMV", published: false, position: data.portfolio.length })}</details><div class="spacer"></div><div class="stack">${data.portfolio.map((p: any) => `<details class="panel"><summary>${esc(p.title)} · ${p.published ? t("Опубликована", "Published") : t("Скрыта", "Hidden")}</summary>${portfolioForm(p)}</details>`).join("")}</div>`;
    return;
  }
  if (current === "users") {
    content.innerHTML =
      heading(t("Пользователи", "Users")) +
      `<div class="stack">${data.users.map((u: any) => `<form class="panel form-grid" data-form="user"><input type="hidden" name="id" value="${u.id}"/><h3 class="full">${esc(u.name)} · ${esc(u.email)}</h3><p class="muted full">${u.emailVerified ? t("Почта подтверждена", "Email verified") : t("Почта не подтверждена", "Email unverified")}</p><div class="full actions">${["customer", "performer", "moderator", "admin"].map((r) => `<label class="check"><input type="checkbox" name="roles" value="${r}" ${u.roles.includes(r) ? "checked" : ""}/> ${roleName(r)}</label>`).join("")}</div><label class="check"><input type="checkbox" name="disabled" ${u.disabled ? "checked" : ""}/> ${t("Заблокирован", "Disabled")}</label><button class="button full">${t("Сохранить", "Save")}</button></form>`).join("")}</div>`;
    return;
  }
  if (current === "payouts") {
    const f = await api("admin/finance");
    const paid = f.payments.filter(
      (p: Payment) => p.status === "paid" && !p.test,
    );
    const total = paid.reduce(
      (v: number, p: any) => v + p.amount - p.refundAmount,
      0,
    );
    content.innerHTML =
      heading(t("Финансы и выплаты", "Finance & payouts")) +
      `<div class="metrics"><div class="metric"><span>${t("Оплачено (без тестовых)", "Paid (excluding tests)")}</span><strong>${money(total)}</strong></div><div class="metric"><span>${t("Заявок на вывод", "Withdrawal requests")}</span><strong>${f.withdrawals.filter((w: Withdrawal) => w.status === "requested").length}</strong></div></div><div class="stack">${f.withdrawals.map((w: Withdrawal) => `<section class="panel"><div class="split"><h3>${esc(w.name)} · ${money(w.amount)}</h3><span class="badge">${esc(itemLabel(w.status))}${w.test ? " / TEST" : ""}</span></div><p class="details">${esc(w.details)}</p><p class="muted">${date(w.createdAt)} · ${esc(w.reference || "")}</p>${w.status === "requested" ? `<form class="form-grid" data-form="payout"><input type="hidden" name="id" value="${w.id}"/><label>${t("Решение", "Decision")}<select name="decision"><option value="paid">${t("Перевод выполнен", "Transfer completed")}</option><option value="rejected">${t("Отклонить", "Reject")}</option></select></label>${field(t("Подтверждение перевода / причина отказа", "Transfer reference / rejection reason"), "reference", "", "text", true)}<p class="muted full">${w.test ? t("Это тестовый вывод: не переводите реальные деньги.", "This is a test withdrawal: do not transfer real money.") : t("Отмечайте оплату только после фактического перевода.", "Mark paid only after the actual transfer.")}</p><button class="button full">${t("Зафиксировать решение", "Record decision")}</button></form>` : ""}</section>`).join("") || empty(t("Выводов пока нет", "No withdrawals yet"))}<section class="panel table-wrap"><h3>${t("Платежи", "Payments")}</h3><table><tbody>${f.payments.map((p: Payment) => `<tr><td>#${p.id}</td><td>${money(p.amount)}</td><td>${p.test ? "TEST" : "LIVE"}</td><td>${esc(itemLabel(p.status))}</td><td><button class="link-button" data-order="${p.orderId}">${p.orderId.slice(0, 8)}</button></td></tr>`).join("")}</tbody></table><h3>${t("Чеки зачёта", "Final receipts")}</h3><table><tbody>${f.receipts.map((r: any) => `<tr><td>#${r.id}</td><td>${esc(itemLabel(r.status))}</td><td>${esc(r.lastError || "")}${["submitted", "failed"].includes(r.status) ? `<form data-form="receipt"><input type="hidden" name="id" value="${r.id}"/><button class="button secondary">${t("Проверить в Robokassa", "Recheck with Robokassa")}</button></form>` : ""}</td></tr>`).join("")}</tbody></table></section></div>`;
    return;
  }
  if (current === "audit") {
    content.innerHTML =
      heading(t("Журнал действий", "Audit log")) +
      `<div class="panel table-wrap"><table><thead><tr><th>${t("Дата", "Date")}</th><th>${t("Действие", "Action")}</th><th>${t("Участник", "Actor")}</th><th>${t("Детали", "Details")}</th></tr></thead><tbody>${data.audit.map((v: any) => `<tr><td>${date(v.createdAt)}</td><td>${esc(eventText(v.action))}</td><td>${esc(v.actorId || "SYSTEM")}</td><td>${esc(JSON.stringify(v.details))}</td></tr>`).join("")}</tbody></table></div>`;
    return;
  }
}
function itemLabel(v: string) {
  return (
    (
      {
        paid: t("Выплачено / оплачено", "Paid"),
        pending: t("Ожидание", "Pending"),
        expired: t("Истекло", "Expired"),
        requested: t("Запрошено", "Requested"),
        rejected: t("Отклонено", "Rejected"),
        refunded: t("Возвращено", "Refunded"),
        preview: t("Превью", "Preview"),
        final: t("Финал", "Final"),
        source: t("Материалы", "Source"),
        revision: t("Правки", "Revision"),
        defect: t("Несоответствие ТЗ", "Brief mismatch"),
        cancellation: t("Отмена", "Cancellation"),
        replacement_proposal: t("Замена исполнителя", "Performer replacement"),
        completion: t("Начисление за заказ", "Order earnings"),
        withdrawal: t("Вывод", "Withdrawal"),
        refund: t("Корректировка возврата", "Refund adjustment"),
        test: t("Тестовый чек", "Test receipt"),
        submitted: t("Отправлен в Robokassa", "Submitted to Robokassa"),
        registered: t("Зарегистрирован", "Registered"),
        failed: t("Ошибка регистрации", "Registration failed"),
      } as Record<string, string>
    )[v] || v
  );
}
function roleName(r: string) {
  return (
    (
      {
        customer: t("Заказчик", "Customer"),
        performer: t("Исполнитель", "Performer"),
        moderator: t("Модератор", "Moderator"),
        admin: t("Администратор", "Administrator"),
      } as Record<string, string>
    )[r] || r
  );
}
function memberForm(m: any, typesChecks: (v: string[]) => string, wrap = true) {
  const form = `<form class="form-grid" data-form="member"><input type="hidden" name="id" value="${esc(m.id)}"/>${field(t("Имя", "Name"), "name", m.name, "text", true)}${field(t("Роль в команде", "Team title"), "role", m.role, "text", true)}${field(t("Социальный профиль", "Social profile"), "link", m.link, "url", true)}${field(t("Доля, % (пусто — не настроена)", "Share, % (empty = unset)"), "share", m.shareBps !== null ? String(m.shareBps / 100) : "", "number")}${field(t("Порядок", "Position"), "position", String(m.position), "number")}<label class="check"><input name="active" type="checkbox" ${m.active ? "checked" : ""}/>${t("Показывать в ростере", "Show in roster")}</label>${typesChecks(m.types)}<p class="muted full">${m.userId ? t("Аккаунт привязан", "Account linked") : t("Аккаунт ещё не привязан — отправьте приглашение", "No linked account yet — send an invitation")}</p><button class="button full">${t("Сохранить", "Save")}</button></form>`;
  return wrap
    ? `<details class="panel"><summary>${esc(m.name)} · ${esc(m.role)}</summary>${form}</details>`
    : form;
}
function filterPreferred() {
  const form = content.querySelector<HTMLFormElement>('[data-form="new"]');
  if (!form) return;
  const type = (form.elements.namedItem("type") as HTMLSelectElement).value;
  const select = form.elements.namedItem(
    "preferredMemberId",
  ) as HTMLSelectElement;
  for (const option of select.options)
    if (option.value) {
      option.hidden = !option.dataset.types?.split(",").includes(type);
      option.disabled = option.hidden;
    }
  if (select.selectedOptions[0]?.disabled) select.value = "";
}
async function uploadFile(form: HTMLFormElement, path: string) {
  const input = form.querySelector<HTMLInputElement>('input[type="file"]')!,
    file = input.files?.[0];
  if (!file) throw new Error("EMPTY_UPLOAD");
  if (file.size > 1024 ** 3) throw new Error("FILE_TOO_LARGE_OR_EMPTY");
  const progress = form.querySelector<HTMLProgressElement>("progress")!;
  progress.hidden = false;
  const fd = new FormData();
  fd.append("file", file);
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress.value = (e.loaded / e.total) * 100;
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("SERVER_ERROR"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || "SERVER_ERROR"));
    };
    xhr.onerror = () => reject(new Error("SERVER_ERROR"));
    xhr.send(fd);
  });
}
async function submit(form: HTMLFormElement) {
  const fd = new FormData(form),
    kind = form.dataset.form;
  const v = Object.fromEntries(fd) as Record<string, string>;
  if (kind === "auth") {
    const type = form.dataset.kind;
    const callbackURL =
      location.origin +
      `/${lang}/account/` +
      (new URLSearchParams(location.search).has("invite")
        ? "?invite=" +
          encodeURIComponent(
            new URLSearchParams(location.search).get("invite")!,
          )
        : "");
    const paths: Record<string, string> = {
      login: "sign-in/email",
      signup: "sign-up/email",
      forgot: "request-password-reset",
      reset: "reset-password",
    };
    const body =
      type === "forgot"
        ? {
            email: v.email,
            redirectTo: location.origin + `/${lang}/account/?reset=1`,
          }
        : type === "reset"
          ? {
              newPassword: v.password,
              token: new URLSearchParams(location.search).get("token"),
            }
          : type === "signup"
            ? {
                email: v.email,
                password: v.password,
                name: v.name,
                language: lang,
                callbackURL,
              }
            : { email: v.email, password: v.password, callbackURL };
    const response = await fetch("/api/auth/" + paths[type!] + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.code || data.message || "SERVER_ERROR");
    if (type === "login") {
      await init();
    } else {
      notice(
        type === "reset"
          ? t(
              "Пароль изменён. Можно войти.",
              "Password updated. You can sign in.",
            )
          : t(
              "Проверьте почту: отправлено письмо со ссылкой.",
              "Check your email for the link.",
            ),
      );
      if (type === "reset") authView("login");
    }
    return;
  }
  if (kind === "new") {
    const o = await api("orders", {
      ...v,
      links: parseLines(fd.get("links")),
      preferredMemberId: v.preferredMemberId || null,
      language: lang,
    });
    await openOrder(o.id);
    return;
  }
  if (kind === "upload") {
    const file = await uploadFile(
      form,
      `/api/orders/${selected}/files/?kind=${v.kind || "source"}`,
    );
    notice(t("Файл загружен: ", "Uploaded: ") + file.name);
    await loadDetail(true);
    return;
  }
  if (kind === "media") {
    const file = await uploadFile(form, "/api/media-upload/");
    form.querySelector("#media-path")!.textContent = file.publicSrc;
    notice(
      t(
        "Файл загружен. Скопируйте путь в карточку работы.",
        "Uploaded. Copy the path into the portfolio entry.",
      ),
    );
    return;
  }
  if (kind === "message") {
    await api("orders/" + selected, {
      action: "message",
      body: v.body,
      internal: fd.has("internal"),
    });
    (form.elements.namedItem("body") as HTMLTextAreaElement).value = "";
    await loadDetail(false);
    return;
  }
  if (kind === "assign") {
    await api("orders/" + selected, {
      action: "assign",
      memberId: v.memberId || undefined,
      replacementApproved: fd.has("replacementApproved"),
    });
    await loadDetail(true);
    return;
  }
  if (kind === "quote") {
    await api("orders/" + selected, {
      action: form.dataset.amend === "true" ? "amend" : "quote",
      brief: v.brief,
      deliverables: v.deliverables,
      amount: Math.round(Number(v.amount) * 100),
      deadline: new Date(v.deadline).toISOString(),
    });
    await loadDetail(true);
    return;
  }
  if (kind === "accept_quote") {
    const q = detailState.quotes.find((q: Quote) => !q.obsolete);
    await api("orders/" + selected, {
      action: "accept_quote",
      quoteId: q.id,
      termsAccepted: fd.has("terms"),
      startRequested: fd.has("startRequested"),
    });
    await loadDetail(true);
    return;
  }
  if (
    [
      "revision",
      "cancel",
      "cancel_request",
      "complete",
      "defect",
      "correction",
      "release_assignment",
      "start_work",
    ].includes(kind!)
  ) {
    await api("orders/" + selected, { action: kind, body: v.body });
    await loadDetail(true);
    return;
  }
  if (kind === "delivery") {
    await api("orders/" + selected, {
      action: v.action,
      body: v.body,
      links: parseLines(fd.get("links")),
    });
    await loadDetail(true);
    return;
  }
  if (kind === "refund") {
    await api("orders/" + selected + "/refund", {
      amount: Math.round(Number(v.amount) * 100),
      reference: v.reference,
    });
    await loadDetail(true);
    return;
  }
  if (kind === "withdrawal") {
    await api("withdrawals", {
      amount: Math.round(Number(v.amount) * 100),
      details: v.details,
    });
    await renderPage();
    return;
  }
  if (kind === "member") {
    await api("admin/members", {
      ...v,
      position: Number(v.position),
      shareBps: v.share === "" ? null : Math.round(Number(v.share) * 100),
      active: fd.has("active"),
      types: fd.getAll("types"),
    });
  }
  if (kind === "rate") {
    await api("admin/rates", {
      ...v,
      amount: v.amount ? Math.round(Number(v.amount) * 100) : null,
    });
  }
  if (kind === "portfolio") {
    await api("admin/portfolio", {
      ...v,
      position: Number(v.position),
      duration: 0,
      published: fd.has("published"),
      memberId: v.memberId || null,
      orderId: v.orderId || null,
    });
  }
  if (kind === "user") {
    await api("admin/users", {
      id: v.id,
      disabled: fd.has("disabled"),
      roles: fd.getAll("roles"),
    });
  }
  if (kind === "invite") {
    await api("admin/invite", {
      email: v.email,
      memberId: v.memberId || null,
      roles: fd.getAll("roles"),
    });
    notice(
      t(
        "Приглашение добавлено в очередь писем",
        "Invitation queued for email delivery",
      ),
    );
    return;
  }
  if (kind === "receipt") {
    await api("admin/receipts", { id: Number(v.id) });
  }
  if (kind === "payout") {
    await api("admin/withdrawals", v);
  }
  await renderPage();
  notice(t("Сохранено", "Saved"));
}
root.addEventListener("submit", async (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.dataset.form) return;
  event.preventDefault();
  if (busy) return;
  busy = true;
  const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")];
  buttons.forEach((b) => {
    b.disabled = true;
  });
  try {
    await submit(form);
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    buttons.forEach((b) => {
      b.disabled = false;
    });
  }
});
root.addEventListener("change", async (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === "type") filterPreferred();
  try {
    if (target.id === "availability") {
      await api("availability", { available: target.checked });
      me!.member!.available = target.checked;
      notice(t("Доступность обновлена", "Availability updated"));
    }
    if (target.id === "portfolio-consent") {
      await api("orders/" + selected, {
        action: "consent",
        portfolioConsent: target.checked,
      });
      notice(t("Разрешение обновлено", "Permission updated"));
    }
  } catch (e) {
    target.checked = !target.checked;
    error(e);
  }
});
root.addEventListener("click", async (event) => {
  const target = (event.target as Element).closest<HTMLElement>("button");
  if (!target) return;
  if (target.dataset.auth) {
    authView(target.dataset.auth);
    return;
  }
  if (target.dataset.nav) {
    await navigate(target.dataset.nav);
    return;
  }
  if (target.dataset.order) {
    try {
      await openOrder(target.dataset.order);
    } catch (e) {
      error(e);
    }
    return;
  }
  if (target.id === "signout") {
    await fetch("/api/auth/sign-out/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    location.reload();
    return;
  }
  const action = target.dataset.action;
  if (!action) return;
  if (busy) return;
  busy = true;
  try {
    if (action === "older_messages") {
      const older = await api(
        "orders/" + selected + "/messages?before=" + detailState.messages[0].id,
      );
      const seen = new Set(detailState.messages.map((m: any) => m.id));
      detailState.messages = [
        ...older.filter((m: any) => !seen.has(m.id)),
        ...detailState.messages,
      ];
      renderDetail(detailState);
      if (older.length < 200)
        content
          .querySelector<HTMLButtonElement>('[data-action="older_messages"]')
          ?.remove();
      return;
    }
    if (action === "new") {
      await navigate("new");
      return;
    }
    if (action === "back") {
      await navigate(current);
      return;
    }
    if (action === "refresh") {
      await loadDetail(true);
      return;
    }
    if (action === "read_notifications") {
      await api("notifications", {});
      await renderPage();
      return;
    }
    if (action === "reset_link") {
      await fetch("/api/auth/request-password-reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: me!.email,
          redirectTo: location.origin + `/${lang}/account/?reset=1`,
        }),
      });
      notice(t("Письмо добавлено в очередь отправки", "Email queued"));
      return;
    }
    if (action === "revoke_sessions") {
      await fetch("/api/auth/revoke-sessions/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await fetch("/api/auth/sign-out/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      location.reload();
      return;
    }
    if (action === "pay") {
      const checkout = await api("orders/" + selected + "/checkout", {});
      const form = document.createElement("form");
      form.method = "POST";
      form.action = checkout.url;
      for (const [name, value] of Object.entries(checkout.params)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.append(input);
      }
      document.body.append(form);
      form.submit();
      return;
    }
    await api("orders/" + selected, {
      action,
      ...(target.dataset.proposal
        ? { proposalId: target.dataset.proposal }
        : {}),
    });
    await loadDetail(true);
  } catch (e) {
    error(e);
  } finally {
    busy = false;
  }
});
async function init() {
  clearInterval(poll);
  try {
    me = await api("me");
    const inviteToken = new URLSearchParams(location.search).get("invite");
    if (inviteToken) {
      await api("claim", { token: inviteToken });
      me = await api("me");
      const url = new URL(location.href);
      url.searchParams.delete("invite");
      history.replaceState(null, "", url);
      notice(t("Приглашение принято", "Invitation accepted"));
    }
    document.querySelector<HTMLElement>("#auth")!.hidden = true;
    document.querySelector<HTMLElement>("#workspace")!.hidden = false;
    current =
      root.dataset.mode === "admin" && me!.roles.includes("admin")
        ? "roster"
        : root.dataset.mode === "moderation" &&
            me!.roles.some((r) => r === "admin" || r === "moderator")
          ? "queue"
          : "orders";
    nav();
    catalog = await api("catalog");
    const order = new URLSearchParams(location.search).get("order");
    if (order) await openOrder(order);
    else await renderPage();
    poll = setInterval(() => {
      if (selected && !document.hidden && !busy)
        void loadDetail(false).catch(error);
    }, 5000);
  } catch (e) {
    authView(
      new URLSearchParams(location.search).has("token") ? "reset" : "login",
    );
    if ((e as Error).message !== "LOGIN_REQUIRED") error(e);
  }
}
void init();
