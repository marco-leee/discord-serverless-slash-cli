#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeAtomicTask } from '../src/commands/atomic-task';
import { executeDomainMapper } from '../src/commands/domain-mapper';
import { executePremortem } from '../src/commands/premortem';
import { setEnv } from '../src/env';
import type { EnergyMetrics } from '../src/commands/energy';

const COMMANDS = ['domain-mapper', 'premortem', 'atomic-task'] as const;
type CommandName = (typeof COMMANDS)[number];

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function bootstrapEnv(): void {
  const root = resolve(import.meta.dir, '..');
  loadEnvFile(resolve(root, '.dev.vars'));
  loadEnvFile(resolve(root, '.env'));

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY. Set it in .dev.vars or .env.');
    process.exit(1);
  }

  setEnv({
    DISCORD_APP_ID: process.env.DISCORD_APP_ID ?? 'local',
    DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY ?? 'local',
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN ?? 'local',
    OPENROUTER_API_KEY: apiKey
  });
}

function parseArgs(argv: string[]): {
  command?: CommandName;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command: CommandName | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
      continue;
    }

    if (!command && COMMANDS.includes(arg as CommandName)) {
      command = arg as CommandName;
      continue;
    }

    positional.push(arg);
  }

  return { command, positional, flags };
}

function getFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function getIntFlag(flags: Record<string, string | boolean>, key: string): number | undefined {
  const value = getFlag(flags, key);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for --${key}: ${value}`);
  }
  return parsed;
}

function readMetrics(flags: Record<string, string | boolean>): EnergyMetrics | null {
  const keys = ['focused', 'startup', 'sustaining', 'motivation', 'regulation'] as const;
  const values = keys.map((key) => getIntFlag(flags, key));

  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => value === undefined)) {
    throw new Error('Provide all 5 metrics together: --focused --startup --sustaining --motivation --regulation');
  }

  return {
    focused: values[0] as number,
    startup: values[1] as number,
    sustaining: values[2] as number,
    motivation: values[3] as number,
    regulation: values[4] as number
  };
}

function printHelp(): void {
  console.log(`Run slash commands locally (no Discord required).

Usage:
  bun run cmd <command> [options]

Commands:
  domain-mapper   Map domains, dependencies, and failure modes for a quest
  premortem       Pre-mortem analysis for a project or plan
  atomic-task     Break a task into ADHD-friendly atomic steps

Options:
  --input, --subject, --task   Primary input (required; flag name depends on command)
  --context                    Optional extra context
  --steps <n>                  Number of steps for atomic-task (default: 10)
  --focused, --startup, --sustaining, --motivation, --regulation
                               Energy metrics for atomic-task (all 5 required together)
  --out <file>                 Write markdown output to a file
  --help, -h                   Show this help

Environment:
  Reads OPENROUTER_API_KEY from .dev.vars or .env

Examples:
  bun run cmd domain-mapper --input "Build a SaaS while staying healthy"
  bun run cmd premortem --subject "Launch mobile app by Q3" --context "Solo founder"
  bun run cmd atomic-task --task "Plan weekly meal prep" --steps 12
  bun run cmd atomic-task --task "Write blog post" --focused 6 --startup 4 --sustaining 5 --motivation 7 --regulation 6
`);
}

async function runCommand(command: CommandName, flags: Record<string, string | boolean>): Promise<string> {
  switch (command) {
    case 'domain-mapper': {
      const input = getFlag(flags, 'input');
      if (!input) throw new Error('Missing required flag: --input');
      return executeDomainMapper(input, getFlag(flags, 'context'));
    }
    case 'premortem': {
      const subject = getFlag(flags, 'subject');
      if (!subject) throw new Error('Missing required flag: --subject');
      return executePremortem(subject, getFlag(flags, 'context'));
    }
    case 'atomic-task': {
      const task = getFlag(flags, 'task');
      if (!task) throw new Error('Missing required flag: --task');
      const steps = getIntFlag(flags, 'steps') ?? 10;
      const metrics = readMetrics(flags);
      const result = await executeAtomicTask(task, steps, metrics);

      const sections = [result.summary, '', 'All steps:', result.fullOutput];
      if (result.suggestedOutput) {
        sections.push('', 'Suggested tasks:', result.suggestedOutput);
      }
      return sections.join('\n');
    }
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  if (!command) {
    printHelp();
    process.exit(1);
  }

  bootstrapEnv();

  try {
    const output = await runCommand(command, flags);
    console.log(output);

    const outFile = getFlag(flags, 'out');
    if (outFile) {
      writeFileSync(outFile, output, 'utf-8');
      console.error(`\nWrote ${outFile}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

await main();
