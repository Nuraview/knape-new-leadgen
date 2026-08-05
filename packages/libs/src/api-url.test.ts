import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./api-url";

describe("resolveApiBaseUrl", () => {
  it("appends /api when the base has no api suffix", () => {
    expect(resolveApiBaseUrl("http://localhost:1337")).toBe(
      "http://localhost:1337/api",
    );
  });

  /*
   * The regression this file failed to catch: absent used to mean localhost
   * here while the app's other helper read absent as same-origin. When the SPA
   * build moved out of Docker the build ARG vanished, VITE_API_URL became
   * undefined, and the Projects page started fetching from the viewer's own
   * machine — rendering "No projects yet" over perfectly good data.
   */
  it("treats absent and empty alike as same-origin, never localhost", () => {
    expect(resolveApiBaseUrl(undefined)).toBe("/api");
    expect(resolveApiBaseUrl("")).toBe("/api");
    expect(resolveApiBaseUrl("   ")).not.toContain("localhost");
  });

  it("returns the URL unchanged when it already ends with /api", () => {
    expect(resolveApiBaseUrl("http://localhost:1337/api")).toBe(
      "http://localhost:1337/api",
    );
  });

  it("strips trailing slashes before appending /api", () => {
    expect(resolveApiBaseUrl("http://localhost:1337/")).toBe(
      "http://localhost:1337/api",
    );
    expect(resolveApiBaseUrl("http://localhost:1337/api/")).toBe(
      "http://localhost:1337/api",
    );
  });
});
