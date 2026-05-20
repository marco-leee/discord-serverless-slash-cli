import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from 'slash-create/web';
import { z } from 'zod';
import { sendThreadResult } from '../discord';
import { structuredCompletion } from '../llm';

const PROMPT = `You are a strategic systems thinker.

Analyze the following QUEST / VISION / GOAL as a multi-domain system rather than a single objective.

Your task is to:
- Identify all major domains that contribute toward success
- Explain why each domain matters
- Explain how domains interact with each other
- Explain which domains should be prioritized first
- Identify dependencies, bottlenecks, leverage points, and sustainability factors
- Reveal hidden or commonly overlooked areas
- Show how failure in one domain affects others

For the given quest:

1. Identify all important contributing domains
2. Include technical, operational, psychological, environmental, strategic, and maintenance domains where relevant
3. Explain both achievement and long-term sustainability
4. Think systemically, not linearly

---

# Output Format

# Quest
[Restate the quest clearly]

# System Overview
Briefly explain:
- Why this is a multi-domain problem
- What usually determines success or failure
- Which areas are commonly underestimated

---

# Domain Map

For each domain use:

## Domain Name

### Purpose
Role this domain plays.

### Importance
Choose:
- Critical Foundation
- High Leverage
- Core Support
- Optimization
- Maintenance

Explain why.

### Priority
Explain:
- Whether this should be handled early, continuously, or later
- Whether neglect compounds over time

### Why It Matters
How it contributes to success.

### Risks of Neglect
What breaks if ignored.

### Key Subareas
- Subarea
- Subarea
- Subarea

### Cross-Relationships
Explain:
- Which domains this affects
- Which domains depend on it
- Positive/negative feedback loops
- Tradeoffs created

### Common Mistakes
Typical traps or misconceptions.

---

# System Analysis

Explain:
- Foundational domains
- Bottleneck domains
- Force multipliers
- Sustainability domains
- Commonly overlooked domains
- Cascading failures and cascading gains

---

# Priority & Sequencing

Break into phases:
1. Stabilization
2. Foundation Building
3. Acceleration
4. Optimization
5. Sustainability

For each:
- Main objective
- Key domains
- Why this order matters

---

# Failure Modes

List:
- Common reasons people fail
- Early warning signs
- Prevention strategies

---

# Missing Questions

List important questions that would refine the strategy further.

---

Example Input:

Quest:
"I want to build a successful SaaS company while maintaining health and long-term sustainability."

Possible domains:
- Product
- Market
- Engineering
- Sales
- Finance
- Leadership
- Mental resilience
- Physical health
- Learning systems
- Time management
- Relationships
- Recovery systems
- Risk management

Do NOT give shallow advice.
Treat the quest as an interconnected ecosystem.
Focus heavily on prioritization, dependencies, and cross-domain relationships.`;

const ImportanceLevelSchema = z.enum([
  'Critical Foundation',
  'High Leverage',
  'Core Support',
  'Optimization Layer',
  'Maintenance Layer'
]);

const DomainSchema = z.object({
  name: z.string().describe('Domain name'),
  purpose: z.string().describe('What role this domain plays toward the quest'),
  importance_level: ImportanceLevelSchema,
  importance_why: z.string().describe('Why this importance level was chosen'),
  priority_timing: z.string().describe('When this domain becomes important and sequencing notes'),
  why_it_matters: z.string().describe('How this domain contributes to success'),
  risks_of_neglect: z.string().describe('What breaks if this domain is ignored'),
  key_subareas: z.array(z.string()).describe('Key subareas within this domain'),
  cross_domain_relationships: z.string().describe('Which domains this strengthens, depends on, or affects'),
  common_mistakes: z.array(z.string()).describe('Typical traps or misconceptions'),
  signals_and_indicators: z.array(z.string()).describe('How to know whether this domain is healthy or failing')
});

const SystemOverviewSchema = z.object({
  what_makes_difficult: z.string(),
  why_multi_domain: z.string(),
  failure_causes: z.array(z.string()),
  domains_that_dominate_success: z.array(z.string()),
  underestimated_domains: z.array(z.string())
});

const DependencyMapSchema = z.object({
  foundational: z.array(z.string()).describe('Domains that everything else relies on'),
  bottlenecks: z.array(z.string()).describe('Domains that cap progress'),
  force_multipliers: z.array(z.string()).describe('Domains that improve many others simultaneously'),
  sustainability: z.array(z.string()).describe('Domains preventing burnout, regression, or collapse'),
  invisible: z.array(z.string()).describe('Domains people ignore until problems appear')
});

const PhaseSchema = z.object({
  phase: z.string().describe('Phase name, e.g. Phase 1 — Stabilization'),
  main_objective: z.string(),
  key_domains: z.array(z.string()),
  why_order_matters: z.string(),
  risks_of_skipping: z.string()
});

const InterconnectionAnalysisSchema = z.object({
  cascading_positive: z.array(z.string()),
  cascading_failures: z.array(z.string()),
  must_evolve_together: z.array(z.string()),
  natural_conflicts: z.array(z.string()),
  hidden_technical_debt: z.array(z.string()),
  usually_overfocused: z.array(z.string()),
  usually_neglected: z.array(z.string())
});

const FailureModeSchema = z.object({
  failure_pattern: z.string().describe('A common way people fail this quest'),
  responsible_domains: z.array(z.string()),
  early_warning_signs: z.array(z.string()),
  prevention_strategies: z.array(z.string())
});

