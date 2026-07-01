const https = require('https');

const url = 'https://northstar-solutions.polsia.app/';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('HEADERS:', JSON.stringify(res.headers, null, 2));
    console.log('BODY (first 3000 chars):');
    console.log(data.substring(0, 3000));
  });
}).on('error', (err) => {
  console.error('ERROR:', err.message);
});