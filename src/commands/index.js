import { ping } from './ping.js';

// Keep one registry for both execution and slash-command registration.
// Future commands belong here only when their phase is approved.
export const commands = new Map([
  [ping.data.name, ping],
]);

export function getCommandDefinitions() {
  return [...commands.values()].map((command) => command.data.toJSON());
}
