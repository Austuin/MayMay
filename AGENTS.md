# MayMay Codex Development Guide

These instructions apply to the entire repository.

## Branch model

- `main` is the protected production branch. A push to `main` may publish a MayMay release.
- `DevBranch` is the protected integration branch and the default starting point for all work.
- Every feature, bug fix, documentation change, or maintenance task must be developed on its own branch created from the latest `DevBranch`.
- Name Codex work branches `codex/<short-description>`.
- Do not make feature commits directly on `main` or `DevBranch`.

## Required workflow

1. Fetch the remote branches and update the local `DevBranch` without rewriting history.
2. Create a new `codex/<short-description>` branch from `DevBranch`.
3. Implement only the requested change and preserve unrelated work.
4. Add or update automated tests for every changed behavior. A documentation-only change does not require a new application test.
5. Run the relevant local checks. At minimum, run `npm test` and `npm run typecheck`. Also run the production build when application, dependency, installer, or build behavior changes.
6. Open a pull request from the feature branch into `DevBranch`.
7. Wait for the required GitHub Actions checks. Fix failures on the feature branch and do not merge while a check is failing or pending.
8. Merge the feature pull request into `DevBranch` only after the checks pass. Delete the completed feature branch after the merge.
9. Test the combined state on `DevBranch`. When it is ready for release, open a pull request from `DevBranch` into `main`.
10. Wait for the required GitHub Actions checks on the release pull request. Attempt the merge into `main` only after all checks pass and there are no unresolved conflicts.
11. Keep `DevBranch` after a release. Synchronize it with `main` before starting the next feature if `main` contains changes that are not already in `DevBranch`.

## Test and data-safety requirements

- Tests must cover the changed behavior, not merely render the page.
- For user-input features, enter representative data, verify that it was saved, delete the test input, and verify that it was removed.
- Automated tests must use mocked Firebase/Firestore services and isolated browser storage. Never put test care records, credentials, or personally identifying information in the real MayMay database.
- Tests must clean up their temporary state, including local storage, after each run.
- Do not weaken, skip, or remove a test simply to make a pull request pass. Fix the behavior or update a test only when the intended behavior has deliberately changed.

## GitHub Actions policy

- Pull requests targeting `DevBranch` and `main` must run the automated test and type-check job.
- Pushes to both protected branches must run the same verification job.
- Release packaging must run only after a successful push to `main`; `DevBranch` must never publish a release.
- Required checks and branch protections must not be bypassed.
