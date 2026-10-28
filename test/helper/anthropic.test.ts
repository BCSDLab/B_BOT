import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

import { generateStructured } from "~/infra/anthropic";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["intent"],
  properties: { intent: { type: "string", enum: ["answer", "dashboard"] } },
};

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
  create.mockReset();
  create.mockResolvedValue({
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"intent":"answer"}' }],
  });
});

describe("Structured output request contract", () => {
  it("sends the caller's schema unchanged", async () => {
    await generateStructured({ system: "s", prompt: "p", schema, maxTokens: 64 });
    expect(create.mock.calls[0][0].output_config.format.schema).toBe(schema);
  });

  it("disables thinking so short calls are not truncated", async () => {
    await generateStructured({ system: "s", prompt: "p", schema, maxTokens: 64 });
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
  });

  it("fails instead of parsing JSON cut off by the output limit", async () => {
    create.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"intent":"answer"' }] });
    await expect(generateStructured({ system: "s", prompt: "p", schema })).rejects.toThrow("잘렸습니다");
  });
});
