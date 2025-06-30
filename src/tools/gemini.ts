import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';
import { prompts } from '../prompts/index.js';
import { logger } from '../utils/logger.js';

const { apiKey } = config.apis.gemini;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash-latest',
  generationConfig: { responseMimeType: 'application/json' },
});

/**
 * Analyzes a transcript to enrich a hypothesis with details like pain, status, quotes, and fixes.
 */
export async function analyzeHypothesis({ hypothesis: hypothesisInfo, transcript }: { hypothesis: { id: string, description: string }; transcript: string }): Promise<any> {
  logger.info('Analyzing hypothesis with Gemini...', { hypothesisId: hypothesisInfo.id });
  const prompt = prompts.hypothesisEnrichment
    .replace('{hypothesis_description}', hypothesisInfo.description)
    .replace('{transcript}', transcript);

  try {
    const result = await model.generateContent(prompt);
    const textResult = result.response.text();
    
    // The model should return a JSON string. We'll parse it to ensure it's valid 
    // before returning. This also cleans up any markdown backticks the model might add.
    const cleanedJson = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedResult = JSON.parse(cleanedJson);
    logger.success('Successfully analyzed hypothesis.', { hypothesisId: hypothesisInfo.id });
    return parsedResult;
  } catch (error: any) {
    logger.error('Failed to parse Gemini response as JSON.', { error: error.message, hypothesisId: hypothesisInfo.id });
    throw new Error('Failed to get a valid JSON response from the AI model.');
  }
} 