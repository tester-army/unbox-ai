import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes, later ones winning. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Path components, either separator style, empty segments dropped. */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

/** Last path component, or the path itself when it has none. */
export function basename(path: string): string {
  return pathSegments(path).at(-1) ?? path;
}
