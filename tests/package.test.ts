// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
const repo = process.cwd();
const scratch = path.join(repo, '.superpowers/sdd/2026-09-30-cs2-server-report/windows-tests');
const powershell = process.platform === 'win32' ? 'powershell.exe' : '/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe';
const windows = process.platform === 'win32' || existsSync(powershell);
const native = (p: string) => (process.platform === 'win32' ? p : execFileSync('wslpath', ['-w', p], { encoding: 'utf8' }).trim());
const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function fixture() {
	mkdirSync(scratch, { recursive: true });
	const root = mkdtempSync(path.join(scratch, 'case-'));
	temporary.push(root);
	const plugin = path.join(root, 'source/cs2-player-tracker');
	mkdirSync(plugin, { recursive: true });
	for (const name of ['plugin.json', 'LICENSE', 'README.md', 'UPSTREAM.md', 'backend', 'static', '.millennium'])
		cpSync(path.join(repo, name), path.join(plugin, name), { recursive: true });
	const steam = path.join(root, 'Steam'),
		dest = path.join(steam, 'millennium/plugins/cs2-player-tracker');
	mkdirSync(dest, { recursive: true });
	writeFileSync(path.join(dest, 'old.txt'), 'keep old bytes');
	writeFileSync(path.join(dest, 'plugin.json'), JSON.stringify({ name: 'cs2-player-tracker', version: '0.0.9' }));
	mkdirSync(path.join(steam, 'millennium/plugins/extendium'), { recursive: true });
	writeFileSync(path.join(steam, 'millennium/plugins/extendium/keep.txt'), 'other plugin');
	return { root, plugin, steam, dest };
}
function install(plugin: string, steam: string, extra: string[] = []) {
	return spawnSync(
		powershell,
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			native(path.join(repo, 'scripts/install.ps1')),
			'-PluginPath',
			native(plugin),
			'-SteamPath',
			native(steam),
			...extra,
		],
		{ encoding: 'utf8', timeout: 30000 },
	);
}
it('validates real build artifacts and rejects omitted output or development files', () => {
	const f = fixture();
	const verify = () => spawnSync(process.execPath, ['scripts/verify-package.mjs', f.plugin], { encoding: 'utf8' });
	expect(verify().status).toBe(0);
	writeFileSync(path.join(f.plugin, '.env'), 'SECRET=fixture');
	expect(verify().status).not.toBe(0);
	rmSync(path.join(f.plugin, '.env'));
	rmSync(path.join(f.plugin, '.millennium/Dist/webkit.js'));
	expect(verify().status).not.toBe(0);
});
it.skipIf(!windows)(
	'runs real PowerShell: dry-run, replacement, backup and unrelated-plugin preservation',
	() => {
		const f = fixture();
		const dry = install(f.plugin, f.steam, ['-WhatIf']);
		expect(dry.status, dry.stderr).toBe(0);
		expect(readdirSync(path.join(f.steam, 'millennium'))).toEqual(['plugins']);
		expect(readFileSync(path.join(f.dest, 'old.txt'), 'utf8')).toBe('keep old bytes');
		const result = install(f.plugin, f.steam);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(readFileSync(path.join(f.dest, 'plugin.json'), 'utf8')).version).toBe('0.1.0');
		expect(existsSync(path.join(f.dest, '.millennium/Dist/index.js'))).toBe(true);
		const backups = path.join(f.steam, 'millennium/backups');
		const backup = path.join(backups, readdirSync(backups)[0]);
		expect(readFileSync(path.join(backup, 'old.txt'), 'utf8')).toBe('keep old bytes');
		expect(readdirSync(backup).sort()).toEqual(['old.txt', 'plugin.json']);
		expect(readFileSync(path.join(f.steam, 'millennium/plugins/extendium/keep.txt'), 'utf8')).toBe('other plugin');
	},
	60000,
);
it.skipIf(!windows)(
	'restores the previous plugin when the real installer encounters a rename failure',
	() => {
		const f = fixture();
		const script = path.join(f.root, 'fail-rename.ps1');
		const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
		writeFileSync(
			script,
			`$ErrorActionPreference='Stop'\nfunction Move-Item { param([string]$LiteralPath,[string]$Destination,[string]$ErrorAction)\n if ($LiteralPath -like '*tracker-stage*') { throw 'Injected rename failure' }\n Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination -ErrorAction Stop\n}\n& ${quote(native(path.join(repo, 'scripts/install.ps1')))} -PluginPath ${quote(native(f.plugin))} -SteamPath ${quote(native(f.steam))}\n`,
		);
		const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', native(script)], { encoding: 'utf8', timeout: 30000 });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Injected rename failure');
		expect(readFileSync(path.join(f.dest, 'old.txt'), 'utf8')).toBe('keep old bytes');
		expect(existsSync(path.join(f.dest, '.millennium'))).toBe(false);
	},
	60000,
);
it.skipIf(!windows)(
	'packages an actual ZIP with the named plugin root and built modules',
	() => {
		const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', native(path.join(repo, 'scripts/package.ps1')), '-SkipBuild'], {
			encoding: 'utf8',
			timeout: 60000,
		});
		expect(result.status, result.stderr).toBe(0);
		const zip = path.join(repo, 'dist/cs2-player-tracker-v0.1.0.zip');
		expect(existsSync(zip)).toBe(true);
		const f = fixture(),
			out = path.join(f.root, 'unpacked');
		const script = path.join(f.root, 'extract.ps1');
		writeFileSync(script, `Expand-Archive -LiteralPath '${native(zip).replace(/'/g, "''")}' -DestinationPath '${native(out).replace(/'/g, "''")}'\n`);
		execFileSync(powershell, ['-NoProfile', '-File', native(script)], { timeout: 30000 });
		expect(readdirSync(out)).toEqual(['cs2-player-tracker']);
		expect(spawnSync(process.execPath, ['scripts/verify-package.mjs', path.join(out, 'cs2-player-tracker')], { encoding: 'utf8' }).status).toBe(0);
	},
	90000,
);
