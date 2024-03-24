# In-process cache

In process cache with least-recently-used eviction logic, O(1) complexity for all operations and optional compression.

## Install

```sh
npm i @cababunga/lru
```

## Use

```javascript
const lru = require("@cababunga/lru");
const expensiveCall = async (a, b) => 
    new Promise(resolve => setTimeout(() => resolve(a * b), 1000));
const cache = new lru({log: console.log});
const cachedCall = cache.cachify(expensiveCall);
await cachedCall(2, 2);
await cachedCall(2, 2);
await cachedCall(2, 2);
```

Constructor Options:

- exp - caching duration in seconds [30*60]
- max - maximum memory to use for cache [1MiB]
- log - function to use for debug logging [()=>{}]
- codec - object with optional functions
- codec.encode - takes an object and returns its serialized representation as a buffer
- codec.decode - takes a buffer created by .encode and decodes it into an object
- codec.serialize - data serializer [JSON.stringify()]
- codec.parse - cache entry parser [JSON.parse()]
- codec.compress - compress cache entry before storage [no compression]
- codec.decompress - decompress cache entry after retrieval [no decompression]
- codec.makeKey - takes an array (of function arguments) and produces sufficiently unique digest suitable to be used as a cache key [hex(md5(JSON.stringify()))]
- codec.log - function that can be used for logging some cache serialization/compression timing [opt.log]

### Compression

To avoid unnecessary dependencies, compression is not part of the package, but you can provide compressor and decompressor functions in the constructor options. Here is an example of how it could be done.

```javascript
const lz4 = require("lz4");
const lru = require("@cababunga/lru");
const compress = buf => {
    if (buf.length < 128)
        return Buffer.concat([Buffer.from("\x00"), buf]);

    return Buffer.concat([Buffer.from("\x01"), lz4.encode(buf)]);
}
const decompress = buf => {
    const compression = buf[0];
    buf = buf.slice(1);
    if (compression == 0)
        return buf;

    if (compression == 1)
        return lz4.decode(buf);

    throw new Error("Unknown compression type: " + JSON.stringify(compression));
}
const cache = new lru({codec: {compress, decompress}});
```
