import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from 'slash-create/web';
import { z } from 'zod';
import { formatBullets, sendThreadResult } from '../discord';
import { structuredCompletion } from '../llm';

const PROMPT = `I want you to conduct a rigorous pre-mortem analysis.

Assume that this has already failed completely 6–12 months from now.

Your task is to reverse engineer the failure in detail.

Analyze:

1. **Primary Causes of Failure**
    - What most likely went wrong?
    - What were the hidden weak points?
    - Which assumptions turned out to be false?
2. **Strategic Mistakes**
    - What bad decisions contributed to failure?
    - What blind spots or biases were involved?
    - What was underestimated or ignored?
3. **Behavioral & Psychological Factors**
    - What emotional patterns sabotaged success?
    - Where did procrastination, ego, fear, distraction, impulsiveness, burnout, overconfidence, or avoidance appear?
    - What habits quietly compounded into failure?
4. **External Risks**
    - What environmental, market, social, financial, political, or timing-related risks contributed?
    - Which dependencies became points of collapse?
5. **Operational Breakdown**
    - What systems, routines, communication, execution, or resource issues caused deterioration?
    - What bottlenecks emerged?
6. **Early Warning Signs**
    - What signals appeared early that should have indicated impending failure?
    - What metrics or behaviors were ignored?
7. **Second-Order Consequences**
    - How did small failures compound into major collapse?
    - What cascading effects accelerated the breakdown?
8. **Countermeasures**
    - For each major failure point, provide preventative actions.
    - Suggest systems, safeguards, habits, checkpoints, or strategic adjustments that could reduce the probability of failure.
9. **Brutal Prioritization**
    - Rank the top 5 most likely causes of failure by probability and impact.
    - Identify which single issue is most existential.

Be skeptical, concrete, and psychologically realistic.

Avoid generic advice.

Focus on uncomfortable truths, hidden risks, and failure modes that people typically overlook.`;

const CountermeasureSchema = z.object({
  failure_point: z.string(),
  preventative_actions: z.array(z.string())
});

const FailureCauseSchema = z.object({
  cause: z.string(),
  probability: z.string(),
  impact: z.string()
});

const PremortemSchema = z.object({
  primary_causes: z.array(z.string()),
  strategic_mistakes: z.array(z.string()),
  behavioral_factors: z.array(z.string()),
  external_risks: z.array(z.string()),
  operational_breakdown: z.array(z.string()),
  early_warning_signs: z.array(z.string()),
  second_order_consequences: z.array(z.string()),
  countermeasures: z.array(CountermeasureSchema),
  top_failure_causes: z.array(FailureCauseSchema).length(5),
  most_existential_issue: z.string()
});

type PremortemResult = z.infer<typeof PremortemSchema>;

function formatPremortem(result: PremortemResult): string {
  const sections = [
    formatBullets('Primary Causes of Failure', result.primary_causes),
    formatBullets('Strategic Mistakes', result.strategic_mistakes),
    formatBullets('Behavioral & Psychological Factors', result.behavioral_factors),
    formatBullets('External Risks', result.external_risks),
    formatBullets('Operational Breakdown', result.operational_breakdown),
    formatBullets('Early Warning Signs', result.early_warning_signs),
    formatBullets('Second-Order Consequences', result.second_order_consequences),
    result.countermeasures.length
      ? `**Countermeasures**\n${result.countermeasures
          .map((cm) => `- **${cm.failure_point}**\n${cm.preventative_actions.map((a) => `  - ${a}`).join('\n')}`)
          .join('\n')}`
      : '',
    `**Brutal Prioritization — Top 5 Failure Causes**\n${result.top_failure_causes
      .map((c, i) => `${i + 1}. ${c.cause} (probability: ${c.probability}, impact: ${c.impact})`)
      .join('\n')}`,
    `**Most Existential Issue**\n${result.most_existential_issue}`
  ];

  return sections.filter(Boolean).join('\n\n');
}

export async function executePremortem(subject: string, context?: string): Promise<string> {
  const result = await runPremortem(subject, context);
  return formatPremortem(result);
}

async function runPremortem(subject: string, context?: string): Promise<PremortemResult> {
  const userPrompt = context ? `Subject: ${subject}\n\nAdditional context:\n${context}` : subject;

  return structuredCompletion({
    systemPrompt: PROMPT,
    userPrompt,
    schema: PremortemSchema,
    schemaName: 'premortem_analysis'
  });
}

export default class PremortemCommand extends SlashCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'premortem',
      description: 'Conduct a rigorous pre-mortem analysis assuming the project has already failed.',
      options: [
        {
          type: CommandOptionType.STRING,
          name: 'subject',
          description: 'The project, plan, or decision to analyze',
          required: true
        },
        {
          type: CommandOptionType.STRING,
          name: 'context',
          description: 'Additional context, constraints, or background'
        }
      ]
    });
  }

  async run(ctx: CommandContext) {
    const subject = (ctx.options.subject as string)?.trim();
    if (!subject) {
      return { content: 'Please provide a subject to analyze.', ephemeral: true };
    }

    const context = (ctx.options.context as string | undefined)?.trim();

    await ctx.defer();

    try {
      const result = await runPremortem(subject, context);
      const output = formatPremortem(result);

      await sendThreadResult(ctx, {
        threadName: `premortem: ${subject}`,
        summary: `**Pre-mortem:** ${subject}`,
        body: output,
        bodyHeader: '**Analysis:**',
        files: [{ name: 'premortem.md', content: `# Pre-mortem: ${subject}\n\n${output}` }]
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      await ctx.editOriginal({ content: `Pre-mortem failed: ${message}` });
    }
  }
}
