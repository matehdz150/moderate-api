export type BrandSafetyLevel = "safe" | "caution" | "unsafe";

export interface BrandSafetyResult {
  safe: boolean;
  score: number;
  level: BrandSafetyLevel;
  reasons: string[];
}
