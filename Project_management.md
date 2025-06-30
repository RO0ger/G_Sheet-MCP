# Meeting Hypothesis Evaluator - MCP-First Project Plan

## End-to-End Workflow

1.  **Input**: User pastes a meeting transcript into a simple HTML frontend.
2.  **Trigger**: The frontend `POST`s the transcript to the `/meeting-ended` webhook.
3.  **Orchestration**: The `MeetingProcessor` loads hypotheses from Google Sheets.
4.  **AI Processing**: For each hypothesis, Gemini extracts quotes and generates a score based on the provided transcript.
5.  **Output**: Results are written to a new tab in the Google Sheet.
6.  **Notification**: A success message is sent to Slack.

## MCP MVP: 5 Tools, Zero Hardcoding, 7 Hours

**Core:** MCP server with configurable tools → Everything else is just plumbing

```
MCP Tools (5):
├── gsheets_load_hypotheses
├── gsheets_write_results
├── gemini_extract_quotes
├── gemini_score_hypothesis
└── slack_send_notification
```

## Hour-by-Hour: MCP Tool Development

### Hours 1-2: Config + Foundation MCP Tools
**Target:** 1/5 tools working with config system

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
**Target:** 3/5 tools working

**MCP Tools Built:**
- [x] `gsheets_write_results` - Write to Google Sheet using config.apis.google.spreadsheetId
- [x] PRD requirement: Generate unique sheet title with timestamp to prevent collisions

**Sheet naming exactly as PRD:**
```typescript
const timestamp = new Date().toISOString();
const newSheetTitle = `Results @ ${timestamp}`;
```

### Hour 4: Gemini Tools with Prompts
**Target:** 5/5 tools complete

**Prompt System (exactly PRD structure):**
```
prompts/
├── quote-extraction.txt
├── hypothesis-scoring.txt  
└── index.ts (PromptManager)
```

**MCP Tools Built:**
- [x] `gemini_extract_quotes` - Uses prompts/quote-extraction.txt template
- [x] `gemini_score_hypothesis` - Uses prompts/hypothesis-scoring.txt template

**Retry logic as PRD specifies:**
```typescript
maxRetries: config.apis.gemini.maxRetries,
retryDelay: config.apis.gemini.retryDelay
```

### Hour 5: Slack Tool + Testing
**Target:** All 5 tools tested end-to-end

**MCP Tools Complete:**
- [x] `slack_send_notification` - Uses config.apis.slack.webhookUrl
- [x] Message formatting exactly as PRD slackFormatter interface

**Test all 5 tools:**
```bash
echo '{"method": "tools/call", "params": {"name": "gsheets_load_hypotheses"}}' | node mcp-server.js
```

### Hour 6: Orchestrator (Tool Chain)
**Target:** Automated workflow using MCP tools

```typescript
// orchestrator.ts - Chain MCP tool calls
export class MeetingProcessor {
  async processWorkflow(transcript: string, meetingId: string) {
    const hypotheses = await this.callTool('gsheets_load_hypotheses', {});
    
    const results = [];
    for (const hypothesis of hypotheses) {
      const quotes = await this.callTool('gemini_extract_quotes', { transcript, hypothesis });
      const score = await this.callTool('gemini_score_hypothesis', { hypothesis, quotes });
      results.push({ hypothesis_id: hypothesis.id, score, quotes });
    }
    
    await this.callTool('gsheets_write_results', { results });
    
    const results_summary = { meetingId, totalHypotheses: hypotheses.length, ... };
    await this.callTool('slack_send_notification', { results_summary });
  }
}
```

### Hour 7: Webhook + Production Ready
**Target:** HTTP webhook triggers MCP orchestrator

```typescript
// webhook.ts - Express server exactly as PRD
app.post(config.server.webhookPath, async (req, res) => {
  const { transcript, meeting_id } = req.body;
  const processor = new MeetingProcessor();
  // Note: Production features like concurrency and timeout handling are omitted for brevity
  await processor.processWorkflow(transcript, meeting_id || `meeting-${Date.now()}`);
  res.status(200).json({ message: 'Processing started' });
});
```

**Production features as PRD:**
- Health check endpoint

## Critical Success: MCP Tool Quality

Each tool must handle errors exactly as PRD specifies:

**Google Sheets Tools:**
- Must use `googleapis` library.
- Must handle API permissions/authentication errors.
- Must generate unique sheet titles for concurrent writes.

**Gemini Tools:**  
- Must use external prompt files from prompts/ directory
- Must implement retry with exponential backoff
- Must parse JSON responses safely

**Slack Tool:**
- Must use slackFormatter interface from PRD
- Must format ProcessingSummary exactly as specified

## Quality Gates (MCP-Focused)

**Hour 2:** 1 MCP tool responds correctly
**Hour 4:** All 5 MCP tools work individually  
**Hour 6:** MCP tool chain completes full workflow
**Hour 7:** Webhook triggers MCP workflow successfully

## Files Delivered (Exactly PRD Structure)

```
src/
├── config/index.ts          # AppConfig interface exactly as PRD
├── utils/
│   ├── logger.ts            # Logger interface as PRD  
│   └── formatters.ts        # SlackFormatter as PRD
├── prompts/
│   ├── quote-extraction.txt # Exact PRD template
│   ├── hypothesis-scoring.txt # Exact PRD template  
│   └── index.ts             # PromptManager as PRD
├── mcp-server.ts            # 5 tools, ListTools handler
├── orchestrator.ts          # MeetingProcessor class
└── webhook.ts               # Express server
```

## Success Criteria

**MCP MVP Working:**
```bash
# All 5 tools listed
echo '{"method": "tools/list"}' | node mcp-server.js

# Full workflow via webhook  
curl -X POST localhost:8080/meeting-ended -H "Content-Type: application/json" -d '{"transcript": "Speaker 1: I think this is a great idea. Speaker 2: I disagree."}'
# → Processes meeting via MCP tool chain
# → Writes Google Sheet results with timestamp
# → Sends Slack notification
```

**Zero Hardcoding Verified:**
- All URLs/keys from environment variables
- Google Sheet ID is configurable
- All prompts in external files
- All timeouts/retries configurable

The MCP server IS the product. Everything else just triggers it.