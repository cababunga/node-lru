"use strict";

const crypto = require("crypto");

const codec = {
    makeKey: args => crypto.createHash("md5").update(JSON.stringify(args)).digest("hex"),
    serialize: data => Buffer.from(JSON.stringify(data)),
    parse: data => JSON.parse(data),
    compress: data => data,
    decompress: data => data,
    encode(obj=null) {
        const start = this.log ? process.hrtime() : undefined;
        const buf = this.serialize(obj);
        const time = this.log ? process.hrtime(start) : undefined;
        const res = this.compress(buf);
        if (this.log) {
            const etime = process.hrtime(start);
            this.log(`time: serialize: ${time[1].toString().padStart(9, '0')}, ` +
                     `compress: ${(etime[1] - time[1]).toString().padStart(9, '0')}`);
            this.log(`space: original: ${buf.length}, compressed: ${res.length}, ` +
                     `reduction: ${buf.length / res.length}x`);
        }
        return res;
    },
    decode(buf) {
        const start = this.log ? process.hrtime() : undefined;
        buf = this.decompress(buf);
        const time = this.log ? process.hrtime(start) : undefined;
        const obj = JSON.parse(buf);
        if (this.log) {
            const ptime = process.hrtime(start);
            this.log(`time: expand: ${time[1].toString().padStart(9, '0')}, ` +
                     `parse: ${(ptime[1] - time[1]).toString().padStart(9, '0')}`);
        }
        return obj;
    },
};


/// In memory LRU cache with O(1) lookup, add, remove operations
class Cache {
    /**
     * @param {object} opt - options
     * @param {number} opt.exp - caching duration in seconds [30*60]
     * @param {number} opt.max - maximum memory to use for cache [1MiB]
     * @param {function} opt.log - function to use for debug logging [()=>{}]
     * @param {object} opt.codec - object with optional functions
     * @param {function} opt.codec.encode - takes an object and returns its serialized 
     *      representation as a buffer
     * @param {function} opt.codec.decode - takes a buffer created by .encode and decodes it into an object
     * @param {function} opt.codec.serialize - data serializer [JSON.stringify()]
     * @param {function} opt.codec.parse - cache entry parser [JSON.parse()]
     * @param {function} opt.codec.compress - compress cache entry before storage [no compression]
     * @param {function} opt.codec.decompress - decompress cache entry after retrieval [no decompression]
     * @param {function} opt.codec.makeKey - takes an array (of function arguments) and produces 
     *      sufficiently unique digest suitable to be used as a cache key [hex(md5(JSON.stringify()))]
     * @param {function} opt.codec.log - function that can be used for logging some cache
     *      serialization/compression timing [opt.log]
     */
    constructor(opt={}) {
        opt = Object.assign({exp: 30*60, max: 2**20, log: ()=>{}, codec}, opt);
        this.exp = opt.exp * 1000;
        this.max = opt.max;
        this.cache = {};
        this.head = null;
        this.tail = null;
        this.size = 0;
        this.log = opt.log;
        this.codec = Object.assign({}, codec, {log: opt.log}, opt.codec);
    }

    storeSize(store) {
        const overhead = 24;  // Date and 2 pointers on 64-bit arch (8 * 3)
        return store.v.length + store.k.length * 4 + overhead;
    }

    del(key) {
        const store = this.cache[key];
        if (!store)
            return;

        if (store.p)
            store.p.n = store.n;
        if (store.n)
            store.n.p = store.p;
        if (this.head == store)
            this.head = store.n;
        if (this.tail == store)
            this.tail = store.p;
        delete this.cache[key];
        this.size -= this.storeSize(store);
    }

    set(key, value) {
        if (this.cache[key])
            this.del(key);

        const val = this.codec.encode(value);
        const store = {k: key, v: val, t: Date.now(), p: this.tail, n: null};
        const size = this.storeSize(store);
        if (this.max) {
            if (size > this.max)
                return;

            while (this.size + size > this.max)
                this.del(this.head.k);
        }

        this.cache[key] = store;
        if (!this.head)
            this.head = store;
        if (this.tail)
            this.tail.n = store;
        this.tail = store;
        this.size += size;
        this.log("cache size:", this.size);
    }

    bump(key) {
        const store = this.cache[key];
        if (this.tail == store)
            return;

        if (store.p)
            store.p.n = store.n;
        if (store.n)
            store.n.p = store.p;
        if (this.head == store)
            this.head = store.n;

        this.tail.n = store;
        store.p = this.tail;
        store.n = null;
        this.tail = store;
    }

    get(key) {
        const store = this.cache[key];
        if (!store)
            return;

        if (store.t + this.exp < Date.now())
            return this.del(key);

        this.bump(key);

        return this.codec.decode(store.v);
    }

    /**
     * Decorates function returning a promise
     * @param {Function} f - function to be decorated
     * @returns a decorated function
     */
    cachify(f) {
        // TODO: Tag entries
        return async (...args) => {
            const kArgs = args.slice();
            kArgs.unshift(f.name);

            const key = this.codec.makeKey(kArgs);
            let val = this.get(key);

            if (val !== undefined) {
                this.log("cache hit:", key);
                return val;
            }

            this.log("cache miss:", key);
            val = await f(...args);

            this.set(key, val);

            return val;
        };
    }

    cachifyCb(f) {
        return (...args) => {
            const origCb = args.pop();
            const kArgs = args.slice();
            kArgs.unshift(f.name);

            const key = this.codec.makeKey(kArgs);
            let val = this.get(key);

            if (val) {
                this.log("cache hit:", key);
                return val;
            }

            this.log("cache miss:", key);
            const cb = (err, val) => {
                this.set(key, val);
                origCb(err, val);
            };
            args.push(cb);
            f(...args);
        };
    }

    /**
     * Removes cache entry
     * @param args - cached function parameters
     */
    invalidate(f, ...args) {
        args.unshift(f.name);
        const key = this.codec.makeKey(args);
        this.del(key);
    }

    /**
     * Creates a cache entry
     * @param args.slice(0, -1) - cached function parameters
     * @param args.at(-1) - value to be cached
     */
    populate(f, ...args) {
        const value = args.pop();
        args.unshift(f.name);
        const key = this.codec.makeKey(args);
        this.log("populate", key, this.exp, JSON.stringify(value));
        this.set(key, value);
    }

    clear() {
        this.cache = {};
        this.head = null;
        this.tail = null;
        this.size = 0;
    }
}


module.exports = Cache;
