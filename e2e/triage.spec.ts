import { test, expect, type APIRequestContext } from '@playwright/test'
import { seedProject, createTicket, getTicket, type SeedRefs } from './helpers'

let refs: SeedRefs

async function enableTriage(request: APIRequestContext, projectId: string) {
  const res = await request.patch(`/api/projects/${projectId}`, {
    data: { triage: { enabled: true } },
  })
  expect(res.ok(), await res.text()).toBeTruthy()

  const statuses = await request.get(
    `/api/statuses?where[project][equals]=${projectId}&where[type][equals]=TRIAGE&depth=0`,
  )
  const body = await statuses.json()
  expect(body.docs.length, 'enabling triage provisions a Triage status').toBe(1)
  return body.docs[0].id as string
}

async function triageTicket(
  request: APIRequestContext,
  statusId: string,
  fields: Record<string, unknown> = {},
) {
  const res = await request.post('/api/tickets', {
    data: {
      title: 'Incoming work',
      priority: 'NO_PRIORITY',
      project: refs.projectId,
      team: refs.teamId,
      status: statusId,
      ...fields,
    },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()).doc as { id: string; ticketId: string; title: string }
}

async function resolve(
  request: APIRequestContext,
  id: string,
  body: Record<string, unknown>,
) {
  return request.post(`/api/tickets/${id}/triage`, { data: body })
}

test.beforeAll(async ({ request }) => {
  refs = await seedProject(request, 'triage')
})

test.describe('turning triage on', () => {
  test('a project has no triage status until it is enabled', async ({ request }) => {
    const seeded = await seedProject(request, 'triage-off')

    const before = await request.get(
      `/api/statuses?where[project][equals]=${seeded.projectId}&where[type][equals]=TRIAGE&depth=0`,
    )
    expect((await before.json()).docs).toHaveLength(0)

    await enableTriage(request, seeded.projectId)
  })

  test('enabling twice does not create a second triage status', async ({ request }) => {
    const seeded = await seedProject(request, 'triage-twice')
    const first = await enableTriage(request, seeded.projectId)
    const second = await enableTriage(request, seeded.projectId)
    expect(second).toBe(first)
  })
})

test.describe('the queue', () => {
  test('lists items in triage and reports what they can be accepted into', async ({ request }) => {
    const seeded = await seedProject(request, 'triage-queue')
    const statusId = await enableTriage(request, seeded.projectId)

    const res = await request.post('/api/tickets', {
      data: {
        title: 'Queued for review',
        project: seeded.projectId,
        status: statusId,
        priority: 'NO_PRIORITY',
      },
    })
    expect(res.ok(), await res.text()).toBeTruthy()

    const queue = await request.get(`/api/tickets/triage?project=${seeded.projectId}`)
    const body = await queue.json()

    expect(body.enabled).toBe(true)
    expect(body.pending.map((t: { title: string }) => t.title)).toContain('Queued for review')
    expect(body.workflow.length).toBeGreaterThan(0)
    expect(
      body.workflow.some((s: { type: string }) => s.type === 'TRIAGE'),
      'triage is never offered as somewhere to accept into',
    ).toBe(false)
  })

  test('a triage item stays out of the ordinary ticket list', async ({ request }) => {
    const seeded = await seedProject(request, 'triage-hidden')
    const statusId = await enableTriage(request, seeded.projectId)

    await request.post('/api/tickets', {
      data: {
        title: 'Should not reach the backlog',
        project: seeded.projectId,
        status: statusId,
        priority: 'NO_PRIORITY',
      },
    })

    const workflow = await request.get(
      `/api/statuses?where[project][equals]=${seeded.projectId}&where[type][not_equals]=TRIAGE&depth=0`,
    )
    const workflowIds = (await workflow.json()).docs.map((s: { id: string }) => s.id)

    const listed = await request.get(
      `/api/tickets?where[project][equals]=${seeded.projectId}&where[status][in]=${workflowIds.join(',')}&depth=0`,
    )
    const titles = (await listed.json()).docs.map((t: { title: string }) => t.title)
    expect(titles).not.toContain('Should not reach the backlog')
  })
})

test.describe('resolutions', () => {
  let statusId: string

  test.beforeAll(async ({ request }) => {
    statusId = await enableTriage(request, refs.projectId)
  })

  test('accept moves the ticket into the workflow', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Accept me' })

    const res = await resolve(request, ticket.id, { resolution: 'accept' })
    expect(res.ok(), await res.text()).toBeTruthy()

    const body = await res.json()
    expect(body.resolution).toBe('accept')
    expect(body.status.name).toBeTruthy()

    const saved = await getTicket(request, ticket.id)
    expect(saved.status).not.toBe(statusId)
  })

  test('accept honours an explicitly chosen status', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Accept into doing' })

    const queue = await request.get(`/api/tickets/triage?project=${refs.projectId}`)
    const workflow = (await queue.json()).workflow as { id: string; type: string }[]
    const started = workflow.find((entry) => entry.type === 'STARTED')
    expect(started, 'the project workflow offers a started status').toBeTruthy()

    const res = await resolve(request, ticket.id, { resolution: 'accept', status: started!.id })
    expect(res.ok(), await res.text()).toBeTruthy()

    const saved = await getTicket(request, ticket.id)
    expect(saved.status).toBe(started!.id)
  })

  test('decline cancels the ticket rather than deleting it', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Decline me' })

    const res = await resolve(request, ticket.id, {
      resolution: 'decline',
      comment: 'Out of scope for this project.',
    })
    expect(res.ok(), await res.text()).toBeTruthy()

    const saved = await getTicket(request, ticket.id)
    expect(saved.id, 'the record survives a decline').toBe(ticket.id)

    const status = await request.get(`/api/statuses/${saved.status}?depth=0`)
    expect((await status.json()).type).toBe('CANCELLED')

    const comments = await request.get(`/api/comments?where[ticket][equals]=${ticket.id}&depth=0`)
    const bodies = (await comments.json()).docs.map((c: { body: string }) => c.body)
    expect(bodies).toContain('Out of scope for this project.')
  })

  test('duplicate links the ticket to its canonical and cancels it', async ({ request }) => {
    const canonical = await triageTicket(request, statusId, { title: 'The real one' })
    await resolve(request, canonical.id, { resolution: 'accept' })

    const dupe = await triageTicket(request, statusId, { title: 'Same thing again' })

    const res = await resolve(request, dupe.id, {
      resolution: 'duplicate',
      duplicateOf: canonical.id,
    })
    expect(res.ok(), await res.text()).toBeTruthy()

    const saved = await getTicket(request, dupe.id)
    expect(saved.duplicateOf).toBe(canonical.id)

    const status = await request.get(`/api/statuses/${saved.status}?depth=0`)
    expect((await status.json()).type).toBe('CANCELLED')
  })

  test('a ticket cannot be marked a duplicate of itself', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Self duplicate' })

    const res = await resolve(request, ticket.id, {
      resolution: 'duplicate',
      duplicateOf: ticket.id,
    })
    expect(res.ok()).toBeFalsy()
    expect(await res.text()).toContain('cannot be a duplicate of itself')
  })

  test('a duplicate has to point at a ticket in the same project', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Cross project dupe' })

    const other = await seedProject(request, 'triage-other')
    const elsewhere = await createTicket(request, other, { title: 'Somewhere else' })
    const elsewhereId = (await elsewhere.json()).doc.id

    const res = await resolve(request, ticket.id, {
      resolution: 'duplicate',
      duplicateOf: elsewhereId,
    })
    expect(res.ok()).toBeFalsy()
    expect(await res.text()).toContain('same project')
  })

  test('snooze hides the item until its date and keeps it in triage', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Come back later' })

    const res = await resolve(request, ticket.id, {
      resolution: 'snooze',
      snoozedUntil: '2027-01-15',
    })
    expect(res.ok(), await res.text()).toBeTruthy()

    const saved = await getTicket(request, ticket.id)
    expect(saved.status, 'a snoozed item is still in triage').toBe(statusId)
    expect(saved.snoozedUntil.slice(0, 10)).toBe('2027-01-15')

    const queue = await request.get(`/api/tickets/triage?project=${refs.projectId}`)
    const body = await queue.json()
    expect(body.pending.map((t: { id: string }) => t.id)).not.toContain(ticket.id)
    expect(body.snoozed.map((t: { id: string }) => t.id)).toContain(ticket.id)
  })

  test('editing a snoozed item wakes it back into the queue', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Woken by an edit' })
    await resolve(request, ticket.id, { resolution: 'snooze', snoozedUntil: '2027-05-01' })

    const edit = await request.patch(`/api/tickets/${ticket.id}`, {
      data: { title: 'Woken by an edit, renamed' },
    })
    expect(edit.ok(), await edit.text()).toBeTruthy()

    const saved = await getTicket(request, ticket.id)
    expect(saved.snoozedUntil, 'touching the ticket clears the snooze').toBeFalsy()
  })

  test('re-snoozing an item does not wake it', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Snoozed twice' })
    await resolve(request, ticket.id, { resolution: 'snooze', snoozedUntil: '2027-05-01' })
    await resolve(request, ticket.id, { resolution: 'snooze', snoozedUntil: '2027-06-01' })

    const saved = await getTicket(request, ticket.id)
    expect(saved.snoozedUntil.slice(0, 10)).toBe('2027-06-01')
  })

  test('a snooze date in the past is refused with a usable message', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Backwards snooze' })

    const res = await resolve(request, ticket.id, {
      resolution: 'snooze',
      snoozedUntil: '2020-01-01',
    })
    expect(res.ok()).toBeFalsy()
    expect(await res.text()).toContain('Choose a later day')
  })

  test('resolving a ticket that is not in triage is refused', async ({ request }) => {
    const created = await createTicket(request, refs, { title: 'Ordinary work' })
    const ticket = (await created.json()).doc

    const res = await resolve(request, ticket.id, { resolution: 'accept' })
    expect(res.ok()).toBeFalsy()
    expect(await res.text()).toContain('not in triage')
  })

  test('an unknown resolution is refused and names the four that work', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Bad resolution' })

    const res = await resolve(request, ticket.id, { resolution: 'obliterate' })
    expect(res.ok()).toBeFalsy()
    expect(await res.text()).toContain('accept, duplicate, decline or snooze')
  })

  test('accepting clears a snooze that was set earlier', async ({ request }) => {
    const ticket = await triageTicket(request, statusId, { title: 'Snoozed then accepted' })
    await resolve(request, ticket.id, { resolution: 'snooze', snoozedUntil: '2027-02-01' })

    const res = await resolve(request, ticket.id, { resolution: 'accept' })
    expect(res.ok(), await res.text()).toBeTruthy()

    const saved = await getTicket(request, ticket.id)
    expect(saved.snoozedUntil).toBeFalsy()
  })
})

