import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ProjectForm } from '@/components/projects/ProjectForm'
import { SignedOutGate } from '@/components/ui/SignedOutGate'
import { requireUser, authRequired, scopedLocalArgs } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

interface EditProjectPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: EditProjectPageProps) {
  const { id } = await params
  const user = authRequired() ? await requireUser() : null
  try {
    const payload = await getPayload({ config })
    const project = await payload.findByID({ collection: 'projects', id, depth: 0, ...scopedLocalArgs(user) })
    return { title: `Edit ${project.name} · local-pm` }
  } catch {
    return { title: 'Edit project · local-pm' }
  }
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params
  const payload = await getPayload({ config })
  const user = authRequired() ? await requireUser() : null

  // my-tickets pattern: no usable session → sign-in gate before the scoped
  // findByID (which would only deny and land in the notFound catch).
  if (authRequired() && !user) {
    return <SignedOutGate title="Edit project" />
  }

  try {
    const project = await payload.findByID({
      collection: 'projects',
      id,
      depth: 0,
      ...scopedLocalArgs(user),
    })
    if (!project) notFound()
    return <ProjectForm project={project} />
  } catch {
    notFound()
  }
}
