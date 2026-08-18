import { describe, expect, it } from "vitest";
import { summarizeMaintenanceState } from "./maintenance.js";

describe("maintenance state", () => {
  it("reports active statuses that make a cold backup unsafe", () => {
    expect(summarizeMaintenanceState([
      { status: "complete" },
      { status: "rendering" },
      { status: "queued" }
    ])).toEqual({ idle: false, activeJobs: 2 });
  });

  it("treats terminal and confirmation jobs as idle", () => {
    expect(summarizeMaintenanceState([
      { status: "complete" },
      { status: "failed" },
      { status: "awaiting_confirmation" }
    ])).toEqual({ idle: true, activeJobs: 0 });
  });

  it("counts every pipeline-owned status", () => {
    expect(summarizeMaintenanceState([
      { status: "queued" },
      { status: "planning" },
      { status: "narrating" },
      { status: "rendering" },
      { status: "quality_check" }
    ])).toEqual({ idle: false, activeJobs: 5 });
  });
});
