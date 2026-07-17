# Security policy

## Supported source

The current `main` branch is the only supported distribution channel. The toolkit is not published to npm and Git tags are historical markers, not independently maintained release lines. Security fixes land on `main`; consumers receive them on their next workflow run and must publish fresh baselines when runtime identity changes.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's **Security → Report a vulnerability** private advisory for this repository. Include the affected toolkit Git commit, impact, reproduction, and whether a consumer pull request can trigger the issue. Maintainers will acknowledge a complete report within five business days and coordinate disclosure after a fix is available.

Never include production credentials, signed artifact URLs, or private consumer source in a report.

## Trust boundary

Consumer dependency installation, configuration loading, builds, servers, and browser pages execute untrusted code on disposable GitHub-hosted runners. Those jobs receive no secrets, write token, environment, or OIDC permission. A separate clean job receives `id-token: write` solely to read GitHub's signed reusable-workflow commit claim before any consumer code executes. Artifacts are evidence, not hostile-code attestation, and must never contain secrets.
