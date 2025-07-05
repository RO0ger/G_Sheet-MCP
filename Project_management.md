# Meeting Hypothesis Evaluator - MCP-First Project Plan

## End-to-End Workflow

1.  **Input**: User pastes a meeting transcript into a simple HTML frontend.
2.  **Trigger**: The frontend `POST`s the transcript to the `/meeting-ended` webhook.
3.  **Orchestration**: The `MeetingProcessor` loads hypotheses from Google Sheets.
4.  **AI Processing**: For each hypothesis, Gemini extracts quotes and generates a score based on the provided transcript.
5.  **Output**: Results are updated in-place for each hypothesis row in the original Google Sheet.
6.  **Notification**: A success message is sent to Slack.

## MCP MVP: 4 Tools, Zero Hardcoding, 7 Hours

**Core:** MCP server with configurable tools → Everything else is just plumbing

```
MCP Tools (4):
├── gsheets_load_hypotheses
├── gsheets_update_hypotheses
├── gemini_analyze_hypothesis
└── slack_send_notification
```

## Hour-by-Hour: MCP Tool Development

### Hours 1-2: Config + Foundation MCP Tools
**Target:** 1/4 tools working with config system

```typescript
// config/index.ts - Exactly as PRD specifies
export const config: AppConfig = {
  apis: {
    grain: { baseUrl: process.env.GRAIN_BASE_URL!, apiKey: process.env.GRAIN_API_KEY! },
    gemini: { model: process.env.GEMINI_MODEL || 'gemini-pro' },
    google: { spreadsheetId: process.env.GOOGLE_SHEET_ID! },
    slack: { webhookUrl: process.env.SLACK_WEBHOOK_URL! }
  },
  files: {
    promptsDir: process.env.PROMPTS_DIR || './prompts'
  }
};
```

**MCP Tools Built:**
- [x] `gsheets_load_hypotheses` - Load from Google Sheet using config.apis.google.spreadsheetId

**Test:** MCP server responds to ListTools, `gsheets_load_hypotheses` executes successfully.

### Hour 3: Google Sheets Tools Complete
**Target:** 2/4 tools working

**MCP Tools Built:**
- [x] `gsheets_update_hypotheses` - Updates rows in-place in the Google Sheet using config.apis.google.spreadsheetId

**Update logic:**
```typescript
// Performs a batch update of individual cells to preserve
// existing data and only write analysis results.
```

### Hour 4: Gemini Tools with Prompts
**Target:** 3/4 tools complete

**Prompt System (exactly PRD structure):**
```
prompts/
├── hypothesis-enrichment.txt
└── index.ts (PromptManager)
```

**MCP Tools Built:**
- [x] `gemini_analyze_hypothesis` - Uses prompts/hypothesis-enrichment.txt template

**Retry logic as PRD specifies:**
```typescript
maxRetries: config.apis.gemini.maxRetries,
retryDelay: config.apis.gemini.retryDelay
```

### Hour 5: Slack Tool + Testing
**Target:** All 4 tools tested end-to-end

**MCP Tools Complete:**
- [x] `slack_send_notification` - Uses config.apis.slack.webhookUrl
- [x] Message formatting exactly as PRD slackFormatter interface

**Test all 4 tools:**
```bash
echo '{"method": "tools/call", "params": {"name": "gsheets_load_hypotheses"}}' | node mcp-server.js
```

### Hour 6: Orchestrator (Tool Chain)
**Target:** Automated workflow using MCP tools

```typescript
// orchestrator.ts - Chain MCP tool calls
export class MeetingProcessor {
  async processWorkflowWithTranscript(transcript: string, meetingId: string) {
    const hypotheses = await this.callTool('gsheets_load_hypotheses', {});
    
    const allResults = [];
    for (const hypothesis of hypotheses) {
      const analysis = await this.callTool('gemini_analyze_hypothesis', { transcript, hypothesis });
      allResults.push({ hypothesis_id: hypothesis.ID, analysis });
    }
    
    await this.callTool('gsheets_update_hypotheses', { results: allResults });
    
    const summary = { meetingId, totalHypotheses: hypotheses.length, ... };
    await this.callTool('slack_send_notification', { summary });
  }
}
```

### Hour 7: MCP Server Endpoint (Webhook)
**Target:** HTTP webhook triggers MCP orchestrator

```typescript
// server.ts - Unified Express server
app.post(config.server.webhookPath, async (req, res) => {
  const { transcript, meeting_id } = req.body;
  const processor = new MeetingProcessor();
  // Note: Production features like concurrency and timeout handling are omitted for brevity
  await processor.processWorkflowWithTranscript(transcript, meeting_id || `meeting-${Date.now()}`);
  res.status(202).json({ message: 'Processing started' });
});
```

**Production features as PRD:**
- Health check endpoint

## Critical Success: MCP Tool Quality

Each tool must handle errors exactly as PRD specifies:

**Google Sheets Tools:**
- Must use `googleapis` library.
- Must handle API permissions/authentication errors.
- Must update cells in-place to avoid data loss.

**Gemini Tools:**  
- Must use external prompt files from prompts/ directory
- Must implement retry with exponential backoff
- Must parse JSON responses safely

**Slack Tool:**
- Must use slackFormatter interface from PRD
- Must format ProcessingSummary exactly as specified

## Quality Gates (MCP-Focused)

**Hour 2:** 1 MCP tool responds correctly
**Hour 4:** All 4 MCP tools work individually  
**Hour 6:** MCP tool chain completes full workflow
**Hour 7:** Webhook triggers MCP workflow successfully

## Files Delivered (Exactly PRD Structure)

```
src/
├── config/
│   └── index.ts
├── orchestrator.ts
├── prompts/
│   ├── hypothesis-enrichment.txt
│   ├── hypothesis-scoring.txt
│   ├── index.ts
│   └── quote-extraction.txt
├── public/
│   └── index.html
├── server.ts
├── tools/
│   ├── gemini.ts
│   ├── google-sheets.ts
│   ├── index.ts
│   └── slack.ts
├── types/
└── utils/
    ├── api-client.ts
    ├── formatters.ts
    └── logger.ts
```

## Success Criteria

**MCP MVP Working:**
```bash
# All 4 tools listed
echo '{"method": "tools/list"}' | node mcp-server.js

# Full workflow via webhook  
curl -X POST localhost:8080/meeting-ended -H "Content-Type: application/json" -d '{"transcript": "Speaker 1: I think this is a great idea. Speaker 2: I disagree."}'
# → Processes meeting via MCP tool chain
# → Updates Google Sheet rows in-place
# → Sends Slack notification
```

**Zero Hardcoding Verified:**
- All URLs/keys from environment variables
- Google Sheet ID is configurable
- All prompts in external files
- All timeouts/retries configurable

The MCP server IS the product. Everything else just triggers it.