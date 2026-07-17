# Baseline lifecycle and operations

## Initial seed and refresh

Merge the config and `@main` caller workflows to the consumer's default branch. Let the push caller publish a baseline for that exact SHA, or dispatch the baseline caller on the default branch. No visual-regression npm dependency is installed. Comparison never falls back to a nearby source commit. Keep the monthly schedule to refresh 90-day artifacts for quiet repositories.

A baseline is published only after complete capture, fresh verification, bounded-tree scan, and immutable artifact upload. A manifest is authoritative; artifact names are only lookup aids. Pull requests use the synthetic merge SHA as candidate and `pull_request.base.sha` as baseline source.

## Intentional pixel or route changes

Review the job summary and evidence artifact. Exit `2` is advisory by default, but only after trusted identity/result validation and evidence upload. Merge the reviewed change; the default-branch workflow then publishes the new authoritative baseline. Added and removed route/project pairs are visual differences, not infrastructure errors.

## Configuration changes

A changed visual-contract hash cannot use the old baseline and returns `VISUAL_CONTRACT_CHANGED`. Review the contract change, explicitly waive that one comparison check, merge, wait for the resulting default-branch exact-SHA baseline, then resume normal comparisons. The toolkit does not generate an ephemeral baseline for an unmerged contract.

## Toolkit `main` changes

Every workflow run reads the Git commit that supplied the reusable workflow YAML from GitHub's `job_workflow_sha` claim and records it in runtime identity. All jobs in that run use that same commit, so a moving `main` cannot mix workflow and CLI revisions.

When toolkit `main` advances, an older baseline is intentionally incompatible with the new runtime identity. Publish a fresh baseline for each active consumer default-branch SHA before relying on comparisons again. Browser, container, stabilization, schema, and capture changes therefore fail closed rather than silently reusing old pixels.

There is no npm package upgrade or workflow-SHA pairing process. Consumer callers remain on `@main`.

## Expiry and unavailable artifacts

`BASELINE_EXPIRED` is used only when GitHub explicitly marks an artifact expired. A successful run whose artifact is deleted or unavailable reports `BASELINE_ARTIFACT_UNAVAILABLE`. Re-run baseline publication on the current default-branch SHA. Never upload screenshots manually or select an ancestor or newer SHA.

## Git tags and rollback

Tags are optional Git markers only. Pushing a tag validates the tagged source but does not publish npm content or create a second distribution channel.

To roll back a problematic toolkit change, revert it on toolkit `main`, review and merge that revert, then publish fresh consumer baselines using the restored `main` commit. Do not move or rewrite existing tags.
