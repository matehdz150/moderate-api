export type CompliancePack =
  | "marketplace"
  | "kids"
  | "education"
  | "social"
  | "dating"
  | "ads";

export interface ComplianceResult {
  pack: CompliancePack;
  passed: boolean;
  violations: string[];
}
