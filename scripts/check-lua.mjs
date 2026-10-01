import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import luaparse from 'luaparse';
let count = 0;
function check(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) check(file);
		else if (file.endsWith('.lua')) {
			luaparse.parse(readFileSync(file, 'utf8'), { luaVersion: '5.3' });
			count++;
		}
	}
}
check('backend');
console.log(`Parsed ${count} Lua files.`);
