# nenya (prebuilt)

Prebuilt JavaScript distribution of [nenya-core](https://github.com/Erya-Labs/nenya), the
reference implementation of the NENYA-1 marketplace spec. Built from commit
`49c0fa733c8ad022c6e108e5ca5865abd731f68d` with:

    ./gradlew :nenya-core:jsNodeProductionLibraryDistribution

and copied verbatim from `nenya-core/build/dist/js/productionLibrary/`. Nothing here is
hand-edited; `nenya.d.ts` is the API. The marketplace views call this library for every
decode, build and check — the client never reimplements a marketplace rule.
