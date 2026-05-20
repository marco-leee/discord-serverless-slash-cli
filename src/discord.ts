import { CommandContext, MessageEmbedOptions } from 'slash-create/web';

const THREAD_NAME_MAX = 100;
const EMBED_DESC_MAX = 4096;
const EMBED_FIELD_MAX = 1024;

interface ThreadChannel {
  id: string;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function formatBullets(title: string, items: string[]): string {
  if (items.length === 0) return '';
  return `**${title}**\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function buildEmbed(
  title: string,
  options: {
    description?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
    color?: number;
    footer?: string;
  } = {}
): MessageEmbedOptions {
  return {
    title,
    description: options.description ? truncate(options.description, EMBED_DESC_MAX) : undefined,
    color: options.color ?? 0x5865f2,
    fields: options.fields?.map((f) => ({
      name: f.name,
      value: truncate(f.value, EMBED_FIELD_MAX),
      inline: f.inline
    })),
    footer: options.footer ? { text: options.footer } : undefined
  };
}

export function chunkForDiscord(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen) {
      if (current) chunks.push(current);
      if (line.length > maxLen) {
        for (let i = 0; i < line.length; i += maxLen) {
          chunks.push(line.slice(i, i + maxLen));
        }
        current = '';
      } else {
        current = line;
      }
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export interface ThreadResultFile {
  name: string;
  content: string;
}

export interface ThreadResultOptions {
  threadName: string;
  summary: string;
  body: string;
  bodyHeader?: string;
  files: ThreadResultFile[];
}

function sanitizeThreadName(name: string): string {
  return truncate(name.replace(/\n/g, ' ').trim(), THREAD_NAME_MAX) || 'command-result';
}

async function createThread(ctx: CommandContext, messageId: string, name: string): Promise<string> {
  const thread = await ctx.creator.requestHandler.request<ThreadChannel>(
    'POST',
    `/channels/${ctx.channelID}/messages/${messageId}/threads`,
    {
      auth: true,
      body: {
        name: sanitizeThreadName(name),
        auto_archive_duration: 1440
      }
    }
  );
  return thread.id;
}

async function sendChannelMessage(
  ctx: CommandContext,
  channelId: string,
  options: { content?: string; files?: ThreadResultFile[] }
): Promise<void> {
  await ctx.creator.requestHandler.request('POST', `/channels/${channelId}/messages`, {
    auth: true,
    body: { content: options.content },
    files: options.files?.map((f) => ({ name: f.name, file: f.content }))
  });
}

function formatChunk(header: string, chunk: string, index: number, total: number): string {
  if (total === 1) return `${header}\n${chunk}`;
  return `${header} (${index + 1}/${total})\n${chunk}`;
}

async function sendChunksWithFiles(
  header: string,
  body: string,
  files: ThreadResultFile[],
  send: (content: string, attachFiles: ThreadResultFile[]) => Promise<void>
): Promise<void> {
  const chunks = chunkForDiscord(body);
  for (let i = 0; i < chunks.length; i++) {
    await send(formatChunk(header, chunks[i], i, chunks.length), i === 0 ? files : []);
  }
}

export async function sendThreadResult(ctx: CommandContext, options: ThreadResultOptions): Promise<void> {
  const message = await ctx.editOriginal({ content: options.summary });
  const header = options.bodyHeader ?? '**Output:**';

  if (ctx.guildID) {
    try {
      const threadId = await createThread(ctx, message.id, options.threadName);
      await sendChunksWithFiles(header, options.body, options.files, (content, attachFiles) =>
        sendChannelMessage(ctx, threadId, { content, files: attachFiles })
      );
      await ctx.editOriginal({ content: `<#${threadId}>\n${options.summary}` });
      return;
    } catch (err) {
      console.error('Thread creation failed, falling back to follow-up:', err);
    }
  }

  await sendChunksWithFiles(header, options.body, options.files, async (content, attachFiles) => {
    await ctx.sendFollowUp({
      content,
      files: attachFiles.map((f) => ({ name: f.name, file: f.content }))
    });
  });
}
