/**
 * Test LibreOffice detection in the actual app context
 */

import { conversionService } from './src/process/services/conversionService';

async function test() {
  console.log('=== Testing LibreOffice Detection ===\n');

  // Test 1: findLibreOffice
  console.log('Test 1: findLibreOffice()');
  const path = await (conversionService as any).findLibreOffice();
  console.log('Result:', path);

  // Test 2: isLibreOfficeAvailable
  console.log('\nTest 2: isLibreOfficeAvailable()');
  const available = await conversionService.isLibreOfficeAvailable();
  console.log('Result:', available);

  // Test 3: libreOfficeToPdf (dry run check)
  console.log('\nTest 3: libreOfficeToPdf() with dummy file');
  try {
    const result = await conversionService.libreOfficeToPdf('/tmp/dummy.docx');
    console.log('Result:', result);
  } catch (e) {
    console.log('Error:', e instanceof Error ? e.message : e);
  }
}

test().catch(console.error);
