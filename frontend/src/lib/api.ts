const configuredBase = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/+$/,
  "",
);
const browserOrigin =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;
export const apiBase = new URL(`${configuredBase}/`, browserOrigin);
let token: string | null = null;
export const setToken = (value: string | null) => {
  token = value;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: unknown,
  ) {
    super(errorMessage(data));
  }
}
export function errorMessage(data: unknown): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(errorMessage).join(" ");
  if (data && typeof data === "object") {
    return Object.entries(data)
      .map(([key, value]) => {
        const labels: Record<string, string> = {
          username: "Логин",
          phone_number: "Телефон",
          uploaded_photos: "Фотографии",
          amount: "Сумма",
          serial_number: "Серийный номер",
          club_number: "Номер места",
          model: "Модель",
          image: "Фотография",
          title: "Название",
          description: "Описание",
          assignee: "Исполнитель",
          priority: "Приоритет",
          requires_photo: "Обязательность фотографий",
          reference_photo: "Фото-пример",
          photo_mode: "Режим фотографий",
          photo_requirements: "Требования к фотографиям",
          photos: "Фотографии",
          photo: "Фотография",
          photo_slots: "Поля фотографий",
          retained_photos: "Сохранённые фотографии",
          report_fields: "Фотографии отчёта",
          note: "Комментарий",
          reason: "Причина",
          version: "Версия",
          label: "Название поля",
          id: "Идентификатор",
          required: "Обязательность",
          cash: "Наличные",
          cards: "Карта",
          sbp: "СБП",
          shift_type: "Тип смены",
          desk_photo: "Фото стола администратора",
          receipt_photo: "Фото чека закрытия",
          additional_photo: "Дополнительное фото",
          non_field_errors: "",
          detail: "",
          error: "",
        };
        return `${labels[key] ?? key}${(labels[key] ?? key) ? ": " : ""}${errorMessage(value)}`;
      })
      .join("\n");
  }
  return "Не удалось выполнить запрос. Повторите попытку.";
}
// Server-provided pagination and QR URLs may contain the internal proxy host.
// Rebase their API path; never send a token to an arbitrary scanned host.
export function apiUrl(path: string): URL {
  if (!/^https?:|^\//.test(path)) return new URL(path, apiBase);
  const url = new URL(path, apiBase);
  const marker = url.pathname.indexOf("/api/");
  if (marker >= 0)
    return new URL(url.pathname.slice(marker + 5) + url.search, apiBase);
  if (
    url.origin === apiBase.origin &&
    url.pathname.startsWith(apiBase.pathname)
  )
    return url;
  throw new Error("Адрес не относится к API приложения.");
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Token ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers,
      credentials: "omit",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(
      "Нет связи с сервером. Проверьте подключение и повторите попытку.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({
      detail: `Ошибка сервера (${response.status}). Повторите попытку.`,
    }));
    if (response.status === 401 && token && typeof window !== "undefined") {
      window.dispatchEvent(new Event("session-expired"));
    }
    throw new ApiError(response.status, data);
  }
  if (response.status === 204) return undefined as T;
  if (response.headers.get("content-type")?.includes("image/"))
    return (await response.blob()) as T;
  return response.json() as Promise<T>;
}
export async function list<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  const visited = new Set<string>();
  let next: string | null = path;
  while (next) {
    const url = apiUrl(next).href;
    if (visited.has(url))
      throw new Error("Сервер вернул повторяющуюся страницу.");
    visited.add(url);
    const result: T[] | { results: T[]; next: string | null } = await request(
      next,
      { signal },
    );
    if (Array.isArray(result)) return [...items, ...result];
    items.push(...result.results);
    next = result.next;
  }
  return items;
}
