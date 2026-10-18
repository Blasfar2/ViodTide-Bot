// Keep the existing command as a compatibility alias. Destructive repairs and
// overwrite changes are deliberately unavailable under the simple layout policy.
export class AutoFix {
  constructor({ setup }) { this.setup = setup; }
  run(interaction) { return this.setup.run(interaction, 'server', 'auto-fix'); }
}
