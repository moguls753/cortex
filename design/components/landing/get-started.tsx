import { ArrowRight, Github } from "lucide-react"

export function GetStarted() {
  return (
    <section id="get-started" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        {/* Section header */}
        <div className="mb-12 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-primary">
            Get started
          </p>
          <h2 className="text-balance text-2xl font-bold text-foreground md:text-3xl">
            Deploy in minutes.
          </h2>
        </div>

        <div className="flex flex-col gap-8 md:flex-row md:gap-12">
          {/* Installation steps */}
          <div className="flex-1">
            <div className="rounded-sm border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5">
                <span className="text-xs text-muted-foreground">
                  terminal
                </span>
              </div>
              <div className="p-4">
                <pre className="text-xs leading-7 md:text-sm md:leading-8">
                  <code>
                    <span className="text-muted-foreground">
                      {"# Clone the repo"}
                    </span>
                    {"\n"}
                    <span className="text-primary">$</span>
                    <span className="text-foreground">
                      {" git clone https://github.com/cortex/cortex"}
                    </span>
                    {"\n"}
                    <span className="text-primary">$</span>
                    <span className="text-foreground">{" cd cortex"}</span>
                    {"\n\n"}
                    <span className="text-muted-foreground">
                      {"# Configure your environment"}
                    </span>
                    {"\n"}
                    <span className="text-primary">$</span>
                    <span className="text-foreground">
                      {" cp .env.example .env"}
                    </span>
                    {"\n"}
                    <span className="text-primary">$</span>
                    <span className="text-foreground">
                      {" nano .env  # add your API keys"}
                    </span>
                    {"\n\n"}
                    <span className="text-muted-foreground">
                      {"# Launch with Docker"}
                    </span>
                    {"\n"}
                    <span className="text-primary">$</span>
                    <span className="text-foreground">
                      {" docker compose up -d"}
                    </span>
                    {"\n\n"}
                    <span className="text-muted-foreground">
                      {"# Cortex is running at localhost:3000"}
                    </span>
                  </code>
                </pre>
              </div>
            </div>
          </div>

          {/* Quick info */}
          <div className="flex flex-1 flex-col gap-6">
            <div className="flex flex-col gap-4">
              {[
                {
                  label: "Requirements",
                  value: "Docker, an LLM API key (or Ollama for local)",
                },
                {
                  label: "Setup time",
                  value: "Under 5 minutes for basic config",
                },
                {
                  label: "LLM options",
                  value:
                    "Anthropic, OpenAI, or any OpenAI-compatible endpoint",
                },
                {
                  label: "Telegram",
                  value:
                    "Optional. Create a bot via @BotFather for mobile capture",
                },
                {
                  label: "Email digests",
                  value: "Optional. Configure SMTP for daily/weekly briefings",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col gap-1 border-l-2 border-border pl-4"
                >
                  <p className="text-xs font-medium text-foreground">
                    {item.label}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 rounded-sm bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Github className="h-4 w-4" />
                Clone repo
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
