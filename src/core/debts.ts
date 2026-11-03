export interface DebtSummary {
  owedToMe: number;
  iOwe: number;
}

export interface DebtArchiveSplit<T> {
  active: T[];
  archived: T[];
}

export function splitDebtsByArchive<T extends { archivedAt?: Date }>(debts: readonly T[]): DebtArchiveSplit<T> {
  const active: T[] = [];
  const archived: T[] = [];
  for (const debt of debts) (debt.archivedAt ? archived : active).push(debt);
  return { active, archived };
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

export interface DebtPaymentResult {
  remainingAmount: number;
  repaidAmount: number;
  closedAmount?: number;
}

export function calculateDebtPayment(amount: number, repaidAmount: number, payment: number): DebtPaymentResult {
  const sign = amount > 0 ? 1 : -1;
  const current = Math.abs(amount);
  const applied = Math.min(payment, current);
  const remaining = Math.max(0, current - applied);
  const totalRepaid = repaidAmount + applied;
  return {
    remainingAmount: sign * remaining,
    repaidAmount: totalRepaid,
    closedAmount: remaining <= 0.005 ? sign * totalRepaid : undefined,
  };
}
