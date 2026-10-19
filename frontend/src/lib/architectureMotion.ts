/** Dependency depth determines reveal order; cycles remain visible at depth zero. */
export function architectureRevealDelays(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
): Map<string, number> {
  const incoming = new Map(nodes.map(({ id }) => [id, 0]));
  const children = new Map(nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!incoming.has(edge.source) || !incoming.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    children.get(edge.source)!.push(edge.target);
  }
  const depths = new Map(nodes.map(({ id }) => [id, 0]));
  const queue = nodes.filter(({ id }) => incoming.get(id) === 0).map(({ id }) => id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const child of children.get(id)!) {
      depths.set(child, Math.max(depths.get(child)!, depths.get(id)! + 1));
      incoming.set(child, incoming.get(child)! - 1);
      if (incoming.get(child) === 0) queue.push(child);
    }
  }
  return new Map(nodes.map(({ id }) => [id, Math.min(depths.get(id)! * 110, 880)]));
}
