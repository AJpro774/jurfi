import type { GraphDocument } from '@jurfi/script';

/**
 * Boundary between a host document and the canvas graph.
 *
 * The canvas edits only `GraphDocument`. A Timeline blend tree (or any other
 * domain) supplies `toGraph` / `fromGraph` plus its own `NodeRegistry`.
 * `fromGraph` must return JSON-serializable data so a host can autosave it.
 */
export interface GraphDocAdapter<TDoc> {
  toGraph(doc: TDoc): GraphDocument;
  fromGraph(graph: GraphDocument): TDoc;
}

export function identityGraphAdapter(): GraphDocAdapter<GraphDocument> {
  return {
    toGraph(doc) {
      return doc;
    },
    fromGraph(graph) {
      return graph;
    },
  };
}
