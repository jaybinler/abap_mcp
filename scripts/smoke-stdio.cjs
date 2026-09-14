// Offline protocol check: never calls a SAP-facing tool.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');
async function main() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SAP_|MCP_|RFC_|TOKEN_FILE$)/i.test(key)));
  Object.assign(env, { SAP_URL: 'http://127.0.0.1:1', SAP_USER: 'offline-test', SAP_PASSWORD: 'offline-test', MCP_TRANSPORT: 'stdio', TOKEN_FILE: path.join(__dirname, 'nonexistent-test-tokens.json') });
  const transport = new StdioClientTransport({ command: process.execPath, args: [process.argv[2] || path.resolve(__dirname, '../dist/index.js')], env, stderr: 'pipe' });
  const client = new Client({ name: 'offline-verification', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const manifest = require('../manifest.json');
    if (tools.length !== 85 || new Set(tools.map(t => t.name)).size !== 85) throw new Error('Expected 85 unique tools');
    if (JSON.stringify(tools.map(t => t.name).sort()) !== JSON.stringify(manifest.tools.map(t => t.name).sort())) throw new Error('Manifest tools differ');
    if (client.getServerVersion().version !== manifest.version) throw new Error('Version differs');
    console.log(JSON.stringify({ version: client.getServerVersion().version, tools: tools.length, protocol: 'stdio', sapCalls: 0 }));
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
