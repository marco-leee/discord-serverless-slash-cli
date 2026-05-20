import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from 'slash-create/web';
import { z } from 'zod';
import { sendThreadResult } from '../discord';
import { structuredCompletion } from '../llm';
import { DefaultEnergyClassificationStrategy, ENERGY_RANK, EnergyLevel, EnergyMetrics } from './energy';

const PROMPT = `
## ADHD Planning Task Breakdown Prompt

You are an ADHD-friendly planning assistant.
Your job is to break any task into a **clear sequence of small, discrete steps** that reduce overwhelm and create momentum.

---

### CORE PRINCIPLE
**Each step = exactly one unit of progress.**

A unit of progress is:
- Making a single decision
- Defining or identifying something
- Choosing between options
- Setting criteria
- Outlining or specifying details

---

### STEP RULES (Strict)
Every step must:
- Contain **exactly one action**
- Start with a **clear verb** (Identify, Decide, Define, Choose, Determine, Create, Set, Establish, List, etc.)
- Be specific, unambiguous, and self-contained
- Represent meaningful progress toward the final task
- Use simple language. A 5 year old can understand the steps.
- Generate **exactly {steps} steps**. <--- IMPORTANT YOU MUST GENERATE EXACTLY {steps} STEPS

**Never** combine multiple actions or decisions in one step.

---

### WHAT TO INCLUDE
Prioritize steps that:
- Break big or vague decisions into smaller ones
- Surface missing information or constraints
- Clarify goals, success criteria, and boundaries
- Define structure, timing, resources, or order
- Turn fuzzy ideas into concrete elements

---

### WHAT TO AVOID
**Do NOT** include:
- Physical micro-actions (e.g., "open laptop", "grab notebook")
- Vague or open-ended steps ("think about it", "work on it")
- Multiple actions in a single step
- Redundant or repetitive steps
- Execution-level details unless they directly affect planning

---

### ENERGY LEVELS
Assign **the lowest reliable energy level** for each step.

**CRASH**
Very low energy, high resistance. Minimal focus.
Use only for passive review or light scanning (no real decisions).

**LOW_PRESENT**
Low but mentally available energy.
Suitable for simple decisions, listing, or basic structuring.

**FLOW**
Stable focus. Good for organizing, connecting ideas, or multi-step reasoning.

**PEAK**
High energy and mental clarity.
Use for complex decisions, tradeoffs, strategy, or high ambiguity.

---

### ENERGY ASSIGNMENT & DISTRIBUTION RULES

**Hard Targets:**
- LOW_PRESENT: 40–60%
- FLOW: 20–40%
- PEAK: 10–25%
- CRASH: 0–10%

**Rules:**
- Default to LOW_PRESENT unless the step genuinely requires more cognitive load.
- Upgrade to FLOW when a step involves structuring, connecting ideas, or multi-step reasoning.
- Upgrade to PEAK only for high-ambiguity decisions, major tradeoffs, or system design.
- Use CRASH sparingly and only for truly passive steps.
- **Anti-Collapse Rule**: If more than 60% of steps end up as LOW_PRESENT, you must re-evaluate and upgrade the appropriate steps to FLOW or PEAK based on actual cognitive demand.
`;

const EnergyLevelSchema = z.enum(['crash', 'low_present', 'flow', 'peak']);

const AtomicTaskSchema = z.object({
  step: z.number().describe('The step number in the list of atomic steps'),
  energy_level: EnergyLevelSchema.describe(
    'Which ADHD energy level this task best performs in? This is used to determine the best time to perform the task.'
  ),
  action: z.string().describe('The action to be taken in the step'),
  expected_output: z
    .array(z.string())
    .describe(
      'The expected outputs of the action. This is a list of possible outputs that can be expected from the action.'
    )
});

const AtomicTaskListSchema = z.object({
  atomic_tasks: z.array(AtomicTaskSchema).min(5).describe('The list of atomic steps')
});

type AtomicTask = z.infer<typeof AtomicTaskSchema>;

