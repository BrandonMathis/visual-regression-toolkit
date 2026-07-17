# Next.js lifecycle fixture

This deliberately small App Router application exercises prerender discovery, generated routes, an excluded route, an explicit additional route, a logical build date, three viewports, lazy content on a long page, animation/caret stabilization, a video poster, font readiness, and masking.

Dependencies are exact and isolated in this nested package so root `npm ci` does not install Next.js. Generate/update its lockfile only when intentionally upgrading the fixture:

```sh
npm install --package-lock-only --prefix tests/fixtures/next-app
npm ci --prefix tests/fixtures/next-app
```

Run the toolkit from this directory after installing the fixture dependencies. Authoritative screenshots must run in the pinned Playwright container; host runs use `--host` and are diagnostic only. Generated `.next`, `.visual-regression`, reports, results, and nested `node_modules` are ignored by the repository.
