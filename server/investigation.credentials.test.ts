import { describe, expect, it } from "vitest";

describe("CHAINTRACE external credentials", () => {
  it("can reach SerpApi and OpenRouter with server-only keys", async () => {
    const serpKey = process.env.SERPAPI_API_KEY;
    const routerKey = process.env.OPENROUTER_API_KEY;
    expect(serpKey, "SERPAPI_API_KEY must be configured").toBeTruthy();
    expect(routerKey, "OPENROUTER_API_KEY must be configured").toBeTruthy();

    const serpResponse = await fetch(`https://serpapi.com/search.json?engine=google&q=semiconductor&api_key=${encodeURIComponent(serpKey!)}&num=1`);
    expect(serpResponse.ok, `SerpApi returned ${serpResponse.status}`).toBe(true);

    const routerResponse = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${routerKey}` },
    });
    expect(routerResponse.ok, `OpenRouter returned ${routerResponse.status}`).toBe(true);
  }, 30000);
});
