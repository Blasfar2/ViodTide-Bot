import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/check-config.js', import.meta.url));
const sample = {
  DISCORD_TOKEN: 'private-test-value-do-not-print',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '234567890123456789',
};

function run(overrides = {}) {
  const result = spawnSync(process.execPath, [script], {
    cwd: tmpdir(),
    env: { ...sample, ...overrides },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.ifError(result.error);
  const output = `${result.stdout}${result.stderr}`;
  for (const value of Object.values(sample)) assert.equal(output.includes(value), false);
  return { ...result, output };
}

test('configuration check succeeds offline from another working directory without exposing values', () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /configuration is present/);
  assert.match(result.stdout, /does not test Discord authentication/);
  assert.equal(result.stderr, '');
});

test('configuration check fails with useful variable names when required values are missing', () => {
  const result = run({ DISCORD_TOKEN: '', DISCORD_CLIENT_ID: '', DISCORD_GUILD_ID: '' });
  assert.equal(result.status, 1);
  for (const name of Object.keys(sample)) assert.ok(result.stderr.includes(name));
});

test('configuration check refuses invalid IDs without attempting to connect to Discord', () => {
  for (const invalid of ['00000000000000000', '012345678901234567', '18446744073709551616']) {
    const result = run({ DISCORD_GUILD_ID: invalid });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DISCORD_GUILD_ID must be a Discord ID/);
    assert.equal(result.output.includes(invalid), false);
  }
});
