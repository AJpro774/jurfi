import { PANEL } from '../layout';
import { registerPanel } from '../registry';
import { mountAssetBrowser } from './asset-browser';
import { mountHierarchy } from './hierarchy';
import { mountInspector } from './inspector';

/** Replace the hierarchy, inspector, and asset placeholder panels. */
export function registerContentPanels(): () => void {
  const removeHierarchy = registerPanel({
    id: PANEL.hierarchy,
    title: 'Hierarchy',
    mount: mountHierarchy,
  });
  const removeInspector = registerPanel({
    id: PANEL.inspector,
    title: 'Inspector',
    mount: mountInspector,
  });
  const removeAssets = registerPanel({
    id: PANEL.assets,
    title: 'Asset Browser',
    mount: mountAssetBrowser,
  });
  return () => {
    removeHierarchy();
    removeInspector();
    removeAssets();
  };
}
