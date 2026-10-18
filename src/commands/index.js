import { ping } from './ping.js';
import { rules } from './rules.js';
import { setupRules } from './setup-rules.js';

// Keep one registry for both execution and slash-command registration.
// Future commands belong here only when their phase is approved.
export const commands = new Map([
  [ping.data.name, ping],
  [rules.data.name, rules],
  [setupRules.data.name, setupRules],
]);

export function getCommandDefinitions() {
  return [...commands.values()].map((command) => command.data.toJSON());
}
