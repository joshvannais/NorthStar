const https = require('https');
const fs = require('fs');

const url = 'https://northstar-solutions.polsia.app/';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const output = {
      status: res.statusCode,
      headers: res.headers,
      body: data.substring(0, 5000),
    };
    fs.writeFileSync('/home/agent-lead/northstar-solutions/site-check-result.json', JSON.stringify(output, null, 2));
    console.log('Written to file');
  });
}).on('error', (err) => {
  fs.writeFileSync('/home/agent-lead/northstar-solutions/site-check-error.json', JSON.stringify({ error: err.message }, null, 2));
});