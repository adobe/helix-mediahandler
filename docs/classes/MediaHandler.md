# Class: MediaHandler

Media handler to upload media to the bus. One media handler instance is bound to a project,
i.e. owner, repo, ref, contentBusId are the same for all uploads.

## Table of contents

### Constructors

- [constructor](MediaHandler.md#constructor)

### Methods

- [checkBlobExists](MediaHandler.md#checkblobexists)
- [createMediaResource](MediaHandler.md#createmediaresource)
- [createMediaResourceFromStream](MediaHandler.md#createmediaresourcefromstream)
- [fetchHeader](MediaHandler.md#fetchheader)
- [getBlob](MediaHandler.md#getblob)
- [put](MediaHandler.md#put)
- [putMetaData](MediaHandler.md#putmetadata)
- [spool](MediaHandler.md#spool)
- [upload](MediaHandler.md#upload)

## Constructors

### constructor

• **new MediaHandler**(`options`)

Creates a new media handler

**`throws`** Error If the options are invalid.

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`MediaHandlerOptions`](../interfaces/MediaHandlerOptions.md) |

## Methods

### checkBlobExists

▸ **checkBlobExists**(`blob`): `Promise`<`boolean`\>

Checks if the blob already exists using a GET request to the blob's metadata.
On success, it also updates the metadata of the external resource.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `blob` | [`MediaResource`](../interfaces/MediaResource.md) | the resource object. |

#### Returns

`Promise`<`boolean`\>

`true` if the resource exists.

___

### createMediaResource

▸ **createMediaResource**(`buffer`, `contentLength`, `contentType?`, `sourceUri?`): [`MediaResource`](../interfaces/MediaResource.md)

Creates a media resource from the given buffer and properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `buffer` | `Buffer` | buffer with data |
| `contentLength` | `number` | Size of blob. |
| `contentType?` | `string` | - |
| `sourceUri?` | `string` | - |

#### Returns

[`MediaResource`](../interfaces/MediaResource.md)

the external resource object.

___

### createMediaResourceFromStream

▸ **createMediaResourceFromStream**(`stream`, `contentLength`, `contentType?`, `sourceUri?`): `Promise`<[`MediaResource`](../interfaces/MediaResource.md)\>

Creates an media resource from the given stream and properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `stream` | `Readable` | readable stream |
| `contentLength` | `number` | - |
| `contentType?` | `string` | - |
| `sourceUri?` | `string` | - |

#### Returns

`Promise`<[`MediaResource`](../interfaces/MediaResource.md)\>

the external resource object.

___

### fetchHeader

▸ **fetchHeader**(`uri`): `Promise`<[`MediaResource`](../interfaces/MediaResource.md)\>

Fetches the header (1024 bytes) of the resource assuming the server supports range requests.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `uri` | `string` | Resource URI |

#### Returns

`Promise`<[`MediaResource`](../interfaces/MediaResource.md)\>

resource information

___

### getBlob

▸ **getBlob**(`uri`, `src?`): `Promise`<[`MediaResource`](../interfaces/MediaResource.md)\>

Gets the blob information for the external resource addressed by uri. It also ensured that the
addressed blob is uploaded to the blob store.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `uri` | `string` | URI of the external resource. |
| `src?` | `string` | - |

#### Returns

`Promise`<[`MediaResource`](../interfaces/MediaResource.md)\>

the external resource object or null if not exists.

___

### put

▸ **put**(`blob`): `Promise`<`boolean`\>

Puts the blob to the blob store.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `blob` | [`MediaResource`](../interfaces/MediaResource.md) | the resource object. |

#### Returns

`Promise`<`boolean`\>

`true` if the upload succeeded.

___

### putMetaData

▸ **putMetaData**(`blob`): `Promise`<`void`\>

Stores the metadata of the blob in the media bus.

#### Parameters

| Name | Type |
| :------ | :------ |
| `blob` | [`MediaResource`](../interfaces/MediaResource.md) |

#### Returns

`Promise`<`void`\>

___

### spool

▸ **spool**(`blob`): `Promise`<`boolean`\>

Transfers the blob to the azure storage.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `blob` | [`MediaResource`](../interfaces/MediaResource.md) | The resource to transfer. |

#### Returns

`Promise`<`boolean`\>

{@code true} if successful.

___

### upload

▸ **upload**(`blob`): `Promise`<`boolean`\>

Uploads the blob to the blob store. If the blob has not data, it is _spooled_ from the
source uri.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `blob` | [`MediaResource`](../interfaces/MediaResource.md) | the resource object. |

#### Returns

`Promise`<`boolean`\>

`true` if the upload succeeded.
