export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url) && !/^tel:/i.test(url)) return
  window.open(url, '_blank', 'noopener,noreferrer')
}
