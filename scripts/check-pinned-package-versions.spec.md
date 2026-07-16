# Pinned Package Version Check Spec

## Purpose

`scripts/check-pinned-package-versions.mjs` prevents dependency resolution from
drifting between reviewed releases, local installations, CI, and target-server
deployments.

## Scope

- Recursively inspect repository `package.json` files.
- Ignore generated, installed, temporary, runtime-data, and Git directories.
- Check `dependencies`, `devDependencies`, `optionalDependencies`, and
  `peerDependencies`.
- Require every declared dependency to use an exact semantic version, including
  optional prerelease or build metadata.
- Reject ranges, tags, aliases, Git URLs, file references, and wildcard
  workspace references.
- Do not treat `engines` as dependency declarations; engine entries describe
  the supported runtime range.

## Outputs

- A successful run reports the number of checked package manifests.
- A failed run identifies each manifest, dependency section, package name, and
  rejected version declaration.

## Checks

```bash
node scripts/check-pinned-package-versions.mjs
./scripts/check.sh
```
