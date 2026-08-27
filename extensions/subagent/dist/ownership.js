export function registerDirectChild(parent, child, now) {
    if (child.parent?.sessionId !== parent.sessionId
        || child.parent.epoch !== parent.epoch) {
        throw new Error("Cannot register a child owned by another session namespace");
    }
    if (!child.launch) {
        throw new Error("Cannot register a child without launch metadata");
    }
    const existing = parent.children.find((candidate) => candidate.agentId === child.sessionId);
    if (existing && existing.epoch !== child.epoch) {
        throw new Error("Cannot replace a managed child with a different epoch");
    }
    const link = {
        agentId: child.sessionId,
        epoch: child.epoch,
        name: child.launch.displayName,
        cwd: child.runtime.cwd,
        sessionFile: child.runtime.sessionFile,
        launch: child.launch,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    const children = existing
        ? parent.children.map((candidate) => candidate.agentId === child.sessionId ? link : candidate)
        : [...parent.children, link];
    return { ...parent, children };
}
export function getDirectChild(parent, agentId) {
    const child = parent.children.find((candidate) => candidate.agentId === agentId);
    if (!child) {
        throw new Error(`Managed session is not a direct child: ${agentId}`);
    }
    return child;
}
export function markDirectChildClosed(parent, agentId, now) {
    getDirectChild(parent, agentId);
    return {
        ...parent,
        children: parent.children.map((child) => child.agentId === agentId
            ? { ...child, closedAt: now, updatedAt: now }
            : child),
    };
}
export function removeDirectChildren(parent, agentIds) {
    return {
        ...parent,
        children: parent.children.filter((child) => !agentIds.has(child.agentId)),
    };
}
//# sourceMappingURL=ownership.js.map