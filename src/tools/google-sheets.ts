import { google } from 'googleapis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Configure Google Sheets client
const auth = new google.auth.GoogleAuth({
  keyFile: config.apis.google.credentialsPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = config.apis.google.spreadsheetId;

/**
 * Loads hypotheses from the "Hypotheses" tab of the Google Sheet.
 */
export async function loadHypotheses(): Promise<any[]> {
  try {
    // 1. Get all sheet metadata to find their titles
    logger.info('Finding the hypotheses sheet automatically...');
    const spreadsheetInfo = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const sheetsList = spreadsheetInfo.data.sheets || [];
    if (sheetsList.length === 0) {
      throw new Error('No sheets found in the spreadsheet.');
    }

    let hypothesesSheetTitle: string | null = null;

    // 2. Iterate through each sheet to find the one with the correct headers
    for (const sheet of sheetsList) {
      const title = sheet.properties?.title;
      if (!title) continue;

      logger.info(`Checking sheet: "${title}" for valid headers...`);
      const headerResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${title}!A1:Z1`, // Read the first row
      });

      const headers = headerResponse.data.values?.[0];
      if (!headers) continue; // Skip if no headers found

      // Clean headers by trimming whitespace
      const cleanedHeaders = headers.map(h => (typeof h === 'string' ? h.trim() : h));

      // Define our expected headers. This makes the check robust.
      const expectedHeaders = ['Problem Title', 'Hypothesis', 'Questions to Ask in Meeting'];
      if (expectedHeaders.every(h => cleanedHeaders.includes(h))) {
        logger.success(`Found valid hypotheses sheet: "${title}"`);
        hypothesesSheetTitle = title;
        break; // Stop after finding the first valid sheet
      }
    }

    if (!hypothesesSheetTitle) {
      throw new Error('Could not find a sheet with the required headers: "Problem Title", "Hypothesis", and "Questions to Ask in Meeting".');
    }
    
    // 3. Load all data from the identified sheet
    logger.info(`Loading all data from sheet: "${hypothesesSheetTitle}"`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: hypothesesSheetTitle, // Use the dynamically found title
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      logger.warn('No hypotheses found in the sheet.');
      return [];
    }

    // Clean the headers to ensure consistent mapping
    const headers = rows[0].map(h => (typeof h === 'string' ? h.trim() : h));
    const hypotheses = rows.slice(1).map(row => {
      const hypothesis: { [key: string]: any } = {};
      headers.forEach((header, index) => {
        hypothesis[header] = row[index];
      });
      return hypothesis;
    });

    logger.success(`Successfully loaded ${hypotheses.length} hypotheses.`);
    return hypotheses;
  } catch (error: any) {
    logger.error('Failed to load hypotheses from Google Sheet', { 
      error: error.message,
      details: error.errors || 'No additional details provided.' 
    });
    throw new Error(`Could not read from Google Sheets. Original error: ${error.message}`);
  }
}

/**
 * Updates a batch of hypotheses in place in the Google Sheet.
 * @param results The analysis results to write for each hypothesis.
 */
export async function updateHypotheses({ results }: { results: any[] }): Promise<{ success: boolean }> {
  logger.info(`Updating ${results.length} hypotheses in place...`);
  if (results.length === 0) {
    logger.warn('No results provided to update.');
    return { success: true };
  }

  // First, find the sheet and get all its data to locate rows by ID
  const sheetTitle = await findHypothesesSheetTitle();
  const rangeData = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetTitle,
  });

  const rows = rangeData.data.values || [];
  const headers = rows[0] || [];
  const idColumnIndex = headers.indexOf('ID');
  if (idColumnIndex === -1) {
    throw new Error('Could not find "ID" column in the sheet.');
  }

  // Create a map of row content to its index (1-based for A1 notation)
  const rowMap = new Map<string, { data: any[], index: number }>();
  rows.slice(1).forEach((row, i) => {
    const id = row[idColumnIndex];
    if (id) {
      rowMap.set(id, { data: row, index: i + 2 }); // +2 because of 0-based index and 1-based header
    }
  });

  // These are the headers we expect to update, in the correct order.
  const updateHeaders = ['Pain', 'Status', 'Deployments', 'Confidence', 'Quote 1', 'Quote 2', 'Possible Fix', 'Scale Risk'];
  const columnIndexes = updateHeaders.map(h => headers.indexOf(h));
  if (columnIndexes.some(i => i === -1)) {
    throw new Error(`One of the required columns for updating was not found. Required: ${updateHeaders.join(', ')}`);
  }
  const firstUpdateColumn = String.fromCharCode(65 + Math.min(...columnIndexes));
  const lastUpdateColumn = String.fromCharCode(65 + Math.max(...columnIndexes));

  const dataUpdatePayload: any[] = [];
  for (const result of results) {
    const rowInfo = rowMap.get(result.hypothesis_id);
    if (!rowInfo) {
      logger.warn(`Could not find row with ID: ${result.hypothesis_id} in the sheet. Skipping update.`);
      continue;
    }
    
    // Construct the data to write for this row
    const dataToWrite = headers.map(() => ''); // Start with an empty array
    updateHeaders.forEach((header, i) => {
      dataToWrite[columnIndexes[i]] = result.analysis[header] || '';
    });
    
    dataUpdatePayload.push({
      range: `${sheetTitle}!A${rowInfo.index}`, // Update the whole row to be safe
      values: [dataToWrite],
    });
  }

  if (dataUpdatePayload.length === 0) {
    logger.warn('No valid rows found to update.');
    return { success: true };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: dataUpdatePayload,
    },
  });

  logger.success(`Successfully updated ${dataUpdatePayload.length} hypotheses.`);
  return { success: true };
}

async function findHypothesesSheetTitle(): Promise<string> {
  // This logic is duplicated from loadHypotheses. In a real app, this would be refactored.
  const spreadsheetInfo = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  const sheetsList = spreadsheetInfo.data.sheets || [];
  for (const sheet of sheetsList) {
    const title = sheet.properties?.title;
    if (!title) continue;
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}!A1:Z1`,
    });
    const headers = headerResponse.data.values?.[0];

    // Clean headers by trimming whitespace
    if (!headers) continue;
    const cleanedHeaders = headers.map(h => (typeof h === 'string' ? h.trim() : h));
    const expectedHeaders = ['Problem Title', 'Hypothesis', 'Questions to Ask in Meeting'];
    if (expectedHeaders.every(h => cleanedHeaders.includes(h))) {
      return title;
    }
  }
  throw new Error('Could not find a sheet with the required headers.');
} 