# Nightly build report

## Summary

Nightly builds wait on the dependency cache, not on the compiler. Across 14 findings from 9 sources, 62% of a nightly build is spent restoring and re-uploading the cache. The median build takes 38 minutes: 23 minutes go to restoring and uploading the cache, and compiling takes 9 minutes. We compared 3 options. Keeping the cache per branch brings the build to about 15 minutes.

## How the pipeline runs

Each nightly build checks out the code, restores the whole dependency cache, compiles, and uploads the cache again. The restore and the upload move the whole archive on every run.

## Timing breakdown

| Stage | Minutes |
|---|---|
| Restore cache | 14 |
| Upload cache | 9 |
| Compile | 9 |

The test stage is timed in the findings.

## Incident on the release night

The release-night build started at 1:00. By 1:30 a cache miss had forced a full restore, compiling began at 2:00, and the cache upload timed out at 2:24. The build took 84 minutes.

## Options compared

| Case | Keep as is | Cache per branch | Remote build cache |
|---|---|---|---|
| Nightly, main | 38 min | about 15 min | about 12 min |
| Release night | 84 min | about 18 min | about 14 min |
| New dependency | 41 min | 41 min | about 20 min |

## Recommendations

Keep the dependency cache per branch: a nightly build on main then restores 1.2 GB instead of 4.8 GB and ends near 15 minutes. A remote build cache helps the new-dependency build most, which happens about twice a month; it is deferred.
