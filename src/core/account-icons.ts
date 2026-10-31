export const DEFAULT_ACCOUNT_ICON = "wallet-cards";
const legacyIcons: Readonly<Record<string, string>> = {
  "💳": "credit-card",
  "💰": "wallet-cards",
  "🏦": "landmark",
  "💵": "banknote",
  "🐷": "piggy-bank",
  "🪙": "coins",
  "🏠": "house",
  "🚗": "car",
  "🎓": "graduation-cap",
  "✈️": "plane",
  "🎁": "gift",
};

export function normalizeAccountIcon(value: string | undefined): string {
  const icon = value?.trim();
  if (!icon) return DEFAULT_ACCOUNT_ICON;
  const migrated = legacyIcons[icon] ?? icon;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(migrated) ? migrated : DEFAULT_ACCOUNT_ICON;
}
