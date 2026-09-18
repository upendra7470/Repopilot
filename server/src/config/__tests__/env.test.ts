import { describe, it, expect, beforeEach } from "vitest";
import { getEnv, resetEnv } from "../env.js";

describe("env config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetEnv();
    process.env = { ...originalEnv };
    // Set DATABASE_URL so config can load
    process.env.DATABASE_URL = "postgresql://localhost:5432/repopilot_test";
  });

  it("loads successfully with valid config", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/testdb";
    const env = getEnv();
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/testdb");
  });

  it("uses default DATABASE_URL when not set", () => {
    delete process.env.DATABASE_URL;
    const env = getEnv();
    expect(env.DATABASE_URL).toBe("postgresql://localhost:5432/repopilot");
  });

  it("applies default values correctly", () => {
    const env = getEnv();
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CORS_ORIGIN).toBe("http://localhost:5173");
  });
});
