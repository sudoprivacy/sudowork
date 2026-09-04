import process from 'node:child_process';

process.exec('echo "foo"', (err, stdout, stderr) => {
  console.log('error:', err);
  console.log('stderr:', stderr);
  console.log('stdout:', stdout);
});
