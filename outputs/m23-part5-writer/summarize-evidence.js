'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const names = ['unit-results.json','regression-results.json','contracts-results.json','vanilla-regression-results.json','baseline-results.json','operations-ratification-results.json','available-results.json','equipment-final-results.json','final-contract-results.json'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const summaryFile = path.join(__dirname, 'evidence-summary.json');
const runs = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')).runs : [];
for (const name of names) {
  const file = path.join(__dirname, name); if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file); const result = JSON.parse(bytes);
  if (runs.some(run => run.sha256 === hash(bytes))) continue;
  runs.push({ file: name, bytes: bytes.length, sha256: hash(bytes), startedAt: new Date(result.startTime).toISOString(),
    passedSuites: result.numPassedTestSuites, failedSuites: result.numFailedTestSuites, pendingSuites: result.numPendingTestSuites,
    passedTests: result.numPassedTests, failedTests: result.numFailedTests, pendingTests: result.numPendingTests,
    failures: result.testResults.filter(suite => suite.status === 'failed').map(suite => ({ file: suite.name.replace(/^.*\/tests\//, 'tests/'),
      cases: suite.assertionResults.filter(test => test.status === 'failed').map(test => ({ name: test.fullName, failure: test.failureMessages.join('\n').slice(0, 700) })) })) });
}
const browsers = ['chrome','webkit'].map(name => { const file = path.join(__dirname, name, 'evidence.json'); const bytes = fs.readFileSync(file); return { file: name + '/evidence.json', sha256: hash(bytes), ...JSON.parse(bytes) }; });
fs.writeFileSync(path.join(__dirname, 'evidence-summary.json'), JSON.stringify({ base: 'eccc8e901b20ae3cc65a68c9fb2b068a4ceb9375', runs, browsers }, null, 2) + '\n');
