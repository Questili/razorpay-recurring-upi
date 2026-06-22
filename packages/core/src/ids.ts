/**
 * Deterministic id generation. Uses a provided prefix and an incrementing /
 * random suffix. For tests you can inject a factory; production uses crypto
 * strong randomness so ids are not enumerable.
 */
import { randomBytes } from "node:crypto";

export type IdFactory = (prefix: string) => string;

export const randomIdFactory: IdFactory = (prefix: string): string => {
  const rand = randomBytes(9).toString("base64url");
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
};

/** Sequence-based factory used in tests for predictable, readable ids. */
export function sequentialIdFactory(start = 1): IdFactory {
  let n = start;
  return (prefix: string): string => `${prefix}_${String(n++).padStart(4, "0")}`;
}
