import fs from 'node:fs';

const filepath = './foo';

fs.writeFile(filepath, 'hello world', (err) => {
  if (err) console.log('error:', err);
});

fs.readFile(filepath, (err, data) => {
  if (err) {
    console.log('error:', err);
  } else {
    console.log('data:', data);
  }
});

fs.appendFile(filepath, 'bar', (err) => {
  if (err) console.log('error:', err);
});

fs.rm(filepath, (err) => {
  if (err) console.log('error:', err);
});
