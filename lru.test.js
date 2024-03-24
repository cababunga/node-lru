"use strict";

const assert = require("assert").strict;

const lru = require("./lru");

describe("LRU cache", () => {
    describe("set", () => {
        it("should evict old item", () => {
            const cache = new lru({max: 96});
            cache.set("a", "a123456789");
            cache.set("b", "b123456789");
            cache.set("c", "c123456789");

            assert.equal(cache.get("a"), undefined);
            assert.equal(cache.get("b"), "b123456789");
            assert.equal(cache.get("c"), "c123456789");
        });

        it("should not choke on undefined value", () => {
            const cache = new lru({max: 96});
            cache.set("a", undefined);
            assert.equal(cache.get("a"), null);
        });
    });

    describe("get", () => {
        it("should not return expired item", () => {
            const cache = new lru({exp: -1, max: 96});
            cache.set("a", "a123456789");

            assert.equal(cache.get("a"), undefined);
        });
    });

    describe("bump", () => {
        it("should bump with single item", async () => {
            const cache = new lru({max: 64});
            cache.set("a", "1");
            const a = cache.get("a");
            assert.equal(cache.head, cache.tail);
            assert.equal(cache.head.p, null);
            assert.equal(cache.tail.n, null);
        });

        it("should bump item at the end", async () => {
            const cache = new lru({max: 64});
            cache.set("a", "1");
            cache.set("b", "2");
            const b = cache.get("b");
            const A = cache.cache["a"];
            const B = cache.cache["b"];
            assert.equal(A, cache.head);
            assert.equal(B, cache.tail);
            assert.equal(B.n, null);
            assert.equal(B.p, A);
            assert.equal(A.n, B);
            assert.equal(A.p, null);
        });

        it("should bump item at the beginning", async () => {
            const cache = new lru({max: 64});
            cache.set("a", "1");
            cache.set("b", "2");
            const a = cache.get("a");
            const A = cache.cache["a"];
            const B = cache.cache["b"];
            assert.equal(A, cache.tail);
            assert.equal(B, cache.head);
            assert.equal(A.n, null);
            assert.equal(A.p, B);
            assert.equal(B.n, A);
            assert.equal(B.p, null);
        });

        it("should bump item in the middle", async () => {
            const cache = new lru({max: 96});
            cache.set("a", "1");
            cache.set("b", "2");
            cache.set("c", "3");
            const b = cache.get("b");
            const A = cache.cache["a"];
            const B = cache.cache["b"];
            const C = cache.cache["c"];
            assert.equal(A, cache.head);
            assert.equal(B, cache.tail);
            assert.equal(A.n, C);
            assert.equal(C.n, B);
            assert.equal(B.n, null);
            assert.equal(A.p, null);
            assert.equal(B.p, C);
            assert.equal(C.p, A);
        });
    });

    describe("LRU policy", () => {
        it("should evict LRU", async () => {
            const cache = new lru({max: 96});
            cache.set("a", "1");
            cache.set("b", "2");
            cache.set("c", "3");
            const c = cache.get("c");
            const b = cache.get("b");
            const a = cache.get("a");
            assert.equal(cache.head, cache.cache["c"]);
            cache.set("d", "4");
            assert.equal(cache.head, cache.cache["b"]);
            assert.equal(cache.get("c"), undefined);
            assert.equal(cache.get("b"), "2");
        });
    });

    describe("cachify", () => {
        it("should cache async function return value", async () => {
            const cache = new lru({max: 1000});
            let count = 0;
            const foo = async (one, two, three) => ++count;
            const ret1 = await cache.cachify(foo)("one", "two", "three");
            const ret2 = await cache.cachify(foo)("one", "two", "three");
            assert.equal(ret1, ret2);
        });

        it("should cache function with callback", () => {
            const cache = new lru({max: 1000});
            let count = 0;
            const foo = (one, two, three, cb) => cb(null, ++count);
            const cfoo = cache.cachifyCb(foo);
            cfoo("one", "two", "three", (err, val1) =>
                cfoo("one", "two", "three", (err, val2) =>
                    assert.equal(val1, val2)
                )
            );
        });

        it("should distinguish function parameters", async () => {
            const cache = new lru({max: 1000});
            let count = 0;
            const foo = async (one, two, three) => ++count;
            const ret1 = await cache.cachify(foo)("one", "two", "three");
            const ret2 = await cache.cachify(foo)("two", "three", "one");
            assert.notEqual(ret1, ret2);
        });

        it("should distinguish functions", async () => {
            const cache = new lru({max: 1000});
            const foo = async (one, two, three) => "one";
            const bar = async (one, two, three) => "two";
            const ret1 = await cache.cachify(foo)("one", "two", "three");
            const ret2 = await cache.cachify(bar)("one", "two", "three");
            assert.notEqual(ret1, ret2);
        });
    });

    describe("invalidate", () => {
        it("should invalidate cached function return value", async () => {
            const cache = new lru({max: 1000});
            let count = 0;
            const foo = (one, two, three) => ++count;
            const ret1 = await cache.cachify(foo)("one", "two", "three");
            cache.invalidate(foo, "one", "two", "three");
            const ret2 = await cache.cachify(foo)("one", "two", "three");
            assert.notEqual(ret1, ret2);
        });
    });

    describe("populate", () => {
        it("should populate cache with value", async () => {
            const cache = new lru({max: 1000});
            let count = 0;
            const value = "value";
            const foo = (one, two, three) => "different value";
            cache.populate(foo, "one", "two", "three", value);
            const ret = await cache.cachify(foo)("one", "two", "three");
            assert.equal(ret, value);
        });
    });
});

