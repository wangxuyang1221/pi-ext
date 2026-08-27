import type {
  ChildLink,
  SessionState,
} from "./state-store.js";

export function registerDirectChild(
  parent: SessionState,
  child: SessionState,
  now: string,
): SessionState {
  if (parent.parent) {
    throw new Error("Managed sessions cannot register children");
  }
  if (
    child.parent?.sessionId !== parent.sessionId
    || child.parent.epoch !== parent.epoch
  ) {
    throw new Error("Cannot register a child owned by another session namespace");
  }
  if (!child.launch) {
    throw new Error("Cannot register a child without launch metadata");
  }

  const existing = parent.children.find((candidate) => candidate.agentId === child.sessionId);
  if (existing && existing.epoch !== child.epoch) {
    throw new Error("Cannot replace a managed child with a different epoch");
  }

  const link: ChildLink = {
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

export function getDirectChild(parent: SessionState, agentId: string): ChildLink {
  const child = parent.children.find((candidate) => candidate.agentId === agentId);
  if (!child) {
    throw new Error(`Managed session is not a direct child: ${agentId}`);
  }
  return child;
}

export function removeDirectChildren(
  parent: SessionState,
  agentIds: ReadonlySet<string>,
): SessionState {
  return {
    ...parent,
    children: parent.children.filter((child) => !agentIds.has(child.agentId)),
  };
}
