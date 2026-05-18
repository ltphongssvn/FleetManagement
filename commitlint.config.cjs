// FleetManagement/commitlint.config.cjs
// Conventional Commits enforcement. Extends the standard preset so commit
// messages are parseable by semantic-release's commit-analyzer (same
// conventionalcommits convention). Run locally via the pre-commit
// commit-msg hook and intended to also run in CI on PR titles.
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
