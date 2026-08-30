export const maxActionsPerCase = 6;
export const maxLlmCallsPerCase = 2;

export function reserveEscalationAction(actionCount: number): boolean {
  return actionCount >= maxActionsPerCase - 1;
}
