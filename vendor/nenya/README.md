# nenya (prebuilt)

Prebuilt JavaScript distribution of [nenya-core](https://github.com/Erya-Labs/nenya), the
reference implementation of the NENYA-1 marketplace spec. Built from commit
`f834a465f31bb2b7fb0fc1df7309b7cf3b2ae4a9` with:

    ./gradlew :nenya-core:jsNodeProductionLibraryDistribution

and copied verbatim from `nenya-core/build/dist/js/productionLibrary/`. Nothing here is
hand-edited; `nenya.d.ts` is the API. The marketplace views call this library for every
decode, build and check — the client never reimplements a marketplace rule.
