# Helix Documents Support Library

> Utitities used for document processing

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe/helix-documents-support.svg)](https://codecov.io/gh/adobe/helix-documents-support)
[![CircleCI](https://img.shields.io/circleci/project/github/adobe/helix-documents-support.svg)](https://circleci.com/gh/adobe/helix-documents-support)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-documents-support.svg)](https://github.com/adobe/helix-documents-support/blob/master/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-documents-support.svg)](https://github.com/adobe/helix-documents-support/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe/helix-documents-support.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe/helix-documents-support)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Installation

```bash
$ npm install @adobe/helix-documents-support
```
# API Reference
## Classes

<dl>
<dt><a href="#BlobHandler">BlobHandler</a></dt>
<dd><p>Helper class for uploading images to azure blob storage based on their content checksum (sha1).</p>
</dd>
</dl>

## Functions

<dl>
<dt><a href="#parseMeta">parseMeta(hdr)</a></dt>
<dd><p>Parses the &#39;x-ms-meta-name&#39; header.</p>
</dd>
</dl>

<a name="BlobHandler"></a>

## BlobHandler
Helper class for uploading images to azure blob storage based on their content checksum (sha1).

**Kind**: global class  

* [BlobHandler](#BlobHandler)
    * [new BlobHandler(opts)](#new_BlobHandler_new)
    * [.hasUnprocessed](#BlobHandler+hasUnprocessed) ⇒ <code>boolean</code>
    * [.checkBlobExists(blob)](#BlobHandler+checkBlobExists) ⇒ <code>boolean</code>
    * [.fetchHeader(uri)](#BlobHandler+fetchHeader) ⇒ <code>ExternalResource</code>
    * [.putMetaData(blob)](#BlobHandler+putMetaData)
    * [.needsProcess(blob)](#BlobHandler+needsProcess) ⇒ <code>boolean</code>
    * [.process(blob)](#BlobHandler+process) ⇒ <code>boolean</code>
    * [.getBlob(uri)](#BlobHandler+getBlob) ⇒ <code>ExternalResource</code>
    * [.transferBlob(uri)](#BlobHandler+transferBlob) ⇒ <code>ExternalResource</code>
    * [.shouldUpload(blob)](#BlobHandler+shouldUpload) ⇒ <code>boolean</code>
    * [.scheduleUpload(blob)](#BlobHandler+scheduleUpload)
    * [.upload(blob)](#BlobHandler+upload) ⇒ <code>boolean</code>

<a name="new_BlobHandler_new"></a>

### new BlobHandler(opts)
Image handler construction.


| Param | Type | Description |
| --- | --- | --- |
| opts | <code>BlobHandlerOptions</code> | options. |

<a name="BlobHandler+hasUnprocessed"></a>

### blobHandler.hasUnprocessed ⇒ <code>boolean</code>
Indicates if any if the images could not be processed due to lack of data.

**Kind**: instance property of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>boolean</code> - {@code true} if has unprocessed images.  
<a name="BlobHandler+checkBlobExists"></a>

### blobHandler.checkBlobExists(blob) ⇒ <code>boolean</code>
Checks if the blob already exists using a GET request to the blob's metadata.
On success, it also updates the metadata of the external resource.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>boolean</code> - `true` if the resource exists.  

| Param | Type | Description |
| --- | --- | --- |
| blob | <code>ExternalResource</code> | the resource object. |

<a name="BlobHandler+fetchHeader"></a>

### blobHandler.fetchHeader(uri) ⇒ <code>ExternalResource</code>
Fetches the header (1024 bytes) of the resource assuming the server supports range requests.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>ExternalResource</code> - resource information  

| Param | Type | Description |
| --- | --- | --- |
| uri | <code>string</code> | Resource URI |

<a name="BlobHandler+putMetaData"></a>

### blobHandler.putMetaData(blob)
Stores the metadata of the blob in azure.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  

| Param | Type |
| --- | --- |
| blob | <code>ExternalResource</code> | 

<a name="BlobHandler+needsProcess"></a>

### blobHandler.needsProcess(blob) ⇒ <code>boolean</code>
Checks if blob needs processing.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>boolean</code> - {@code true} if the blob needs processing.  

| Param | Type | Description |
| --- | --- | --- |
| blob | <code>ExternalResource</code> | Resource to check |

<a name="BlobHandler+process"></a>

### blobHandler.process(blob) ⇒ <code>boolean</code>
Processes the blob data.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>boolean</code> - {@code true} if meta data was modified.  

| Param | Type | Description |
| --- | --- | --- |
| blob | <code>ExternalResource</code> | The blob |

<a name="BlobHandler+getBlob"></a>

### blobHandler.getBlob(uri) ⇒ <code>ExternalResource</code>
Gets the blob information for the external resource addressed by uri. It also ensured that the
addressed blob is uploaded to the blob store.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>ExternalResource</code> - the external resource object or null if not exists.  

| Param | Type | Description |
| --- | --- | --- |
| uri | <code>string</code> | URI of the external resource. |

<a name="BlobHandler+transferBlob"></a>

### blobHandler.transferBlob(uri) ⇒ <code>ExternalResource</code>
Transfers the blob with the given URI to the azure storage.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>ExternalResource</code> - the external resource object or {@code null} if the source
         does not exist.  

| Param |
| --- |
| uri | 

<a name="BlobHandler+shouldUpload"></a>

### blobHandler.shouldUpload(blob) ⇒ <code>boolean</code>
Calculates if the blob should be uploaded to azure or if it would result in too much overhead.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>boolean</code> - {@code true} if the blob can be uploaded  

| Param | Type | Description |
| --- | --- | --- |
| blob | <code>ExternalResource</code> | The resource to test |

<a name="BlobHandler+scheduleUpload"></a>

### blobHandler.scheduleUpload(blob)
Schedule an upload of the blob to azure using the 'copy from' API:
https://docs.microsoft.com/en-us/rest/api/storageservices/copy-blob-from-url

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  

| Param | Type |
| --- | --- |
| blob | <code>ExternalResource</code> | 

<a name="BlobHandler+upload"></a>

### blobHandler.upload(blob) ⇒ <code>boolean</code>
Transfers the blob to the azure storage.

**Kind**: instance method of [<code>BlobHandler</code>](#BlobHandler)  
**Returns**: <code>boolean</code> - {@code true} if successful.  

| Param | Type | Description |
| --- | --- | --- |
| blob | <code>ExternalResource</code> | The resource to transfer. |

<a name="parseMeta"></a>

## parseMeta(hdr)
Parses the 'x-ms-meta-name' header.

**Kind**: global function  

| Param |
| --- |
| hdr | 

