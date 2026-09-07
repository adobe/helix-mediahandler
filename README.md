# Helix Mediahandler Library

> Library for interacting with the helix media-bus

## Status
[![codecov](https://codecov.io/gh/adobe/helix-mediahandler/branch/main/graph/badge.svg?token=HKOMTxpibO)](https://codecov.io/gh/adobe/helix-mediahandler)
[![CircleCI](https://circleci.com/gh/adobe/helix-mediahandler.svg?style=shield)](https://circleci.com/gh/adobe/helix-mediahandler)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-mediahandler.svg)](https://github.com/adobe/helix-mediahandler/blob/main/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-mediahandler.svg)](https://github.com/adobe/helix-mediahandler/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-mediahandler.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-mediahandler)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Installation

`MediaHandler` no longer talks to S3/R2 directly — the caller passes in a `storageBucket`
(a `Bucket` from [`@adobe/helix-shared-storage`](https://github.com/adobe/helix-shared/tree/main/packages/helix-shared-storage))
bound to the media bus, constructed with whichever storage backend package is appropriate
(e.g. [`@adobe/helix-shared-storage-s3`](https://github.com/adobe/helix-shared/tree/main/packages/helix-shared-storage-s3)
for S3+R2). Storage credentials, backend selection, and R2 mirroring are entirely the caller's
responsibility — see that package's own environment variable documentation.

```bash
$ npm install @adobe/helix-mediahandler
```

```js
import { StorageS3 } from '@adobe/helix-shared-storage-s3';
import { MediaHandler } from '@adobe/helix-mediahandler';

const storageBucket = StorageS3.fromContext(context).mediaBus();
const mediaHandler = new MediaHandler({
  owner, repo, ref, contentBusId, storageBucket,
});
```

# API Reference

see [API Documentation](./docs/README.md)
