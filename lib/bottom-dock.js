/**
 * Default bottom-panel placement (core UX requirement).
 *
 * dsh-better-sidebar's `registerTab` has no per-tab placement field
 * (verified against v0.16.0 source), but the tab component receives
 * `store: SidebarStore` whose public `update(mutator(draft))` exposes the
 * mutable SidebarState (splits / bottomSplits / bottomOpen / activePane —
 * exported types from dsh-better-sidebar/client/service). On FIRST open we
 * relocate the tab from the right sidebar into the bottom panel and open it.
 *
 * Callers gate this with `tab.meta.dockedBottom` so it runs exactly once;
 * after the user manually drags it back to the right sidebar it is not
 * forced back (layout persists per session in better-sidebar).
 */

function treeHasTab(node, tabId) {
  if (node.kind === 'leaf') return node.tabs.some((t) => t.id === tabId);
  return node.children.some((c) => treeHasTab(c, tabId));
}

/** Recursively remove a tab from a tree node; returns the removed tab. */
function removeTabFromNode(node, tabId) {
  if (node.kind === 'leaf') {
    const idx = node.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return null;
    const [tab] = node.tabs.splice(idx, 1);
    if (node.active === tabId) node.active = node.tabs[node.tabs.length - 1]?.id ?? null;
    return tab;
  }
  for (const child of node.children) {
    const tab = removeTabFromNode(child, tabId);
    if (tab) return tab;
  }
  return null;
}

/** Prune empty leaves; collapse single-child splits. Returns null when empty. */
function pruneEmpty(node) {
  if (node.kind === 'leaf') return node.tabs.length > 0 ? node : null;
  const children = node.children.map(pruneEmpty).filter(Boolean);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children };
}

function firstLeaf(node) {
  if (node.kind === 'leaf') return node;
  return firstLeaf(node.children[0]);
}

/**
 * Move the tab `tabId` from the right sidebar into the bottom panel and
 * open it. No-op when the tab is already in the bottom tree (only ensures
 * the panel is open). Pure mutation through `store.update(draft)`.
 */
export function ensureBottomPanel(store, tabId) {
  if (!store || typeof store.update !== 'function') return false;
  store.update((draft) => {
    if (!draft || !draft.splits || !draft.bottomSplits) return;
    // Already in the bottom panel → just make sure it's visible.
    if (treeHasTab(draft.bottomSplits, tabId)) {
      draft.bottomOpen = true;
      return;
    }
    const removed = removeTabFromNode(draft.splits, tabId);
    if (!removed) return; // not in the right tree either; nothing to relocate
    // Prune the emptied right tree so we don't leave a hollow split behind.
    const pruned = pruneEmpty(draft.splits);
    if (pruned) draft.splits = pruned;
    // Find the bottom panel's first leaf (create one if the tree is empty).
    let leaf = firstLeaf(draft.bottomSplits);
    if (!leaf) {
      leaf = { kind: 'leaf', id: `serial-pane-${Math.random().toString(36).slice(2, 8)}`, tabs: [], active: null };
      draft.bottomSplits = leaf;
    }
    leaf.tabs.push(removed);
    leaf.active = tabId;
    draft.activePane = leaf.id;
    draft.bottomOpen = true;
  });
  return true;
}
