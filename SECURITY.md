# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub private
vulnerability reporting on this repository ("Report a vulnerability" under the
Security tab). Do not open a public issue for security reports. You should
receive an acknowledgment within five business days.

Please include the affected package version or workflow commit SHA, steps to
reproduce, and the impact you believe the issue has.

## Security model

The toolkit treats every job that installs dependencies, loads consumer
configuration, builds the application, starts the server, or runs the browser
as executing untrusted code. Those jobs:

- run with `contents: read` and only the minimum `actions: read` needed for
  baseline retrieval;
- check out code with `persist-credentials: false`;
- receive no repository, organization, deployment, or PR-write secrets and
  never use `secrets: inherit`;
- never execute pull-request code via `pull_request_target`;
- install the public, tokenless toolkit package;
- clear result directories before execution;
- invoke the exact toolkit CLI directly rather than a PR-editable consumer
  script; and
- upload only fixed, documented artifact paths with bounded retention and
  size limits.

Version 1 posts no PR comments, so no job needs `pull-requests: write`.

Shared repository controls:

- `main` and release tags are protected and never rewritten;
- CODEOWNERS review is required for workflows, schemas, and releases;
- all third-party actions are pinned to reviewed full commit SHAs;
- CI runs dependency review, `actionlint`, and `zizmor`; and
- the package is published with provenance via npm trusted publishing (OIDC),
  so no long-lived npm token exists.

Each release couples the exact package version, reusable-workflow commit SHA,
Node major, Playwright and Chromium versions, container digest, and schema
versions; consumers upgrade the package version and workflow SHA together.
