const safeCodes = new Set([
  'TokenInvalid', 'DisallowedIntents', 'UsedDisallowedIntents',
  'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
]);

export function createLogger(output = console) {
  return {
    info(message) {
      output.info(`${new Date().toISOString()} INFO ${message}`);
    },
    error(message, error) {
      const code = error?.code;
      const detail = (Number.isSafeInteger(code) || safeCodes.has(code))
        ? ` (code: ${code})`
        : '';
      // Discord errors can contain request bodies and auth headers. Do not dump them.
      output.error(`${new Date().toISOString()} ERROR ${message}${detail}`);
    },
  };
}
