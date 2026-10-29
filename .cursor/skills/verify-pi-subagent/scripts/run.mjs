import { runJourney } from './wrapper.mjs';

try {
  const summary = await runJourney({ label: process.argv[2], mode: process.argv[3] });
  process.exitCode = summary.status === 'passed' ? 0 : 1;
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
