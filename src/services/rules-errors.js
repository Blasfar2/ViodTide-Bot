/** Only deliberately written, safe guidance may be shown to Discord members. */
export class RulesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RulesError';
  }
}
