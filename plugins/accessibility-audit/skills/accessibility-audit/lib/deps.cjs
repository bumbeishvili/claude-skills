// Resolves the skill's npm dependencies from its workspace, so scripts run with plain `node` and no NODE_PATH.
// The workspace is created by setup.sh: A11Y_AUDIT_HOME, default ~/.cache/accessibility-audit.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

// Absolute, because createRequire needs an absolute path and a relative A11Y_AUDIT_HOME is read from the cwd.
const HOME = path.resolve(process.env.A11Y_AUDIT_HOME || path.join(os.homedir(), '.cache', 'accessibility-audit'));
const SKILL_DIR = path.resolve(__dirname, '..');
const manifest = path.join(HOME, 'package.json');

function workspaceRequire() {
	if (!fs.existsSync(manifest)) {
		throw new Error(`accessibility-audit workspace not found at ${HOME}. Run: bash ${path.join(SKILL_DIR, 'setup.sh')}`);
	}
	return createRequire(manifest);
}

/** require() a dependency from the workspace, naming the setup step when it is missing. */
function load(name) {
	const req = workspaceRequire();
	try {
		return req(name);
	} catch (error) {
		if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(name)) {
			throw new Error(`"${name}" is not installed in ${HOME}. Run: bash ${path.join(SKILL_DIR, 'setup.sh')}`);
		}
		throw error;
	}
}

/** Absolute path of a file inside an installed package, such as accessibility-checker-engine/ace.js. */
function resolveFile(specifier) {
	return workspaceRequire().resolve(specifier);
}

module.exports = { HOME, SKILL_DIR, load, resolveFile };
