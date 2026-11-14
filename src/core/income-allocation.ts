export interface IncomeAllocationSummary {
  allocated: number;
  unallocated: number;
  overallocated: boolean;
}

export function calculateIncomeAllocation(
  income: number,
  expenses: readonly { amount: number }[],
  transfers: readonly { amount: number }[],
): IncomeAllocationSummary {
  const allocated = [...expenses, ...transfers].reduce((sum, plan) => sum + plan.amount, 0);
  const unallocated = income - allocated;
  return { allocated, unallocated, overallocated: unallocated < 0 };
}
