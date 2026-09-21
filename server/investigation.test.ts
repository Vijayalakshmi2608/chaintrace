import { afterEach, describe, expect, it, vi } from "vitest";
import { investigate } from "./investigation";

describe("CHAINTRACE investigation contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an empty investigation without making a network call", async () => {
    await expect(investigate("   ")).rejects.toThrow("Enter a company, event, component, or disruption");
  });

  it("returns a clear configuration error when SerpApi is unavailable", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "");
    await expect(investigate("semiconductor supply chain")).rejects.toMatchObject({
      code: "CONFIGURATION_REQUIRED",
    });
  });
});
