export interface StatusDoc {
  id: string;
  name: string;
  key: string;
  type: string;
  order?: number;
  project?: { id: string } | string | null;
}

export function projectIdOf(value: { id: string } | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.id;
}

export function statusesForProject(docs: StatusDoc[], projectId?: string): StatusDoc[] {
  const sorted = [...docs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const globals = sorted.filter((doc) => !doc.project);
  if (!projectId) return globals;

  const scoped = sorted.filter((doc) => projectIdOf(doc.project) === projectId);

  return [...globals, ...scoped].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function matchStatus(
  docs: StatusDoc[],
  scope: StatusDoc[],
  value: string,
): StatusDoc | undefined {
  const needle = value.trim().toLowerCase();
  return (
    scope.find((doc) => doc.id === value) ??
    scope.find((doc) => doc.key.toLowerCase() === needle) ??
    scope.find((doc) => doc.name.toLowerCase() === needle) ??
    docs.find((doc) => doc.id === value)
  );
}

export function unknownStatusMessage(value: string, scope: StatusDoc[]): string {
  const known = scope.map((doc) => doc.key).join(', ');
  return `Unknown status "${value}". Available statuses: ${known || '(none configured)'}`;
}
