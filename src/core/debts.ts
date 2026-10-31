export interface DebtSummary {
  owedToMe: number;
  iOwe: number;
}

export function summarizeDebts(debts: readonly { amount: number }[]): DebtSummary {
  let owedToMe = 0;
  let iOwe = 0;
  for (const debt of debts) {
    if (debt.amount > 0) owedToMe += debt.amount;
    else iOwe += Math.abs(debt.amount);
  }
  return { owedToMe, iOwe };
}
