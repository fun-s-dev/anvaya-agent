export type EvaluationSummary = {
  matchRate: number;
  explainedVariance: number;
  unexplainedVariance: number;
};

export function createEvaluationSummary(): EvaluationSummary {
  return {
    matchRate: 0,
    explainedVariance: 0,
    unexplainedVariance: 0,
  };
}
