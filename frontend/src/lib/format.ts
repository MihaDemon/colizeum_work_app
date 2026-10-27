export const money = (amount: number) =>
  `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount)} ₽`;

export const parseAmount = (value: string) => Number(value.replace(",", "."));
export const validAmount = (value: string) => /^\d+([.,]\d{1,2})?$/.test(value);

export const time = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(date));
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(date));

export const cleanerDateTime = (value: string) => {
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "Europe/Moscow",
  })
    .format(new Date(value))
    .replaceAll(".", "/");
  return `${date} ${time(value)}`;
};
