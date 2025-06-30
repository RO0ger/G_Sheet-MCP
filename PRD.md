# Meeting Hypothesis Evaluator - 10/10 Build Plan (Production Ready)

**Timeline:** 7 hours
**Outcome:** Configurable, scalable system with zero hardcoded values

## End-to-End Workflow

1.  **Input**: A user pastes a meeting transcript into a simple HTML frontend (`public/index.html`).
2.  **Trigger**: The frontend sends a `POST` request to the `/meeting-ended` webhook endpoint with the transcript payload and an optional `meeting_id`.
3.  **Orchestration**:
    - The server receives the transcript.
    - The `MeetingProcessor` orchestrator is invoked.
    - It loads the latest hypotheses from a configured Google Sheet.
4.  **AI Processing**:
    - For each hypothesis, the orchestrator calls the Gemini API.
    - **Quote Extraction**: Identifies relevant quotes from the transcript that support or contradict the hypothesis.
    - **Hypothesis Scoring**: Scores the hypothesis based on the extracted quotes.
5.  **Output**: The orchestrator writes the detailed results (scores, quotes, reasoning) to a new, timestamped tab in the Google Sheet.
6.  **Notification**: A summary notification is sent to a configured Slack channel to report the successful completion of the analysis.

## Configuration-First Architecture

### 1. Config Structure

```typescript
// config/index.ts
export interface AppConfig {
  apis: {
    grain: {
      baseUrl: string;
      apiKey: string;
      timeout: number;
    };
    gemini: {
      baseUrl: string;
      apiKey: string;
      model: string;
      maxRetries: number;
      retryDelay: number;
    };
    google: {
      spreadsheetId: string;
      credentialsPath: string;
    };
    slack: {
      webhookUrl: string;
    };
  };
  files: {
    promptsDir: string;
  };
  server: {
    port: number;
    webhookPath: string;
  };
  processing: {
    maxConcurrentMeetings: number;
    timeoutMs: number;
  };
}

export const config: AppConfig = {
  apis: {
    grain: {
      baseUrl: process.env.GRAIN_BASE_URL || 'https://api.grain.com',
      apiKey: process.env.GRAIN_API_KEY!,
      timeout: Number(process.env.GRAIN_TIMEOUT_MS || 30000)
    },
    gemini: {
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
      apiKey: process.env.GEMINI_API_KEY!,
      model: process.env.GEMINI_MODEL || 'gemini-pro',
      maxRetries: Number(process.env.GEMINI_MAX_RETRIES || 3),
      retryDelay: Number(process.env.GEMINI_RETRY_DELAY || 1000)
    },
    google: {
      spreadsheetId: process.env.GOOGLE_SHEET_ID!,
      credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json'
    },
    slack: {
      webhookUrl: process.env.SLACK_WEBHOOK_URL!
    }
  },
  files: {
    promptsDir: process.env.PROMPTS_DIR || './prompts'
  },
  server: {
    port: Number(process.env.PORT || 8080),
    webhookPath: process.env.WEBHOOK_PATH || '/meeting-ended'
  },
  processing: {
    maxConcurrentMeetings: Number(process.env.MAX_CONCURRENT || 5),
    timeoutMs: Number(process.env.PROCESSING_TIMEOUT || 120000)
  }
};
```

### 2. Prompts as External Files

```
prompts/
├── quote-extraction.txt
├── hypothesis-scoring.txt
└── index.ts
```

**prompts/quote-extraction.txt:**
```
Extract relevant quotes from transcript for hypothesis validation.

HYPOTHESIS: {{hypothesis_description}}
TEST QUESTIONS: {{test_questions}}

TRANSCRIPT: {{transcript}}

Return ONLY valid JSON array of quotes. Each quote must have:
{
  "text": "exact quote text",
  "speaker": "speaker name or 'Unknown'",
  "timestamp": "timestamp or 'Unknown'",
  "relevance_score": number between 7-10,
  "support_type": "VALIDATES" | "CONTRADICTS" | "NEUTRAL"
}

Only include quotes with relevance_score >= 7. Maximum 5 quotes.
```

