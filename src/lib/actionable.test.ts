import { describe, it, expect } from "vitest";
import { isActionable } from "./actionable";

describe("actionable vacancy gate", () => {
  it("keeps jobs with a real email", () => {
    expect(isActionable({ applyChannel: "EMAIL", applyValue: "bewerbung@hotel.de", url: null, employerEmail: null }).actionable).toBe(true);
    expect(isActionable({ applyChannel: "FORM", applyValue: null, url: null, employerEmail: "info@firma.de" }).actionable).toBe(true);
  });

  it("keeps form jobs on a reachable host", () => {
    expect(isActionable({ applyChannel: "FORM", applyValue: "https://www.arbeitnow.com/jobs/x", url: null, employerEmail: null }).actionable).toBe(true);
  });

  it("drops form jobs on a blocked host (StepStone, LinkedIn, Indeed)", () => {
    expect(isActionable({ applyChannel: "FORM", applyValue: "https://www.stepstone.de/stellenangebote/x", url: null, employerEmail: null }).actionable).toBe(false);
    expect(isActionable({ applyChannel: "FORM", applyValue: null, url: "https://de.linkedin.com/jobs/view/x", employerEmail: null }).actionable).toBe(false);
    expect(isActionable({ applyChannel: "FORM", applyValue: "https://de.indeed.com/viewjob?jk=x", url: null, employerEmail: null }).actionable).toBe(false);
  });

  it("drops jobs with no email and no url", () => {
    expect(isActionable({ applyChannel: "FORM", applyValue: null, url: null, employerEmail: null }).actionable).toBe(false);
    expect(isActionable({ applyChannel: "EMAIL", applyValue: "not-an-email", url: null, employerEmail: null }).actionable).toBe(false);
  });
});
