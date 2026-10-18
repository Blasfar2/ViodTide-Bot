import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { RulesError } from './rules-errors.js';

const limit = 5 * 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function format(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new RulesError('Upload a PNG, JPEG or WebP logo, up to 5 MiB.');
}

/** Logo bytes are uploaded by the bot to Discord; no external image host needed. */
export class RulesLogo {
  constructor({ directory = fileURLToPath(new URL('../../data/rules-assets/', import.meta.url)), fetchImpl = globalThis.fetch } = {}) {
    Object.assign(this, { directory, fetchImpl });
  }
  async prepare(attachment) {
    if (!attachment || !Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > limit) throw new RulesError('Upload a PNG, JPEG or WebP logo, up to 5 MiB.');
    let url;
    try { url = new URL(attachment.url); } catch { throw new RulesError('Select a Discord-uploaded logo attachment.'); }
    // Slash-command uploads may live under ephemeral-attachments rather than
    // the attachments path used for ordinary channel-message uploads.
    const attachmentPath = ['/attachments/', '/ephemeral-attachments/'].some((prefix) => url.pathname.startsWith(prefix));
    if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
      || !attachmentPath || url.username || url.password || url.port) throw new RulesError('Use the logo attachment picker in /auto-rule to upload your PNG, JPEG or WebP file. Only Discord attachment URLs are accepted.');
    try {
      const response = await this.fetchImpl(url, { redirect: 'error', signal: globalThis.AbortSignal.timeout(10_000) });
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Logo download failed');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > limit) { await response.body.cancel().catch(() => {}); throw new RulesError('The logo exceeds 5 MiB.'); }
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      return { bytes, format: format(bytes), sha256: hash(bytes) };
    } catch (error) {
      if (error instanceof RulesError) throw error;
      throw new RulesError('Could not download the uploaded logo from Discord. Attach it again and retry; do not share credentials.');
    }
  }
  path(guildId, asset) {
    if (!/^[a-f0-9]{64}$/.test(asset?.sha256 ?? '') || !['png', 'jpg', 'webp'].includes(asset?.format)) throw new RulesError('The saved rules logo is invalid. Upload it again using /auto-rule logo.');
    return join(this.directory, `${hash(guildId)}-${asset.sha256}.${asset.format}`);
  }
  async save(guildId, asset) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(guildId, asset); const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, asset.bytes, { mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
    await this.load(guildId, asset);
    return { sha256: asset.sha256, format: asset.format };
  }
  async load(guildId, asset) {
    try {
      const bytes = await readFile(this.path(guildId, asset));
      if (bytes.length > limit || hash(bytes) !== asset.sha256 || format(bytes) !== asset.format) throw new Error('Invalid stored logo');
      return { attachment: bytes, name: `voidtide-logo.${asset.format}`, description: 'VOIDTIDE community logo in silver, purple and blue.' };
    } catch {
      throw new RulesError('The saved logo is missing or damaged. Restore data/rules-assets from backup or upload the logo again using /auto-rule logo.');
    }
  }
}
