// This is a new, unified server that replaces mcp-server.ts and webhook.ts
// It serves the frontend, handles webhook requests, and processes tool calls.
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { MeetingProcessor } from './orchestrator.js';
import { handleToolCall, toolSchemas } from './tools/index.js';

const app = express();
const PORT = config.server.port;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Routes ---

// Simple async wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// UI and Health Check
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const activeProcessing = new Set<string>();
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', activeProcessing: activeProcessing.size });
});

// MCP Endpoint
app.post('/mcp', asyncHandler(async (req, res) => {
  const { jsonrpc, method, params, id } = req.body;

  if (jsonrpc !== '2.0' || !method || !id) {
    // This is a fundamental request error, so we can still throw
    throw new Error('Invalid JSON-RPC request');
  }

  try {
    let result;
    switch (method) {
      case 'tools/list':
        result = { tools: toolSchemas };
        break;
      case 'tools/call':
        if (!params || !params.name) throw new Error('Invalid params for tools/call');
        result = await handleToolCall(params.name, params.arguments || {});
        break;
      default:
        throw new Error('Method not found');
    }

    res.status(200).json({ jsonrpc: '2.0', id, result });
  } catch (error: any) {
    // This is a tool execution error. Package it gracefully.
    logger.warn('A tool execution failed, returning structured error.', { tool: params.name, message: error.message });
    res.status(200).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: error.message },
    });
  }
}));

// Webhook for Processing
app.post('/meeting-ended', asyncHandler(async (req, res) => {
  const { meeting_id, transcript } = req.body;
  if (!transcript) {
    return res.status(400).send({ error: 'Transcript is required' });
  }

  const processingId = meeting_id || `transcript-${Date.now()}`;
  if (activeProcessing.has(processingId) || activeProcessing.size >= config.processing.maxConcurrentMeetings) {
    const status = activeProcessing.has(processingId) ? 409 : 429;
    const message = activeProcessing.has(processingId) ? 'Already being processed' : 'Too many concurrent requests';
    return res.status(status).send({ error: message });
  }

  activeProcessing.add(processingId);
  logger.info(`Accepted job ${processingId}`);
  res.status(202).send({ message: 'Processing started', id: processingId });

  // Async processing
  new MeetingProcessor().processWorkflowWithTranscript(transcript, processingId)
    .catch(err => logger.error(`Processing failed for ${processingId}`, err))
    .finally(() => activeProcessing.delete(processingId));
}));


// --- Error Handler ---
const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Unhandled error on ${req.method} ${req.path}`, { message: err.message });
  const id = req.body?.id || null;
  res.status(500).json({
    jsonrpc: '2.0',
    id,
    error: { code: -32000, message: 'Server error', data: err.message },
  });
};
app.use(errorHandler);

// --- Server Start ---
app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
}); 