// Commit messages and pull request titles follow Conventional Commits:
//
//   <type>(<optional scope>): <imperative summary in lower case>
//
//   feat(web): add the sign-in page
//   fix(api): return 404 for unknown profiles
//   chore(deps): bump axum to 0.9
//
// Types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.
// Checked by the commit-msg hook locally and on pull request titles in CI.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The scope is optional. When given, it names the part of the repository that changed.
    'scope-enum': [
      2,
      'always',
      [
        'android',
        'api',
        'web',
        'e2e',
        'contract',
        'infra',
        'ci',
        'deps',
        'deps-dev',
        'docs',
        'scripts',
        'repo',
      ],
    ],
    // Long URLs in commit bodies are fine.
    'body-max-line-length': [1, 'always', 100],
    'footer-max-line-length': [1, 'always', 100],
  },
}
