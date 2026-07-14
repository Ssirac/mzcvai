import { describe, it, expect } from "vitest";
import { can, type Action } from "./rbac";

// The full permission matrix, mirrored here so a change to rbac.ts that shifts
// any cell fails the test.
const MATRIX: Record<Action, { admin: boolean; recruiter: boolean }> = {
  "settings.read":    { admin: true, recruiter: false },
  "settings.write":   { admin: true, recruiter: false },
  "candidate.read":   { admin: true, recruiter: true },
  "candidate.write":  { admin: true, recruiter: true },
  "candidate.delete": { admin: true, recruiter: false },
  "gdpr":             { admin: true, recruiter: false },
  "outreach.draft":   { admin: true, recruiter: true },
  "outreach.send":    { admin: true, recruiter: true },
  "outreach.bulk":    { admin: true, recruiter: false },
  "admin.maintenance":{ admin: true, recruiter: false },
};

describe("RBAC permission matrix", () => {
  for (const [action, exp] of Object.entries(MATRIX) as [Action, { admin: boolean; recruiter: boolean }][]) {
    it(`${action}: ADMIN=${exp.admin} RECRUITER=${exp.recruiter}`, () => {
      expect(can("ADMIN", action)).toBe(exp.admin);
      expect(can("RECRUITER", action)).toBe(exp.recruiter);
    });
  }

  it("ADMIN may do every action", () => {
    for (const action of Object.keys(MATRIX) as Action[]) expect(can("ADMIN", action)).toBe(true);
  });
});
