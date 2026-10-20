const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) check(path);
        else if (path.endsWith('.js')) execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
    }
}
for (const directory of ['src', 'test', 'scripts']) check(directory);
