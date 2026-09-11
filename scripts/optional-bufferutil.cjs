/* JavaScript fallback for ws when its optional native bufferutil package is unavailable. */
function mask(source, maskBytes, output, offset, length) {
  for (let index = 0; index < length; index += 1)
    output[offset + index] = source[index] ^ maskBytes[index & 3];
}
function unmask(buffer, maskBytes) {
  for (let index = 0; index < buffer.length; index += 1)
    buffer[index] ^= maskBytes[index & 3];
}
module.exports = { mask, unmask };