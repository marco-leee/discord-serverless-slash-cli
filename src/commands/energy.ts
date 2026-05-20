export type EnergyLevel = 'crash' | 'low_present' | 'flow' | 'peak';

export const ENERGY_LEVEL_ORDER: EnergyLevel[] = ['peak', 'flow', 'low_present', 'crash'];

export const ENERGY_RANK: Record<EnergyLevel, number> = Object.fromEntries(
  ENERGY_LEVEL_ORDER.map((level, i) => [level, i])
) as Record<EnergyLevel, number>;

export interface EnergyMetrics {
  focused: number;
  startup: number;
  sustaining: number;
  motivation: number;
  regulation: number;
}

export interface EnergyClassification {
  metrics: EnergyMetrics;
  energy_level: EnergyLevel;
  activation_score: number;
  cognitive_control_score: number;
}

export class DefaultEnergyClassificationStrategy {
  static CRASH_THRESHOLD = 3.0;
  static LOW_MAX_THRESHOLD = 5.0;
  static FLOW_MIN_THRESHOLD = 5.1;
  static PEAK_THRESHOLD = 8.0;
  static FLOW_FOCUS_SUSTAINING_MIN = 7;
  static PEAK_HIGH_METRIC_MIN = 8;
  static PEAK_HIGH_METRIC_COUNT_REQUIRED = 2;

  static classify(energyMetrics: EnergyMetrics): EnergyClassification {
    const { focused: focus, startup, sustaining, motivation, regulation } = energyMetrics;
    const metrics = [focus, startup, sustaining, motivation, regulation];

    if (!metrics.every((x) => x >= 1 && x <= 10)) {
      throw new Error('All scores must be between 1 and 10.');
    }

    const activation = Math.round(((startup + motivation) / 2) * 10) / 10;
    const cognitiveControl = Math.round(((focus + sustaining + regulation) / 3) * 10) / 10;

    let energy: EnergyLevel;

    if (
      activation <= DefaultEnergyClassificationStrategy.CRASH_THRESHOLD ||
      cognitiveControl <= DefaultEnergyClassificationStrategy.CRASH_THRESHOLD
    ) {
      energy = 'crash';
    } else if (
      activation > DefaultEnergyClassificationStrategy.CRASH_THRESHOLD &&
      activation <= DefaultEnergyClassificationStrategy.LOW_MAX_THRESHOLD &&
      cognitiveControl > DefaultEnergyClassificationStrategy.CRASH_THRESHOLD &&
      cognitiveControl <= DefaultEnergyClassificationStrategy.LOW_MAX_THRESHOLD
    ) {
      energy = 'low_present';
    } else if (
      activation >= DefaultEnergyClassificationStrategy.FLOW_MIN_THRESHOLD &&
      cognitiveControl >= DefaultEnergyClassificationStrategy.FLOW_MIN_THRESHOLD
    ) {
      const highMetrics = [focus, motivation, regulation].filter(
        (x) => x >= DefaultEnergyClassificationStrategy.PEAK_HIGH_METRIC_MIN
      ).length;

      if (
        activation >= DefaultEnergyClassificationStrategy.PEAK_THRESHOLD &&
        cognitiveControl >= DefaultEnergyClassificationStrategy.PEAK_THRESHOLD &&
        highMetrics >= DefaultEnergyClassificationStrategy.PEAK_HIGH_METRIC_COUNT_REQUIRED
      ) {
        energy = 'peak';
      } else {
        energy = 'flow';
      }
    } else {
      energy = 'low_present';
    }

    return {
      metrics: energyMetrics,
      energy_level: energy,
      activation_score: Math.round(activation * 100) / 100,
      cognitive_control_score: Math.round(cognitiveControl * 100) / 100
    };
  }
}
