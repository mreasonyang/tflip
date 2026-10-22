# Cloudflare Pages Git deployment

Tflip is moving from the Direct Upload project `tflip` to a native Git-integrated Pages project, following the KeyPin website deployment workflow. The live domain remains `https://tflip.kyun.si/`. Until the new project has passed deployment verification and the domain has been moved, production is still served by `tflip`.

## Build settings

| Setting | Value |
| --- | --- |
| GitHub repository | `mreasonyang/tflip` |
| New Pages project | `tflip-site` |
| Production branch | `main` |
| Framework preset | None |
| Root directory | Repository root |
| Build command | `bash scripts/cloudflare-build.sh` |
| Build output directory | `tailnet-preview` |
| Build image | v3 |
| Node.js | `26.11.0`, from `.node-version` |
| Python | `3.13.3`, from `.python-version` |

The build command installs the locked dependencies, runs the existing unit/type/archive checks and creates the complete verified static output. The checked-in npm SDK remains byte-identical to its published registry archive. Only `tailnet-preview/` is deployed; source files, test results and local release receipts stay outside that directory.

Cloudflare may perform its own dependency installation before running this command. Setting `SKIP_DEPENDENCY_INSTALL=1` in the Pages build environment avoids that duplicate step; the script itself always runs `npm ci --ignore-scripts`.

GitHub Actions validates Brave/WebKit and the supported Node versions, then runs the same build command and packages the results. It does not deploy and needs no Cloudflare API token. Native Pages builds and GitHub Actions run independently: a Pages deployment does not wait for the separate browser workflow to finish. Require the relevant checks when reviewing and accepting changes to `main`.

## Connect and migrate

1. In the existing Cloudflare Workers and Pages GitHub App installation, preserve the current repository selection and add only `mreasonyang/tflip`. Confirm the permission grant before saving it.
2. Create the Git-integrated Pages project `tflip-site` using the settings above. Cloudflare does not support converting a Direct Upload project to Git integration in place.
3. Verify the new `pages.dev` deployment against the local static manifest, including all served file hashes, the SDK/examples/Skill archives, cache headers and a genuine HTTP 404 for a missing download. Check the UI, npm command copy, playback and console errors in a browser.
4. After the new deployment passes, detach only `tflip.kyun.si` from the old project and attach it to the new project. Complete Cloudflare's custom-domain/DNS flow for that hostname and verify HTTPS and the same files again. Keep the old project available during the migration.
5. Record the Git SHA, new project, deployment ID, verification result and domain status. Verify a subsequent `main` push produces a new deployment automatically before marking the migration complete.

Build and package the same commit locally or download its GitHub Actions release artifact, then verify the deployment against that manifest:

```sh
node scripts/verify-site.mjs https://tflip-site.pages.dev /absolute/path/to/release-manifest.json test-results/pages-verification.json
node scripts/verify-site.mjs https://tflip.kyun.si /absolute/path/to/release-manifest.json test-results/production-verification.json
```

Use the actual Pages deployment URL and manifest path. The verifier checks every served file, HTML/catalog revalidation headers and the missing-download HTTP status. It requests JS/CSS/JSON with the release's `assetRevision`, as the generated page does, and records their response headers. The current custom domain gives JavaScript a four-hour browser TTL even though Pages' origin headers request revalidation; each build's new asset URL prevents reuse of that older browser entry. Browser checks and proof of automatic deployment remain separate.

## Routine deployment and recovery

After migration, push reviewed changes to `main`; Cloudflare builds and deploys from Git. Keep npm publication as its separate, explicit release step.

Use the new project's deployment history to roll back to a verified production deployment. For a failed domain cutover, restore `tflip.kyun.si` to the old project and verify it again. Retain its deployment `339baeab-20e4-4099-9aed-61d2eacb13f4` as the pre-migration baseline until the migration is accepted.

References: [GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/), [Direct Upload limitations](https://developers.cloudflare.com/pages/get-started/direct-upload/), [build image and version files](https://developers.cloudflare.com/pages/configuration/build-image/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).
