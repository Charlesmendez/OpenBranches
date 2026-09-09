// Older Forge dependencies expect require('extract-zip') to be a function.
// Electron's maintained implementation is ESM and validates archive paths.
module.exports = async (...args) => {
  const { default: extract } = await import('@electron-internal/extract-zip');
  return extract(...args);
};
