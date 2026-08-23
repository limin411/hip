const { execSync } = require('child_process')

// Use ncc with --transpile-only to skip type checking during bundling
execSync('npx ncc build src/main.ts -o dist --transpile-only', {
  stdio: 'inherit',
})
