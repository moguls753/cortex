import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-tools.js";
import { createDbConnection } from "./db/index.js";
import { config } from "./config.js";

const sql = createDbConnection(config.databaseUrl);
const server = createMcpServer(sql);
const transport = new StdioServerTransport();

await server.connect(transport);
