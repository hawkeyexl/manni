export function get(url: string) {
  return retry(() => fetch(url), { attempts: 3 });
}
