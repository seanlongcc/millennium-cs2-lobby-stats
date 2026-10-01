import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? '');
const required = [
	'plugin.json',
	'README.md',
	'UPSTREAM.md',
	'LICENSE',
	'.millennium/Dist/index.js',
	'.millennium/Dist/webkit.js',
	'backend/main.lua',
	'backend/providers.lua',
	'backend/report.lua',
	'backend/steam.lua',
	'static/cs2-profile-stats.css',
	'static/cs2-lobby-stats.css',
	'static/leetify-badge-white-small.png',
];
try {
	if (!process.argv[2] || path.basename(root) !== 'cs2-lobby-stats') throw Error('Expected cs2-lobby-stats directory.');
	const manifest = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8'));
	if (manifest.name !== 'cs2-lobby-stats' || manifest.version !== '0.1.0' || manifest.backendType !== 'lua') throw Error('Invalid plugin identity or version.');
	for (const file of required) {
		const stat = lstatSync(path.join(root, file));
		if (!stat.isFile() || stat.size === 0) throw Error(`Missing artifact: ${file}`);
	}
	const allowed = new Set(['plugin.json', 'README.md', 'UPSTREAM.md', 'CHANGELOG.md', 'LICENSE', 'backend', 'static', 'assets', '.millennium']);
	for (const entry of readdirSync(root)) if (!allowed.has(entry)) throw Error(`Unexpected package entry: ${entry}`);
	function walk(dir) {
		for (const entry of readdirSync(dir)) {
			const file = path.join(dir, entry),
				stat = lstatSync(file);
			if (stat.isSymbolicLink()) throw Error('Package links are forbidden.');
			if (/^(?:\.env.*|config\.json|node_modules|\.git|visualizations|tests)$/i.test(entry)) throw Error(`Development or private file: ${entry}`);
			if (stat.isDirectory()) walk(file);
		}
	}
	walk(root);
	console.log('Package verified: cs2-lobby-stats v0.1.0');
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
