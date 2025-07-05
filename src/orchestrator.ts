import { logger } from './utils/logger.js';
import { ProcessingSummary } from './utils/formatters.js';
import { config } from './config/index.js';

// Define a basic type for our hypothesis structure
interface Hypothesis {
  id: string;
  description: string;
  test_questions: string[];
}

export class MeetingProcessor {
  private serverUrl: string;

  constructor() {
    this.serverUrl = `http://localhost:${config.server.port}/mcp`;
  }

  private async callTool(name: string, args: Record<string, any>): Promise<any> {
    logger.info(`Orchestrator calling tool: ${name}`);
    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `mcp-call-${Date.now()}`,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });

      if (!response.ok) {
        throw new Error(`MCP server request failed with status: ${response.status}`);
      }

      const rpcResponse = await response.json();
      if (rpcResponse.error) {
        throw new Error(`MCP tool error: ${rpcResponse.error.message}`);
      }

      // Handle both complex (stringified) and simple results
      const result = rpcResponse.result;
      let content;
      if (result.content && result.content[0] && typeof result.content[0].text === 'string') {
        content = JSON.parse(result.content[0].text);
      } else {
        content = result; // Assume it's a direct JSON object
      }
      
      logger.success(`Tool ${name} executed successfully.`);
      return content;
    } catch (error: any) {
      logger.error(`Error calling tool ${name}`, error.message);
      throw error;
    }
  }

  async processWorkflowWithTranscript(transcript: string, meetingId: string = 'transcript-provided'): Promise<void> {
    const startTime = Date.now();
    logger.info(`Starting analysis for meeting: ${meetingId} with provided transcript.`);
    const BATCH_SIZE = 5; // Process 5 hypotheses at a time

    try {
      // 1. Load Hypotheses from Google Sheets
      const hypotheses: any[] = await this.callTool('gsheets_load_hypotheses', {});

      // 2. Process hypotheses in batches
      logger.info(`Analyzing ${hypotheses.length} hypotheses...`);
      const allResults = [];
      for (const hypothesis of hypotheses) {
        if (!hypothesis.ID || !hypothesis.Hypothesis) {
          logger.warn('Skipping row with missing ID or Hypothesis description.', { row: hypothesis });
          continue;
        }
        
        const analysis = await this.callTool('gemini_analyze_hypothesis', {
          transcript,
          hypothesis: {
            id: hypothesis.ID,
            description: hypothesis.Hypothesis,
          }
        });
        
        logger.info(`=== GEMINI ANALYSIS DEBUG ===`);
        logger.info(`Hypothesis ID: ${hypothesis.ID}`);
        logger.info(`Analysis keys: ${Object.keys(analysis || {})}`);
        logger.info(`Analysis content: ${JSON.stringify(analysis, null, 2)}`);
        logger.info(`=== END DEBUG ===`);

        allResults.push({
          hypothesis_id: hypothesis.ID,
          analysis,
        });
      }

      // 3. Write all results back to Google Sheets in one batch
      logger.info(`About to update ${allResults.length} results`);
      allResults.forEach((result, index) => {
        logger.info(`Result ${index}: hypothesis_id=${result.hypothesis_id}, analysis keys=${Object.keys(result.analysis || {})}`);
      });
      await this.callTool('gsheets_update_hypotheses', { results: allResults });

      // 4. Send Notification
      const duration = Date.now() - startTime;
      const summary = {
          meetingId,
          totalHypotheses: hypotheses.length,
          processedCount: allResults.length,
          duration,
          processedAt: new Date().toISOString()
      };
      await this.callTool('slack_send_notification', { summary });

      logger.success(`Workflow completed for meeting: ${meetingId}`, { duration: `${duration}ms` });
    } catch (error: any) {
        logger.error(`Workflow failed for meeting: ${meetingId}`, error);
        // Optionally send an error notification via Slack
        await this.callTool('slack_send_notification', {
            summary: { meetingId, error: error.message }
        }).catch(e => logger.error('Failed to send error notification', e));
    }
  }
}