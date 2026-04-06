import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const CKPT_DIR = path.join(os.homedir(), '.agent-checkpoints');

if (!fs.existsSync(CKPT_DIR)) {
    fs.mkdirSync(CKPT_DIR, { recursive: true });
}

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

async function createCheckpoint(cwd, label) {
    const id = `${Date.now()}-${label.replace(/[^a-z0-9]/gi, '_')}`;
    const dest = path.join(CKPT_DIR, id);
    
    // Windows robocopy or powershell copy
    if (process.platform === 'win32') {
        try {
            await execAsync(`powershell -NoProfile -Command "Copy-Item -Path '${cwd}' -Destination '${dest}' -Recurse -Force"`);
            return `Checkpoint created successfully at ${dest}. ID to revert: ${id}`;
        } catch (e) {
            return `Warning: Fallback copy used. ${e.message}`;
        }
    } else {
        await execAsync(`cp -r "${cwd}" "${dest}"`);
        return `Checkpoint created successfully. ID to revert: ${id}`;
    }
}

async function revertCheckpoint(cwd, id) {
    const src = path.join(CKPT_DIR, id);
    if (!fs.existsSync(src)) return `Error: Checkpoint ${id} not found.`;
    
    if (process.platform === 'win32') {
        await execAsync(`powershell -NoProfile -Command "Remove-Item -Path '${cwd}\\*' -Recurse -Force"`);
        await execAsync(`powershell -NoProfile -Command "Copy-Item -Path '${src}\\*' -Destination '${cwd}' -Recurse -Force"`);
    } else {
        await execAsync(`rm -rf "${cwd}"/*`);
        await execAsync(`cp -r "${src}"/* "${cwd}"/`);
    }
    return `Successfully rolled back workspace to checkpoint ${id}.`;
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                protocolVersion: "2024-11-05", capabilities: { tools: {} },
                serverInfo: { name: "auto-rollback", version: "1.0.0" }
            }
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
    } else if (msg.method === 'tools/list') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                tools: [
                    {
                        name: "checkpoint_create",
                        description: "Create a full backup of the current workspace before making risky or large-scale architectural changes.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                label: { type: "string" },
                                cwd: { type: "string", description: "Absolute path to workspace directory to backup" }
                            }, required: ["label", "cwd"]
                        }
                    },
                    {
                        name: "checkpoint_revert",
                        description: "Instantly rollback the workspace to a previous checkpoint ID if your changes break things.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                cwd: { type: "string", description: "Absolute path to workspace directory to revert" }
                            }, required: ["id", "cwd"]
                        }
                    }
                ]
            }
        });
    } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        if (name === 'checkpoint_create') {
            createCheckpoint(args.cwd, args.label).then(res => {
                send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: res }] } });
            });
        } else if (name === 'checkpoint_revert') {
            revertCheckpoint(args.cwd, args.id).then(res => {
                send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: res }] } });
            });
        }
    }
}
