import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { mask, unmask } = require("../../scripts/optional-bufferutil.cjs") as {
  mask: (
    source: Uint8Array,
    mask: Uint8Array,
    output: Uint8Array,
    offset: number,
    length: number,
  ) => void;
  unmask: (buffer: Uint8Array, mask: Uint8Array) => void;
};
const isValidUtf8 = require("../../scripts/optional-utf-8-validate.cjs") as (
  buffer: Uint8Array,
) => boolean;

it("provides ws-compatible JavaScript fallbacks for optional native extensions", () => {
  const source = Uint8Array.from([10, 20, 30, 40, 50]);
  const key = Uint8Array.from([1, 2, 3, 4]);
  const output = new Uint8Array(source.length);
  mask(source, key, output, 0, source.length);
  unmask(output, key);
  expect([...output]).toEqual([...source]);
  expect(isValidUtf8(Buffer.from("AKRE"))).toBe(true);
  expect(isValidUtf8(Uint8Array.from([0xc3, 0x28]))).toBe(false);
});