import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

import { generateStructured, sanitizeSchema } from "~/infra/anthropic";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "charts"],
  properties: {
    title: { type: "string", maxLength: 100 },
    charts: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rowLimit"],
        properties: { rowLimit: { type: "integer", minimum: 1, maximum: 100 } },
      },
    },
  },
};

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
  create.mockReset();
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: '{"title":"t","charts":[]}' }] });
});

describe("Structured output request contract", () => {
  it("moves constraints the Claude API rejects into field descriptions", () => {
    const sanitized = sanitizeSchema(schema) as {
      properties: { title: Record<string, unknown>; charts: Record<string, unknown> & { items: { properties: { rowLimit: Record<string, unknown> } } } };
    };
    expect(sanitized.properties.title).not.toHaveProperty("maxLength");
    expect(sanitized.properties.title.description).toContain("maxLength: 100");
    expect(sanitized.properties.charts).not.toHaveProperty("maxItems");
    expect(sanitized.properties.charts).toMatchObject({ minItems: 1 });
    expect(sanitized.properties.charts.description).toContain("maxItems: 4");
    expect(sanitized.properties.charts.items.properties.rowLimit).not.toHaveProperty("minimum");
    expect(sanitized.properties.charts.items.properties.rowLimit.description).toBe("Constraints: minimum: 1, maximum: 100");
  });

  it("sends a sanitized schema with thinking disabled so short calls are not truncated", async () => {
    await generateStructured({ system: "s", prompt: "p", schema, maxTokens: 64 });
    const request = create.mock.calls[0][0];
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.output_config.format.schema).toEqual(sanitizeSchema(schema));
    expect(JSON.stringify(request.output_config.format.schema)).not.toMatch(/"(maxItems|maxLength|minimum|maximum)"\s*:/);
  });

  it("fails instead of parsing JSON cut off by the output limit", async () => {
    create.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"title":"t"' }] });
    await expect(generateStructured({ system: "s", prompt: "p", schema })).rejects.toThrow("잘렸습니다");
  });
});