test.describe('the triage page', () => {
  test('shows the queue and resolves an item from the keyboard', async ({ page, request }) => {
    const seeded = await seedProject(request, 'triage-ui')
    const statusId = await enableTriage(request, seeded.projectId)

    const res = await request.post('/api/tickets', {
      data: {
        title: 'Reported by a customer',
        project: seeded.projectId,
        status: statusId,
        priority: 'NO_PRIORITY',
      },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    const ticket = (await res.json()).doc

    await page.goto(`/triage?project=${seeded.projectId}`)

    const card = page.locator('[data-triage-card]').filter({ hasText: 'Reported by a customer' })
    await expect(card).toBeVisible()

    await card.focus()
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/tickets/${ticket.id}/triage`) && r.request().method() === 'POST',
      ),
      page.keyboard.press('1'),
    ])

    await expect(page.getByText('Accepted')).toBeVisible()

    const saved = await getTicket(request, ticket.id)
    expect(saved.status).not.toBe(statusId)
  })

  test('declining from the page asks first and explains what happens', async ({ page, request }) => {
    const seeded = await seedProject(request, 'triage-decline-ui')
    const statusId = await enableTriage(request, seeded.projectId)

    const res = await request.post('/api/tickets', {
      data: {
        title: 'Not something we will do',
        project: seeded.projectId,
        status: statusId,
        priority: 'NO_PRIORITY',
      },
    })
    const ticket = (await res.json()).doc

    await page.goto(`/triage?project=${seeded.projectId}`)

    const card = page.locator('[data-triage-card]').filter({ hasText: 'Not something we will do' })
    await card.getByRole('button', { name: 'Decline' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('cancelled rather than deleted')

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/tickets/${ticket.id}/triage`) && r.request().method() === 'POST',
      ),
      dialog.getByRole('button', { name: 'Decline ticket' }).click(),
    ])

    const saved = await getTicket(request, ticket.id)
    const status = await request.get(`/api/statuses/${saved.status}?depth=0`)
    expect((await status.json()).type).toBe('CANCELLED')
  })

  test('a project without triage explains how to turn it on', async ({ page, request }) => {
    const seeded = await seedProject(request, 'triage-none-ui')

    await page.goto(`/triage?project=${seeded.projectId}`)
    await expect(page.getByText('Triage is off for this project')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open project settings' })).toBeVisible()
  })

  test('an empty queue reads as clear rather than broken', async ({ page, request }) => {
    const seeded = await seedProject(request, 'triage-empty-ui')
    await enableTriage(request, seeded.projectId)

    await page.goto(`/triage?project=${seeded.projectId}`)
    await expect(page.getByText('Triage is clear')).toBeVisible()
  })

  test('the pending and snoozed halves are separate, addressable views', async ({
    page,
    request,
  }) => {
    const seeded = await seedProject(request, 'triage-tabs-ui')
    const statusId = await enableTriage(request, seeded.projectId)

    const res = await request.post('/api/tickets', {
      data: {
        title: 'Parked for now',
        project: seeded.projectId,
        status: statusId,
        priority: 'NO_PRIORITY',
      },
    })
    const ticket = (await res.json()).doc
    await resolve(request, ticket.id, { resolution: 'snooze', snoozedUntil: '2027-03-01' })

    await page.goto(`/triage?project=${seeded.projectId}`)
    await expect(page.getByText('Triage is clear')).toBeVisible()

    await page.getByRole('button', { name: /Snoozed/ }).click()
    await expect(page).toHaveURL(/show=snoozed/)
    await expect(page.getByText('Parked for now')).toBeVisible()
  })

  test('triage is reachable from the sidebar and by its chord', async ({ page }) => {
    await page.goto('/board')
    await expect(page.getByRole('link', { name: /Triage/ })).toBeVisible()

    await page.keyboard.press('g')
    await page.keyboard.press('r')
    await expect(page).toHaveURL(/\/triage/)
  })
})
