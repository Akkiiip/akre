/* JavaScript fallback for ws when its optional native utf-8-validate package is unavailable. */
module.exports = function isValidUtf8(buffer) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};