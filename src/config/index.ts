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
      hypothesesSheetName: string;
    };
    slack: {
      webhookUrl: string;
      token: string;
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
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: process.env.GEMINI_API_KEY!,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxRetries: Number(process.env.GEMINI_MAX_RETRIES || 3),
      retryDelay: Number(process.env.GEMINI_RETRY_DELAY || 1000)
    },
    google: {
      spreadsheetId: process.env.GOOGLE_SHEET_ID!,
      credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json',
      hypothesesSheetName: process.env.HYPOTHESES_SHEET_NAME || 'Hypotheses',
    },
    slack: {
      webhookUrl: process.env.SLACK_WEBHOOK_URL!,
      token: process.env.SLACK_BOT_TOKEN!,
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