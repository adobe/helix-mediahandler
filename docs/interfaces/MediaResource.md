# Interface: MediaResource

Media resource

## Table of contents

### Properties

- [contentBusId](MediaResource.md#contentbusid)
- [contentLength](MediaResource.md#contentlength)
- [contentType](MediaResource.md#contenttype)
- [data](MediaResource.md#data)
- [hash](MediaResource.md#hash)
- [lastModified](MediaResource.md#lastmodified)
- [meta](MediaResource.md#meta)
- [originalUri](MediaResource.md#originaluri)
- [owner](MediaResource.md#owner)
- [ref](MediaResource.md#ref)
- [repo](MediaResource.md#repo)
- [storageKey](MediaResource.md#storagekey)
- [storageUri](MediaResource.md#storageuri)
- [stream](MediaResource.md#stream)
- [uri](MediaResource.md#uri)

## Properties

### contentBusId

• **contentBusId**: `string`

ContentBus ID of the media resource

**`example`** "44556677"

___

### contentLength

• **contentLength**: `number`

Content length.

___

### contentType

• **contentType**: `string`

Content type.

___

### data

• `Optional` **data**: `Buffer`

Data of the blob while processing.

___

### hash

• **hash**: `string`

Content hash.
sha1('size' + 8192bytes)

___

### lastModified

• **lastModified**: `string`

last modified

___

### meta

• `Optional` **meta**: [`MediaMeta`](MediaMeta.md)

Metadata read via the `x-ms-meta-name` header.

___

### originalUri

• **originalUri**: `string`

URI of the original resource

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

### storageKey

• **storageKey**: `string`

Storage Key of the media resource `{contentBusId}/{sha}`

**`example`** "44556677/xxxxyyyyzzzz"

___

### storageUri

• **storageUri**: `string`

Storage URI of the media resource `s3://helix-media-bus/{contentBusId}/{sha}`

**`example`** "s3://helix-media-bus/44556677/xxxxyyyyzzzz"

___

### stream

• `Optional` **stream**: `Readable`

Data of the blob while processing.

___

### uri

• **uri**: `string`

URI of the media resource in the format `https://{ref}--{repo}--{owner}.hlx.page/media_{sha}`

**`example`** "https://ref--repo--owner.hlx.page/media_xxxxyyyyzzzz.png#width=477&width=268"
