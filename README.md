# Shared Visual Regression Toolkit

Deterministic Chromium visual regression for statically prerendered Next.js routes. The toolkit owns configuration, route discovery, production-server lifecycle, isolated Playwright capture, verified manifests, pixel comparison, and reports.

## Distribution model

This project is **not published to npm**. Consumers use the repository directly from GitHub:

- reusable workflows reference `BrandonMathis/visual-regression-toolkit/.github/workflows/...@main`;
- each workflow run loads the toolkit source from the commit currently at `main`, installs its locked dependencies, and builds the CLI;
- a clean job reads the reusable workflow's resolved commit from GitHub's `job_workflow_sha` OIDC claim before consumer code runs;
- the selected toolkit commit is recorded in baseline and result metadata; and
- optional Git tags are human-managed Git markers only. Tags do not publish packages or create a separate release channel.

`main` is intentionally a moving channel. A toolkit change that affects runtime compatibility requires consumers to publish a fresh baseline before comparisons can resume. Third-party GitHub Actions and the Playwright container remain pinned immutably inside the shared workflows.

## Requirements

- Consumer applications run on Node.js 22.
- Authoritative captures use `@playwright/test@1.61.1` in `linux/amd64` container `mcr.microsoft.com/playwright:v1.61.1-noble@sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6`.
- Consumer repositories need no visual-regression npm dependency and no copied Playwright visual test.

Host captures require `--host`, emit a warning, and are diagnostic only. They cannot verify or replace authoritative CI baselines.

## Consumer setup

1. Add a plain `visual-regression.config.ts` as described in [configuration](docs/configuration.md). It does not import an npm package.
2. Ignore generated output:

   ```gitignore
   /.visual-regression/
   /playwright-report/visual/
   /test-results/visual/
   ```

3. Add the thin [baseline and comparison workflow callers](docs/workflows.md), both referencing `@main`.
4. Seed the first baseline on the default branch before making comparison a required check.

A no-change PR should pass, an intentional CSS change should yield a downloadable advisory diff, and build or infrastructure failures remain blocking.

## Local diagnostic CLI

Clone the toolkit and build it once:

```sh
git clone https://github.com/BrandonMathis/visual-regression-toolkit.git
cd visual-regression-toolkit
npm ci --ignore-scripts
npm run build
```

From a consumer repository, invoke the built CLI by path:

```sh
node /path/to/visual-regression-toolkit/dist/cli/main.js baseline create --host
node /path/to/visual-regression-toolkit/dist/cli/main.js baseline verify .visual-regression/baseline
node /path/to/visual-regression-toolkit/dist/cli/main.js compare --baseline .visual-regression/baseline --host
node /path/to/visual-regression-toolkit/dist/cli/main.js report
```

Capture commands accept `--config <relative-path>` and `--json`. Exit `0` is pass, `1` is infrastructure error, and `2` is a complete visual difference. Only the trusted workflow gate may turn a validated exit `2` into advisory success.

## Documentation

- [Configuration reference](docs/configuration.md)
- [CLI and outputs](docs/cli.md)
- [Reusable workflows and consumer caller examples](docs/workflows.md)
- [Baseline lifecycle and main-channel updates](docs/baseline-lifecycle.md)
- [Errors and troubleshooting](docs/errors.md)
- [Fixture application](tests/fixtures/next-app/README.md)

## Development

```sh
npm ci --ignore-scripts
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run check:schemas
npm run build
npm run check:package
npm run check:workflows
```

`npm pack` remains a repository-local smoke test for package boundaries; its output is not published. Pushing a Git tag runs validation only. See [SECURITY.md](SECURITY.md) for the trust boundary and private reporting process.