function capitalizeLevel(level: EnergyLevel): string {
  return level
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function sortByEnergyLevel(tasks: AtomicTask[]): AtomicTask[] {
  return [...tasks].sort((a, b) => ENERGY_RANK[a.energy_level] - ENERGY_RANK[b.energy_level] || a.step - b.step);
}

function formatAtomicTasks(tasks: AtomicTask[], filterLevel?: EnergyLevel): string {
  const lines: string[] = [];

  for (const task of tasks) {
    if (filterLevel && task.energy_level !== filterLevel) continue;
    lines.push(`${task.step}. ${task.action} - ${capitalizeLevel(task.energy_level)}`);
    for (const [index, output] of task.expected_output.entries()) {
      lines.push(`    ${index + 1}. ${output}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function getMetricsFromOptions(options: Record<string, unknown>): EnergyMetrics | null {
  const keys = ['focused', 'startup', 'sustaining', 'motivation', 'regulation'] as const;
  const values = keys.map((key) => options[key]);

  if (values.every((v) => v === undefined)) return null;
  if (values.some((v) => v === undefined)) {
    throw new Error('Please provide all 5 metrics: focused, startup, sustaining, motivation, regulation.');
  }

  return {
    focused: values[0] as number,
    startup: values[1] as number,
    sustaining: values[2] as number,
    motivation: values[3] as number,
    regulation: values[4] as number
  };
}

export interface AtomicTaskCliResult {
  summary: string;
  fullOutput: string;
  suggestedOutput?: string;
}

export async function executeAtomicTask(
  task: string,
  steps: number,
  metrics?: EnergyMetrics | null
): Promise<AtomicTaskCliResult> {
  const atomicTasks = await breakdownTask(task, steps);
  const fullOutput = formatAtomicTasks(atomicTasks);

  let summary = `Task: ${task}\nSteps generated: ${atomicTasks.length}`;
  let suggestedOutput: string | undefined;

  if (metrics) {
    const classification = DefaultEnergyClassificationStrategy.classify(metrics);
    summary += `\nEnergy level: ${capitalizeLevel(classification.energy_level)}`;
    summary += `\nActivation: ${classification.activation_score}`;
    summary += `\nCognitive control: ${classification.cognitive_control_score}`;
    const sortedTasks = sortByEnergyLevel(atomicTasks);
    suggestedOutput = formatAtomicTasks(sortedTasks, classification.energy_level);
  }

  return { summary, fullOutput, suggestedOutput };
}

async function breakdownTask(task: string, steps: number): Promise<AtomicTask[]> {
  const result = await structuredCompletion({
    systemPrompt: PROMPT.replace('{steps}', String(steps)),
    userPrompt: task,
    schema: AtomicTaskListSchema,
    schemaName: 'atomic_task_list'
  });

  return result.atomic_tasks;
}

export default class AtomicTaskCommand extends SlashCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'atomic-task',
      description: 'Break down a task into ADHD-friendly atomic steps with energy levels.',
      options: [
        {
          type: CommandOptionType.STRING,
          name: 'task',
          description: 'The task to break down',
          required: true
        },
        {
          type: CommandOptionType.INTEGER,
          name: 'steps',
          description: 'Number of atomic steps to generate',
          min_value: 5,
          max_value: 50
        },
        {
          type: CommandOptionType.INTEGER,
          name: 'focused',
          description: 'Focused score (1-10)',
          min_value: 1,
          max_value: 10
        },
        {
          type: CommandOptionType.INTEGER,
          name: 'startup',
          description: 'Startup score (1-10)',
          min_value: 1,
          max_value: 10
        },
        {
          type: CommandOptionType.INTEGER,
          name: 'sustaining',
          description: 'Sustaining score (1-10)',
          min_value: 1,
          max_value: 10
        },
        {
          type: CommandOptionType.INTEGER,
          name: 'motivation',
          description: 'Motivation score (1-10)',
          min_value: 1,
          max_value: 10
        },
        {
          type: CommandOptionType.INTEGER,
          name: 'regulation',
          description: 'Regulation score (1-10)',
          min_value: 1,
          max_value: 10
        }
      ]
    });
  }

  async run(ctx: CommandContext) {
    const task = (ctx.options.task as string)?.trim();
    if (!task) {
      return { content: 'Please provide a task.', ephemeral: true };
    }

    const steps = (ctx.options.steps as number | undefined) ?? 10;

    let metrics: EnergyMetrics | null;
    try {
      metrics = getMetricsFromOptions(ctx.options);
    } catch (err) {
      return { content: (err as Error).message, ephemeral: true };
    }

    await ctx.defer();

    try {
      const atomicTasks = await breakdownTask(task, steps);
      const fullOutput = formatAtomicTasks(atomicTasks);

      const files: { name: string; content: string }[] = [
        { name: 'atomic-task-all-steps.md', content: `# All Steps\n\n${fullOutput}` }
      ];

      let summary = `**Task:** ${task}\n**Steps generated:** ${atomicTasks.length}`;
      let suggestedOutput: string | undefined;

      if (metrics) {
        const classification = DefaultEnergyClassificationStrategy.classify(metrics);
        summary += `\n**Energy level:** ${capitalizeLevel(classification.energy_level)}`;
        summary += `\n**Activation:** ${classification.activation_score}`;
        summary += `\n**Cognitive control:** ${classification.cognitive_control_score}`;
        const sortedTasks = sortByEnergyLevel(atomicTasks);
        suggestedOutput = formatAtomicTasks(sortedTasks, classification.energy_level);
        if (suggestedOutput) {
          files.push({ name: 'atomic-task-suggested.md', content: `# Suggested Tasks\n\n${suggestedOutput}` });
        }
      }

      let body = fullOutput;
      if (suggestedOutput) {
        body += `\n\n**Suggested tasks:**\n${suggestedOutput}`;
      }

      await sendThreadResult(ctx, {
        threadName: `atomic-task: ${task}`,
        summary,
        body,
        bodyHeader: '**All steps:**',
        files
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      await ctx.editOriginal({ content: `Failed to break down task: ${message}` });
    }
  }
}
