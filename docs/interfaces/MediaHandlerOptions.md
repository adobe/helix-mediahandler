# Interface: MediaHandlerOptions

## Table of contents

### Properties

- [auth](MediaHandlerOptions.md#auth)
- [awsAccessKeyId](MediaHandlerOptions.md#awsaccesskeyid)
- [awsRegion](MediaHandlerOptions.md#awsregion)
- [awsSecretAccessKey](MediaHandlerOptions.md#awssecretaccesskey)
- [blobAgent](MediaHandlerOptions.md#blobagent)
- [bucketId](MediaHandlerOptions.md#bucketid)
- [contentBusId](MediaHandlerOptions.md#contentbusid)
- [fetchTimeout](MediaHandlerOptions.md#fetchtimeout)
- [filter](MediaHandlerOptions.md#filter)
- [forceHttp1](MediaHandlerOptions.md#forcehttp1)
- [log](MediaHandlerOptions.md#log)
- [maxTime](MediaHandlerOptions.md#maxtime)
- [namePrefix](MediaHandlerOptions.md#nameprefix)
- [noCache](MediaHandlerOptions.md#nocache)
- [owner](MediaHandlerOptions.md#owner)
- [ref](MediaHandlerOptions.md#ref)
- [repo](MediaHandlerOptions.md#repo)
- [uploadBufferSize](MediaHandlerOptions.md#uploadbuffersize)

## Properties

### auth

• `Optional` **auth**: `string`

Authentication header for fetching sources.

___

### awsAccessKeyId

• `Optional` **awsAccessKeyId**: `string`

AWS access key ID

___

### awsRegion

• `Optional` **awsRegion**: `string`

AWS region

___

### awsSecretAccessKey

• `Optional` **awsSecretAccessKey**: `string`

AWS secret access key

___

### blobAgent

• `Optional` **blobAgent**: `string`

Agent that uses the blob handler (eg word2md, importer, etc)

___

### bucketId

• `Optional` **bucketId**: `string`

media bus bucket id

**`default`** `'helix-media-bus'`

___

### contentBusId

• **contentBusId**: `string`

ContentBus ID of the media resources

**`example`** "44556677"

___

### fetchTimeout

• `Optional` **fetchTimeout**: `number`

Time in milliseconds that requesting a blob header is allowed to take.

**`default`** 10000

___

### filter

• `Optional` **filter**: [`MediaFilter`](../README.md#mediafilter)

Filter function to accept/reject blobs based on their HEAD request.

___

### forceHttp1

• `Optional` **forceHttp1**: `boolean`

Force http1.0

**`default`** false

___

### log

• `Optional` **log**: `any`

logger

**`default`** `console`

___

### maxTime

• `Optional` **maxTime**: `number`

Specifies the maximum time that should be used for uploading

**`default`** 10000

___

### namePrefix

• `Optional` **namePrefix**: `string`

Prefix prepended to the computed resource name (mainly used for testing)

___

### noCache

• `Optional` **noCache**: `boolean`

Disables the caching in `getBlob()`

**`default`** false

___

### owner

• **owner**: `string`

Media owner

___

### ref

• **ref**: `string`

Media owner ref

___

### repo

• **repo**: `string`

Media owner repo

___

### uploadBufferSize

• `Optional` **uploadBufferSize**: `number`

Size of the upload buffer to calculate image size if missing.

**`default`** 5mb
