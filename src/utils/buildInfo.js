const fs = require('fs');
const path = require('path');

function readGitSha(cwd = process.cwd()) {
  try {
    const gitDir = path.join(cwd, '.git');
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) return null;

    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (!head) return null;

    if (head.startsWith('ref: ')) {
      const refPath = path.join(gitDir, head.slice(5));
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, 'utf8').trim() || null;
      }
      return null;
    }

    return head;
  } catch (error) {
    return null;
  }
}

function getBuildInfo() {
  const pkg = require('../../package.json');
  return {
    app: pkg.name || 'hubspot-audit-tool',
    version: pkg.version || null,
    build_sha:
      process.env.BUILD_SHA ||
      process.env.GIT_SHA ||
      process.env.RENDER_GIT_COMMIT ||
      readGitSha() ||
      null,
    node_env: process.env.NODE_ENV || null
  };
}

module.exports = {
  getBuildInfo,
  readGitSha
};
