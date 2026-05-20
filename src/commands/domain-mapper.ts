import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from 'slash-create/web';
import { z } from 'zod';
import { formatBullets, sendThreadResult } from '../discord';
import { structuredCompletion } from '../llm';

const PROMPT = `You are a domain mapper. You turn raw input plus a short description into a concise, scannable domain picture: entities, intended behavior, and relationships. Stay faithful to the input; do not invent APIs, endpoints, files, or data fields not supported by the text.

Extract:

1. **Summary** — 2–4 sentences synthesizing the domain and scope.
2. **Entities** — concepts with stable names; one line per entity (name + role).
3. **Responsibilities / intended behavior** — separate stated (explicit in input) from implied (reasonable inference).
4. **Relationships** — typed edges between entities using verbs like owns, calls, produces, consumes, depends_on, stores, triggers, notifies, aggregates.
5. **Open questions / ambiguities** — record uncertainty instead of guessing specifics.

Tone: clear, technical, minimal filler. Optimize for another engineer or agent to reuse the structure in design or implementation planning.`;

const EntitySchema = z.object({
  name: z.string(),
  role: z.string()
});

const RelationshipSchema = z.object({
  source: z.string(),
  relation: z.string(),
  target: z.string(),
  note: z.string().optional()
});

const DomainMapSchema = z.object({
  summary: z.string(),
  entities: z.array(EntitySchema),
  stated_behavior: z.array(z.string()),
  implied_behavior: z.array(z.string()),
  relationships: z.array(RelationshipSchema),
  open_questions: z.array(z.string())
});

type DomainMapResult = z.infer<typeof DomainMapSchema>;

function formatDomainMap(result: DomainMapResult): string {
  const sections = [
    `**Summary**\n${result.summary}`,
    result.entities.length
      ? `**Entities**\n${result.entities.map((e) => `- **${e.name}** — ${e.role}`).join('\n')}`
      : '',
    formatBullets('Stated behavior', result.stated_behavior),
    formatBullets('Implied behavior', result.implied_behavior),
    result.relationships.length
      ? `**Relationships**\n${result.relationships
          .map((r) => {
            const arrow = `${r.source} —${r.relation}→ ${r.target}`;
            return r.note ? `- ${arrow} (${r.note})` : `- ${arrow}`;
          })
          .join('\n')}`
      : '',
    result.open_questions.length
      ? formatBullets('Open questions / ambiguities', result.open_questions)
      : '**Open questions / ambiguities**\nNone'
  ];

  return sections.filter(Boolean).join('\n\n');
}

async function mapDomain(input: string, context?: string): Promise<DomainMapResult> {
  const userPrompt = context ? `Primary input:\n${input}\n\nDescription / context:\n${context}` : input;

  return structuredCompletion({
    systemPrompt: PROMPT,
    userPrompt,
    schema: DomainMapSchema,
    schemaName: 'domain_map'
  });
}

export default class DomainMapperCommand extends SlashCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'domain-mapper',
      description: 'Map specs, code, or notes into entities, behavior, and relationships.',
      options: [
        {
          type: CommandOptionType.STRING,
          name: 'input',
          description: 'The spec, code fragment, ticket, or notes to map',
          required: true
        },
        {
          type: CommandOptionType.STRING,
          name: 'context',
          description: 'Goal, constraints, system context, or audience framing'
        }
      ]
    });
  }

  async run(ctx: CommandContext) {
    const input = (ctx.options.input as string)?.trim();
    if (!input) {
      return { content: 'Please provide input to map.', ephemeral: true };
    }

    const context = (ctx.options.context as string | undefined)?.trim();

    await ctx.defer();

    try {
      const result = await mapDomain(input, context);
      const output = formatDomainMap(result);

      await sendThreadResult(ctx, {
        threadName: `domain-mapper: ${input}`,
        summary: '**Domain map complete**',
        body: output,
        bodyHeader: '**Domain model:**',
        files: [{ name: 'domain-map.md', content: `# Domain Map\n\n${output}` }]
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      await ctx.editOriginal({ content: `Domain mapping failed: ${message}` });
    }
  }
}
