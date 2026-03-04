export interface LLMProvider {
  chat: (prompt: string) => Promise<string>;
}

export interface LLMProviderOptions {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function createLLMProvider(options: LLMProviderOptions): LLMProvider {
  const { provider, apiKey, model, baseUrl } = options;

  if (provider === "anthropic") {
    return {
      async chat(prompt: string): Promise<string> {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        });
        const block = response.content[0];
        return block.type === "text" ? block.text : "";
      },
    };
  }

  // openai-compatible (covers OpenAI, LM Studio, Ollama chat, etc.)
  return {
    async chat(prompt: string): Promise<string> {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
      });
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
