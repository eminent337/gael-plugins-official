import fs from 'fs';
import path from 'path';
import os from 'os';

const CRON_DIR = path.join(os.homedir(), '.agent-cron');

if (!fs.existsSync(CRON_DIR)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
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
        send({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "agent-cron", version: "1.0.0" }
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
                        name: "schedule_task",
                        description: "Schedule a bash script or command to run repeatedly at a certain interval.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                name: { type: "string", description: "Name of the task" },
                                command: { type: "string", description: "The command to run" },
                                schedule: { type: "string", description: "Natural language schedule description e.g. 'Daily at 4PM'" }
                            },
                            required: ["name", "command", "schedule"]
                        }
                    }
                ]
            }
        });
    } else if (msg.method === 'tools/call') {
        try {
            if (msg.params.name === 'schedule_task') {
                const { name, command, schedule } = msg.params.arguments;
                const taskFile = path.join(CRON_DIR, `${name.replace(/[^a-z0-9]/gi, '_')}.task.json`);
                
                fs.writeFileSync(taskFile, JSON.stringify({ name, command, schedule, createdAt: new Date().toISOString() }, null, 2), 'utf8');
                
                send({
                    jsonrpc: "2.0", id: msg.id,
                    result: { content: [{ type: "text", text: `Task '${name}' scheduled for '${schedule}'. Note: Aery's background cron-daemon must be running for this to trigger.` }] }
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
