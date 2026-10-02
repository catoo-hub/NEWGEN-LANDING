const events: Record<string, { ru: string; en: string }> = {
  REVIEW_REMINDER: {
    ru: "Финал ожидает проверки",
    en: "Please review your delivery",
  },
  DEADLINE_REMINDER: {
    ru: "Согласованный срок заказа прошёл",
    en: "Order deadline has passed",
  },
  WORK_START_AUTHORIZED: {
    ru: "Начало работы разрешено",
    en: "Work start authorized",
  },
  ASSIGNMENT_RELEASED: {
    ru: "Назначение снято",
    en: "Assignment released",
  },
  DEFECT_REPORTED: {
    ru: "Сообщено о несоответствии ТЗ",
    en: "Brief mismatch reported",
  },
  CORRECTION_REQUESTED: {
    ru: "Назначено исправление",
    en: "Correction requested",
  },
  AMENDMENT_EXPIRED: {
    ru: "Изменение условий истекло",
    en: "Amendment expired",
  },
  AMENDMENT_REJECTED: {
    ru: "Изменение условий отклонено",
    en: "Amendment rejected",
  },
  NEW_APPLICATION: {
    ru: "Новая заявка",
    en: "New application",
  },
  APPLICATION_CREATED: {
    ru: "Заявка создана",
    en: "Application created",
  },
  NEW_MESSAGE: {
    ru: "Новое сообщение",
    en: "New message",
  },
  ASSIGNMENT_OFFERED: {
    ru: "Приглашение на заказ",
    en: "Order invitation",
  },
  ASSIGNMENT_ACCEPTED: {
    ru: "Исполнитель подтвердил заказ",
    en: "Performer accepted",
  },
  ASSIGNMENT_DECLINED: {
    ru: "Исполнитель отказался",
    en: "Performer declined",
  },
  ASSIGNMENT_EXPIRED: {
    ru: "Назначение истекло",
    en: "Assignment expired",
  },
  QUOTE_CREATED: {
    ru: "Предложение готово",
    en: "Quote ready",
  },
  QUOTE_ACCEPTED: {
    ru: "Предложение принято",
    en: "Quote accepted",
  },
  PAYMENT_CONFIRMED: {
    ru: "Оплата подтверждена",
    en: "Payment confirmed",
  },
  PAYMENT_REVIEW_REQUIRED: {
    ru: "Оплата требует проверки",
    en: "Payment requires review",
  },
  FINAL_DELIVERED: {
    ru: "Финал отправлен",
    en: "Final delivered",
  },
  PREVIEW_DELIVERED: {
    ru: "Превью отправлено",
    en: "Preview delivered",
  },
  REVISION_REQUESTED: {
    ru: "Получены правки",
    en: "Revision requested",
  },
  ORDER_COMPLETED: {
    ru: "Заказ завершён",
    en: "Order completed",
  },
  CANCELLATION_REQUESTED: {
    ru: "Запрошена отмена",
    en: "Cancellation requested",
  },
  ORDER_CANCELED: {
    ru: "Заказ отменён",
    en: "Order canceled",
  },
  REFUND_RECORDED: {
    ru: "Возврат зафиксирован",
    en: "Refund recorded",
  },
  PORTFOLIO_PERMISSION: {
    ru: "Разрешение на публикацию изменено",
    en: "Portfolio permission updated",
  },
  WITHDRAWAL_REQUESTED: {
    ru: "Заявка на вывод",
    en: "Withdrawal requested",
  },
  WITHDRAWAL_PAID: {
    ru: "Вывод выполнен",
    en: "Withdrawal paid",
  },
  WITHDRAWAL_REJECTED: {
    ru: "Вывод отклонён",
    en: "Withdrawal rejected",
  },
  NO_AVAILABLE_PERFORMER: {
    ru: "Нет свободного исполнителя",
    en: "No available performer",
  },
  PREFERRED_UNAVAILABLE: {
    ru: "Предпочтительный исполнитель недоступен",
    en: "Preferred performer unavailable",
  },
  MANUAL_ASSIGNMENT_REQUIRED: {
    ru: "Нужно ручное назначение",
    en: "Manual assignment required",
  },
  AMENDMENT_PROPOSED: {
    ru: "Предложено изменение условий",
    en: "Amendment proposed",
  },
  AMENDMENT_ACCEPTED: {
    ru: "Изменение условий принято",
    en: "Amendment accepted",
  },
  REPLACEMENT_PROPOSAL: {
    ru: "Предложена замена исполнителя",
    en: "Replacement proposed",
  },
  REPLACEMENT_APPROVED: {
    ru: "Замена одобрена",
    en: "Replacement approved",
  },
};
export function formatEvent(value: string, lang: "ru" | "en") {
  return value
    .split(" / ")
    .map((part) => events[part]?.[lang] || part)
    .join(" / ");
}