const DomainMapSchema = z.object({
  quest: z.string().describe('Restated quest clearly'),
  system_overview: SystemOverviewSchema,
  domains: z.array(DomainSchema).min(1).describe('All major contributing domains'),
  dependency_map: DependencyMapSchema,
  phases: z.array(PhaseSchema).describe('Priority and sequencing strategy by phase'),
  interconnection_analysis: InterconnectionAnalysisSchema,
  failure_modes: z.array(FailureModeSchema),
  missing_questions: z.array(z.string()).describe('Important questions to refine the quest')
});

type DomainMapResult = z.infer<typeof DomainMapSchema>;

function formatList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function formatDomain(domain: z.infer<typeof DomainSchema>): string {
  const sections = [
    `## ${domain.name}`,
    `### Purpose\n${domain.purpose}`,
    `### Importance Level\n**${domain.importance_level}**\n${domain.importance_why}`,
    `### Priority Timing\n${domain.priority_timing}`,
    `### Why It Matters\n${domain.why_it_matters}`,
    `### Risks of Neglect\n${domain.risks_of_neglect}`,
    domain.key_subareas.length ? `### Key Subareas\n${formatList(domain.key_subareas)}` : '',
    `### Cross-Domain Relationships\n${domain.cross_domain_relationships}`,
    domain.common_mistakes.length ? `### Common Mistakes\n${formatList(domain.common_mistakes)}` : '',
    domain.signals_and_indicators.length
      ? `### Signals & Indicators\n${formatList(domain.signals_and_indicators)}`
      : ''
  ];
  return sections.filter(Boolean).join('\n\n');
}

function formatDomainMap(result: DomainMapResult): string {
  const overview = result.system_overview;
  const dep = result.dependency_map;
  const inter = result.interconnection_analysis;

  const sections = [
    `# Quest\n${result.quest}`,
    `# System Overview`,
    `**What makes this difficult**\n${overview.what_makes_difficult}`,
    `**Why this is multi-domain**\n${overview.why_multi_domain}`,
    overview.failure_causes.length ? `**What tends to cause failure**\n${formatList(overview.failure_causes)}` : '',
    overview.domains_that_dominate_success.length
      ? `**Domains that dominate success**\n${formatList(overview.domains_that_dominate_success)}`
      : '',
    overview.underestimated_domains.length
      ? `**Underestimated domains**\n${formatList(overview.underestimated_domains)}`
      : '',
    `# Domain Map\n${result.domains.map(formatDomain).join('\n\n')}`,
    `# Dependency Map`,
    dep.foundational.length ? `## Foundational Domains\n${formatList(dep.foundational)}` : '',
    dep.bottlenecks.length ? `## Bottleneck Domains\n${formatList(dep.bottlenecks)}` : '',
    dep.force_multipliers.length ? `## Force Multipliers\n${formatList(dep.force_multipliers)}` : '',
    dep.sustainability.length ? `## Sustainability Domains\n${formatList(dep.sustainability)}` : '',
    dep.invisible.length ? `## Invisible Domains\n${formatList(dep.invisible)}` : '',
    `# Priority & Sequencing Strategy\n${result.phases
      .map(
        (p) =>
          `## ${p.phase}\n**Objective:** ${p.main_objective}\n**Key domains:** ${p.key_domains.join(', ')}\n**Why this order:** ${p.why_order_matters}\n**Risks of skipping:** ${p.risks_of_skipping}`
      )
      .join('\n\n')}`,
    `# Interconnection Analysis`,
    inter.cascading_positive.length ? `**Cascading positive effects**\n${formatList(inter.cascading_positive)}` : '',
    inter.cascading_failures.length ? `**Cascading failures**\n${formatList(inter.cascading_failures)}` : '',
    inter.must_evolve_together.length ? `**Must evolve together**\n${formatList(inter.must_evolve_together)}` : '',
    inter.natural_conflicts.length ? `**Natural conflicts**\n${formatList(inter.natural_conflicts)}` : '',
    inter.hidden_technical_debt.length
      ? `**Hidden technical debt**\n${formatList(inter.hidden_technical_debt)}`
      : '',
    inter.usually_overfocused.length ? `**Usually overfocused**\n${formatList(inter.usually_overfocused)}` : '',
    inter.usually_neglected.length ? `**Usually neglected**\n${formatList(inter.usually_neglected)}` : '',
    result.failure_modes.length
      ? `# Failure Modes\n${result.failure_modes
          .map(
            (f) =>
              `## ${f.failure_pattern}\n**Responsible domains:** ${f.responsible_domains.join(', ')}\n**Early warnings:** ${f.early_warning_signs.join('; ')}\n**Prevention:** ${f.prevention_strategies.join('; ')}`
          )
          .join('\n\n')}`
      : '',
    result.missing_questions.length
      ? `# Missing Questions\n${formatList(result.missing_questions)}`
      : ''
  ];

  return sections.filter(Boolean).join('\n\n');
}

export async function executeDomainMapper(input: string, context?: string): Promise<string> {
  const result = await mapDomain(input, context);
  return formatDomainMap(result);
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
      description: 'Analyze a quest/goal and map its domains, dependencies, sequencing, and failure modes.',
      options: [
        {
          type: CommandOptionType.STRING,
          name: 'input',
          description: 'The quest, vision, or goal to analyze',
          required: true
        },
        {
          type: CommandOptionType.STRING,
          name: 'context',
          description: 'Additional constraints, background, or framing'
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
        summary: `**Domain map complete**\n**Quest:** ${result.quest}`,
        body: output,
        bodyHeader: '**Domain map:**',
        files: [{ name: 'domain-map.md', content: output }]
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      await ctx.editOriginal({ content: `Domain mapping failed: ${message}` });
    }
  }
}
