import fs from 'fs';

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const line of parts) {
        if (!line.trim()) continue;
        try { handleMessage(JSON.parse(line)); } catch (e) {}
    }
});

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

async function triggerHomeAssistant(action, entity_id) {
    if (!process.env.HA_BEARER_TOKEN) {
        return "Home Assistant error: HA_BEARER_TOKEN is not set in your .env. The agent cannot communicate with localhost:8123.";
    }

    try {
        const domain = entity_id.split('.')[0];
        const url = `http://localhost:8123/api/services/${domain}/${action}`;
        
        const req = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.HA_BEARER_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ entity_id })
        });
        
        if (!req.ok) throw new Error(`HTTP ${req.status}`);
        const data = await req.json();
        
        return `Successfully triggered ${action} on ${entity_id}. Response: ${JSON.stringify(data)}`;
    } catch (e) {
        return `Failed to trigger Home Assistant: ${e.message}`;
    }
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        const instruct = "You have access to Home Assistant via localhost. You can use 'iot_action' to communicate with smart home devices if instructed by the user.";
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                protocolVersion: "2024-11-05", capabilities: { tools: {} },
                serverInfo: { name: "home-assistant-bridge", version: "1.0.0" },
                instructions: instruct
            }
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
    } else if (msg.method === 'tools/list') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                tools: [
                    {
                        name: "iot_action",
                        description: "Trigger a local Home Assistant IoT device action.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                action: { type: "string", description: "e.g., 'turn_on', 'turn_off', 'toggle'" },
                                entity_id: { type: "string", description: "e.g., 'light.office_desk', 'switch.dev_server'" }
                            }, required: ["action", "entity_id"]
                        }
                    }
                ]
            }
        });
    } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        if (name === 'iot_action') {
            triggerHomeAssistant(args.action, args.entity_id).then(res => {
                send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: res }] } });
            });
        }
    }
}
