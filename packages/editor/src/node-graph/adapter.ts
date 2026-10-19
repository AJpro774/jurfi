import type { GraphDoc } from '@jurfi/script';

/**
 * Boundary between a host document and the canvas graph.
 *
 * The canvas edits a `GraphDoc` from `@jurfi/script`. A Timeline blend tree
 * supplies `toGraph` / `fromGraph` plus its own `NodeRegistry`.
 * `fromGraph` must return JSON-serializable data.
 */
export interface GraphDocAdapter<TDoc> {
  toGraph(doc: TDoc): GraphDoc;
  fromGraph(graph: GraphDoc): TDoc;
}

export function identityGraphAdapter(): GraphDocAdapter<GraphDoc> {
  return {
    toGraph(doc) {
      return doc;
    },
    fromGraph(graph) {
      return graph;
    },
  };
}
