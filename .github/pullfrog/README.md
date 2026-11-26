# Native Pullfrog reviews

Pullfrog dispatches `.github/workflows/pullfrog.yml` from `main`. Native Pullfrog
owns review requests, progress, GitHub reviews, approvals, and both status checks.
Reviews run on Blacksmith with `opencode-go/deepseek-v4.1-flash` at max effort.

## Add the provider key

Open <https://pullfrog.com/console/redbrickmedia/shift-pdf-v2>, choose **Secrets**,
and add **`OPENCODE_API_KEY`** with the OpenCode Go key value. This is a Pullfrog
repository secret, not a GitHub Actions secret. The native action retrieves it
after verifying the run's repository through GitHub OIDC. No provider credential
is passed to the plan or follow-up jobs. Do not add it to the shell allowlist.

CLI alternative (the value is entered through a masked prompt):

```sh
pullfrog secret set OPENCODE_API_KEY --repo redbrickmedia/shift-pdf-v2
```

Keep the GitHub organization keys restricted to private repositories. This public
workflow uses one Pullfrog-managed credential; it does not select from the private
workflow's GitHub credential pool.

## Reviewer policy

`reviewers.json` lists this repository's existing trusted instructions. It includes
the coding standards and domain glossary. No specialist persona definitions were
found in this repository, so `reviewers` starts empty. Existing shared specialist
selection and delegation remain available when repository-owned roles are added.

The public runtime preserves current-revision checks, automatic review deduplication,
superseded-review recovery, concise findings with reviewer attribution, and advisory
suggestions alongside approvals. PR changes to trusted review policy are declined;
they cannot supply their own instructions to a credential-bearing review.

## Public repository controls

Enable automatic reviews, re-review on pushes, GitHub approvals, reviews of Pullfrog's
own PRs and other bots, and both `pullfrog` and `pullfrog-approval` checks. Keep drafts
and auto-merge off, target any branch, and skip `release-bot[bot]`.

Disable reviews of external contributors' PRs, mentions by non-collaborators, and
issue runs from non-collaborators. The runtime also declines fork PRs. Reviews have
shell and push disabled, and execute reviewer helpers from the trusted public
`main` branch. Restrict the `pullfrog` Actions environment to `main`.

Do not make `pullfrog-approval` a required merge check until a live canary passes.
Keep Bugbot enabled until a current-head native approval, both checks, the model,
and the Blacksmith runner have been verified. Existing PRs need an initial native
review (`@pullfrog review`) before automatic re-reviews can begin.

## Maintenance and rollback

The public repository cannot call the private `shift-github-actions` repository.
`shared/source.json` records the reviewed source and adaptations for this public
copy. Public helper references follow this repository's `main`; commits to the
private shared repository do **not** automatically update this copy. Carry relevant
runtime fixes across in a reviewed PR and run the Node guard tests before merging.
No Browser-specific sparse checkout strategy is included.

Run the dependency-free tests with:

```sh
node .github/pullfrog/test.mjs
```

To roll back, disable Pullfrog in its console and keep or restore Bugbot. Remove a
required approval check before disabling its producer if it was later required.
