# nenya (prebuilt)

Prebuilt JavaScript distribution of [nenya-core](https://github.com/Erya-Labs/nenya), the
reference implementation of the NENYA-1 marketplace spec. Built from commit
`31fdac9597333877da19ed6213617523dcb1e06d` with:

    ./gradlew :nenya-core:jsNodeProductionLibraryDistribution

and copied verbatim from `nenya-core/build/dist/js/productionLibrary/`. Nothing here is
hand-edited; `nenya.d.ts` is the API. The marketplace views call this library for every
decode, build and check — the client never reimplements a marketplace rule.