**prompts/hypothesis-scoring.txt:**
```
Score hypothesis based on extracted quotes.

HYPOTHESIS: {{hypothesis_description}}
QUOTES FOUND: {{quotes_json}}

Return ONLY valid JSON:
{
  "score": number 0-100,
  "confidence": number 0-100,
  "recommendation": "VALIDATE" | "REJECT" | "NEEDS_MORE_DATA",
  "reasoning": "one sentence explanation"
}
```

**prompts/index.ts:**
```typescript
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';

class PromptManager {
  private cache = new Map<string, string>();

  async getPrompt(name: string): Promise<string> {
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    const promptPath = path.join(config.files.promptsDir, `${name}.txt`);
    const prompt = await fs.readFile(promptPath, 'utf-8');
    this.cache.set(name, prompt);
    return prompt;
  }

  fillTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key]?.toString() || match;
    });
  }
}

export const promptManager = new PromptManager();
```

### 3. Logger Abstraction

```typescript
// utils/logger.ts
export interface Logger {
  info(message: string, meta?: any): void;
  success(message: string, meta?: any): void;
  error(message: string, error?: any): void;
  warn(message: string, meta?: any): void;
}

class ConsoleLogger implements Logger {
  info(message: string, meta?: any) {
    console.log(`ℹ️  ${message}`, meta ? JSON.stringify(meta) : '');
  }

  success(message: string, meta?: any) {
    console.log(`✅ ${message}`, meta ? JSON.stringify(meta) : '');
  }

  error(message: string, error?: any) {
    console.error(`❌ ${message}`, error?.message || error);
  }

  warn(message: string, meta?: any) {
    console.warn(`⚠️  ${message}`, meta ? JSON.stringify(meta) : '');
  }
}

export const logger: Logger = new ConsoleLogger();
```

### 4. Message Formatters

```typescript
// utils/formatters.ts
export interface SlackFormatter {
  formatProcessingComplete(summary: ProcessingSummary): any;
  formatProcessingError(meetingId: string, error: string): any;
}

export interface ProcessingSummary {
  meetingId: string;
  totalHypotheses: number;
  validations: number;
  duration: number;
  processedAt: string;
}

class DefaultSlackFormatter implements SlackFormatter {
  formatProcessingComplete(summary: ProcessingSummary) {
    return {
      text: `Meeting ${summary.meetingId} analysis complete`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Meeting Analysis Complete*\n` +
                  `Meeting: ${summary.meetingId}\n` +
                  `Hypotheses: ${summary.totalHypotheses}\n` +
                  `Validations: ${summary.validations}\n` +
                  `Duration: ${(summary.duration / 1000).toFixed(1)}s`
          }
        }
      ]
    };
  }

  formatProcessingError(meetingId: string, error: string) {
    return {
      text: `❌ Meeting ${meetingId} processing failed: ${error}`
    };
  }
}

export const slackFormatter: SlackFormatter = new DefaultSlackFormatter();
```

## Hour 1-2: Foundation with Configuration

**File structure:**
```
src/
├── config/
│   └── index.ts           # All configuration
├── utils/
│   ├── logger.ts          # Logging abstraction
│   └── formatters.ts      # Message formatting
├── prompts/
│   ├── quote-extraction.txt
│   ├── hypothesis-scoring.txt
│   └── index.ts           # Prompt manager
├── tools/
│   └── [tool files]
├── mcp-server.ts
└── orchestrator.ts
```

**mcp-server.ts (configurable):**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

const server = new Server(
  { name: 'meeting-evaluator', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Tools registration (same structure, but use config)
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'grain_get_transcript',
      description: 'Fetch meeting transcript from Grain API',
      inputSchema: {
        type: 'object',
        properties: {
          meeting_id: { type: 'string' },
          timeout: { type: 'number', default: config.apis.grain.timeout }
        },
        required: ['meeting_id']
      }
    },
    // ... other tools with configurable schemas
  ]
}));

logger.info('MCP server initialized', {
  toolCount: 6,
  grainTimeout: config.apis.grain.timeout
});
```

