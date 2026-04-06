import fs from 'fs';
import path from 'path';
import os from 'os';

const MEMORY_FILE = path.join(os.homedir(), '.agent-memory', 'conversations.jsonl');
const MEMORY_DIR = path.dirname(MEMORY_FILE);

if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const line of parts) {
        if (!line.trim()) continue;
        try {
            handleMessage(JSON.parse(line));
        } catch (e) {}
    }
});

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        const memInstruct = `You have an FTS Cross-Session persistent memory. Use the 'search_memory' tool to recall context about the user's project, previous sessions, and preferences. Use the 'store_memory' tool to save newly discovered facts or summarizations for the future.`;
        send({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "long-term-memory", version: "1.0.0" },
                instructions: memInstruct
            }
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
    } else if (msg.method === 'tools/list') {
        send({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
                tools: [
                    {
                        name: "store_memory",
                        description: "Store a fact, decision, user preference, or conversation summary into long term cross-session memory.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                text: { type: "string", description: "The information to permanently memorize" }
                            },
                            required: ["text"]
                        }
                    },
                    {
                        name: "search_memory",
                        description: "Fuzzy search past memories and past session conversations using keywords.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                query: { type: "string", description: "Keyword string to search for" }
                            },
                            required: ["query"]
                        }
                    }
                ]
            }
        });
    } else if (msg.method === 'tools/call') {
        try {
            if (msg.params.name === 'store_memory') {
                const { text } = msg.params.arguments;
                const entry = JSON.stringify({ timestamp: new Date().toISOString(), text }) + '\n';
                fs.appendFileSync(MEMORY_FILE, entry, 'utf8');
                send({
                    jsonrpc: "2.0", id: msg.id,
                    result: { content: [{ type: "text", text: `Memory successfully stored.` }] }
                });
            } else if (msg.params.name === 'search_memory') {
                const { query } = msg.params.arguments;
                const terms = query.toLowerCase().split(' ');
                
                let results = [];
                if (fs.existsSync(MEMORY_FILE)) {
                    const lines = fs.readFileSync(MEMORY_FILE, 'utf8').split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const parsed = JSON.parse(line);
                        const txt = parsed.text.toLowerCase();
                        if (terms.every(t => txt.includes(t))) {
                            results.push(`[${parsed.timestamp}] ${parsed.text}`);
                        }
                    }
                }
                send({
                    jsonrpc: "2.0", id: msg.id,
                    result: { content: [{ type: "text", text: results.length > 0 ? results.join('\n') : "No memories found." }] }
                });
            } else {
                throw new Error("Unknown tool.");
            }
        } catch (err) {
            send({
                jsonrpc: "2.0", id: msg.id,
                result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }
            });
        }
    }
}
