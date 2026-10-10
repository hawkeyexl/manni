export function parse(s: string): string[] {
  return s.split(',').map((x) => x.trim());
}