**Test with config:**
```bash
# .env.test
GRAIN_API_KEY=test-key
GOOGLE_SHEET_ID=test-sheet-id

# Test
NODE_ENV=test npx tsc && echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "grain_get_transcript", "arguments": {"meeting_id": "test123"}}}' | node dist/mcp-server.js
```

## Hour 3: Google Sheets Tools (Configurable)

```typescript
// tools/gsheets.ts
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { google } from 'googleapis';

if (request.params.name === 'gsheets_load_hypotheses') {
  const { sheet_id } = request.params.arguments as { sheet_id?: string };
  const spreadsheetId = sheet_id || config.apis.google.spreadsheetId;

  logger.info('Loading hypotheses from Google Sheet', { spreadsheetId });

  // ... googleapis implementation ...

  logger.success('Hypotheses loaded', { count: hypotheses.length });
  return { content: [{ type: 'text', text: JSON.stringify(hypotheses) }] };
}

if (request.params.name === 'gsheets_write_results') {
  const { results, sheet_id } = request.params.arguments as {
    results: Result[],
    sheet_id?: string
  };
  const spreadsheetId = sheet_id || config.apis.google.spreadsheetId;

  const timestamp = new Date().toISOString();
  const newSheetTitle = `Results @ ${timestamp}`;

  logger.info('Writing results to new sheet', { newSheetTitle, resultCount: results.length });

  // ... googleapis implementation to create new sheet and write ...

  logger.success('Results written', { newSheetTitle });
}
```

## Hour 4: Gemini with Retry Configuration

```typescript
// utils/api-client.ts
import { config } from '../config/index.js';
import { logger } from './logger.js';

export class ApiClient {
  async callWithRetry<T>(
    apiName: string,
    fn: () => Promise<T>,
    maxRetries = config.apis.gemini.maxRetries,
    baseDelay = config.apis.gemini.retryDelay
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxRetries) {
          logger.error(`${apiName} failed after ${maxRetries} attempts`, error);
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.warn(`${apiName} attempt ${attempt} failed, retrying in ${delay}ms`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Unreachable');
  }
}

// tools/gemini.ts
import { promptManager } from '../prompts/index.js';
import { ApiClient } from '../utils/api-client.js';

const apiClient = new ApiClient();

if (request.params.name === 'gemini_extract_quotes') {
  const { transcript, hypothesis } = request.params.arguments as {
    transcript: string;
    hypothesis: Hypothesis;
  };

  const promptTemplate = await promptManager.getPrompt('quote-extraction');
  const prompt = promptManager.fillTemplate(promptTemplate, {
    hypothesis_description: hypothesis.description,
    test_questions: hypothesis.test_questions.join(', '),
    transcript: transcript
  });

  const quotes = await apiClient.callWithRetry('Gemini Quote Extraction', async () => {
    const response = await fetch(`${config.apis.gemini.baseUrl}/v1beta/models/${config.apis.gemini.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apis.gemini.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  });

  logger.success('Quotes extracted', { count: quotes.length, hypothesisId: hypothesis.id });
  return { content: [{ type: 'text', text: JSON.stringify(quotes) }] };
}
```

## Hour 5: Slack with Formatter

```typescript
// tools/slack.ts
import { config } from '../config/index.js';
import { slackFormatter } from '../utils/formatters.js';
import { logger } from '../utils/logger.js';

if (request.params.name === 'slack_send_notification') {
  const { message, results_summary } = request.params.arguments as {
    message?: string;
    results_summary?: ProcessingSummary;
  };

  let payload;
  if (results_summary) {
    payload = slackFormatter.formatProcessingComplete(results_summary);
  } else {
    payload = { text: message };
  }

  await fetch(config.apis.slack.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  logger.success('Slack notification sent');
  return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
}
```

## Hour 6: Configurable Webhook Server

```typescript
// webhook.ts
import express from 'express';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { MeetingProcessor } from './orchestrator.js';

const app = express();
app.use(express.json({ limit: '50mb' })); // Allow larger transcript payloads
app.use(express.static('public')); // Serve the HTML interface

// Concurrent processing limiter
const activeProcessing = new Set<string>();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeProcessing: activeProcessing.size,
    config: {
      maxConcurrent: config.processing.maxConcurrentMeetings,
      timeout: config.processing.timeoutMs
    }
  });
});

