/** תחומי הביטוח למטא-דאטה של הקטעים (אפיון 9.1). מודול נטול תלויות — בטוח גם ל-client components. */
export const INSURANCE_DOMAINS = ["רכב", "דירה", "בריאות", "חיים", "נסיעות", "עסק", "כללי"] as const;

export type InsuranceDomain = (typeof INSURANCE_DOMAINS)[number];
