/* Paging for the app's tables. Pages are 1-based and live in the query string. */

export const PAGE_SIZE = 50

/** The page number in a query string value: a positive whole number, or 1. */
export function parsePage(value: string | string[] | undefined) {
  const page = Number(Array.isArray(value) ? value[0] : value)
  return Number.isInteger(page) && page > 0 ? page : 1
}

/** The last page for `total` rows, never below 1. */
export function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE))
}

/** `href` with its `param` set to `page`, left out for the first page. */
export function pageHref(href: string, param: string, page: number) {
  const [path, search = ""] = href.split("?")
  const query = new URLSearchParams(search)
  if (page > 1) query.set(param, String(page))
  else query.delete(param)
  const text = query.toString()
  return text ? `${path}?${text}` : path
}