app.post(config.server.webhookPath, async (req, res) => {
  const { transcript, meeting_id } = req.body; // Expect transcript directly

  if (!transcript) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  const id = meeting_id || `meeting-${Date.now()}`;

  if (activeProcessing.has(id)) {
    return res.status(409).json({ error: 'Meeting already being processed' });
  }

  if (activeProcessing.size >= config.processing.maxConcurrentMeetings) {
    return res.status(429).json({ error: 'Too many concurrent processing requests' });
  }

  activeProcessing.add(id);
  res.status(200).json({ message: 'Processing started', meeting_id: id });

  // Process with timeout
  const processor = new MeetingProcessor();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Processing timeout')), config.processing.timeoutMs)
  );

  try {
    await processor.connect();
    const startTime = Date.now();

    // The orchestrator now receives the transcript directly
    await Promise.race([
      processor.processWorkflow(transcript, id),
      timeoutPromise
    ]);

    const duration = Date.now() - startTime;
    logger.success('Meeting processed', { meetingId: id, duration });
  } catch (error) {
    logger.error('Meeting processing failed', { meetingId: id, error });
  } finally {
    activeProcessing.delete(id);
    await processor.disconnect();
  }
});

app.listen(config.server.port, () => {
  logger.info('Webhook server started', {
    port: config.server.port,
    webhookPath: config.server.webhookPath
  });
});
```

## Hour 7: Test Runner & Integration

**test-runner.ts:**
```typescript
// test/test-runner.ts
import { config } from '../src/config/index.js';

interface TestCase {
  name: string;
  method: string;
  params: any;
  expectedFields: string[];
}

const testCases: TestCase[] = [
  {
    name: 'Google Sheets Load Hypotheses',
    method: 'tools/call',
    params: { name: 'gsheets_load_hypotheses', arguments: { sheet_id: config.apis.google.spreadsheetId }},
    expectedFields: ['id', 'description']
  }
  // Note: Removed 'Grain Transcript Fetch' test case as the tool is no longer needed.
];

export class TestRunner {
  async runTests() {
    for (const testCase of testCases) {
      try {
        const result = await this.runSingleTest(testCase);
        console.log(`✅ ${testCase.name}: PASSED`);
      } catch (error) {
        console.log(`❌ ${testCase.name}: FAILED - ${error.message}`);
      }
    }
  }

  private async runSingleTest(testCase: TestCase): Promise<any> {
    // Implementation to call MCP server and validate response
  }
}

// CLI: node dist/test/test-runner.js
```

## Environment Files

**.env.development:**
```bash
# Development settings
GRAIN_API_KEY=dev-key
GEMINI_API_KEY=dev-key
SLACK_WEBHOOK_URL=dev-webhook
GOOGLE_SHEET_ID=dev-sheet-id
GEMINI_MAX_RETRIES=2
MAX_CONCURRENT=2
```

**.env.production:**
```bash
# Production settings
GRAIN_API_KEY=prod-key
GEMINI_API_KEY=prod-key
SLACK_WEBHOOK_URL=prod-webhook
GOOGLE_SHEET_ID=prod-sheet-id
GEMINI_MAX_RETRIES=5
MAX_CONCURRENT=10
PROCESSING_TIMEOUT=300000
```

## Benefits of This Approach

**✅ Zero Hardcoding:**
- All paths, URLs, messages configurable
- Environment-specific configs
- Easy to change without code changes

**✅ Scalability:**
- Concurrent processing limits
- Unique result sheets prevent collisions
- Timeout protection

**✅ Maintainability:**
- Prompts as external files
- Centralized formatting
- Structured logging

**✅ Testability:**
- Test runner with different configs
- Mock-friendly API clients
- Isolated components

**✅ Production Ready:**
- Health checks
- Error boundaries
- Resource management