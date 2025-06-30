// Tool definitions for the Meeting Hypothesis Evaluator MCP.
import { loadHypotheses, updateHypotheses } from './google-sheets.js';
import { analyzeHypothesis } from './gemini.js';
import { sendSlackNotification } from './slack.js';
// A map of all available tools
export const toolImplementations = {
    gemini_analyze_hypothesis: (args) => analyzeHypothesis(args),
    gsheets_load_hypotheses: () => loadHypotheses(),
    gsheets_update_hypotheses: (args) => updateHypotheses(args),
    slack_send_notification: (args) => sendSlackNotification(args),
};
// JSON schema definitions for the tools
export const toolSchemas = [
    {
        name: 'gemini_analyze_hypothesis',
        description: 'Analyzes a transcript against a hypothesis to enrich it with details like pain, status, and quotes.',
        parameters: {
            type: 'object',
            properties: {
                hypothesis: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        description: { type: 'string' },
                    },
                    required: ['id', 'description'],
                },
                transcript: { type: 'string' },
            },
            required: ['hypothesis', 'transcript'],
        },
    },
    {
        name: 'gsheets_load_hypotheses',
        description: 'Loads all hypotheses from the configured Google Sheet.',
        parameters: { type: 'object', properties: {} },
    },
    {
        name: 'gsheets_update_hypotheses',
        description: 'Updates a batch of hypotheses in-place in the Google Sheet.',
        parameters: {
            type: 'object',
            properties: {
                results: { type: 'array' },
            },
            required: ['results'],
        },
    },
    {
        name: 'slack_send_notification',
        description: 'Sends a message to a Slack channel.',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'object' },
            },
            required: ['summary'],
        },
    },
];
/**
 * Handles a tool call by finding the appropriate tool and executing it.
 * @param name The name of the tool to call.
 * @param args The arguments for the tool.
 * @returns The result of the tool execution.
 */
export async function handleToolCall(name, args) {
    const tool = toolImplementations[name];
    if (!tool) {
        throw new Error(`Tool "${name}" not found.`);
    }
    return tool(args);
}
