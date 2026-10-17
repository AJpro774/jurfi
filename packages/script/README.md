# @jurfi/script

Runtime scripts plus the shared visual-script graph schema (`GraphDocument`).

`src/graph.ts` records the Script Compiler's document decision (`edges`, optional `pos`, `groups`, `comments`, type ids like `core/Add`, optional `subgraphs`). It is still a stub (`GRAPH_TYPES_STUB`) because the compiler has not published the module. The node graph editor imports these types instead of keeping a private copy.
