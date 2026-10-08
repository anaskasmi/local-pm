import { test, expect, type APIRequestContext } from '@playwright/test'
import { seedProject, createTicket, getTicket, type SeedRefs } from './helpers'

let refs: SeedRefs

async function enableEstimates(
  request: APIRequestContext,
  projectId: string,
  scale = 'FIBONACCI',
) {
  const res = await request.patch(`/api/projects/${projectId}`, {
    data: { estimates: { enabled: true, scale } },
  })
  if (!res.ok()) {
    throw new Error(`Failed to enable estimates: ${res.status()} ${await res.text()}`)
  }
}

async function enableCycles(request: APIRequestContext, projectId: string) {
  const res = await request.patch(`/api/projects/${projectId}`, {
    data: {
      cycles: {
        enabled: true,
        lengthWeeks: 2,
        startDay: 1,
        rollover: 'NEXT',
        automation: 'MANUAL',
        upcomingCount: 1,
      },
    },
  })
  if (!res.ok()) throw new Error(`Failed to enable cycles: ${res.status()}`)

  const reconciled = await request.post('/api/cycles/reconcile', { data: { project: projectId } })
  if (!reconciled.ok()) throw new Error(`Failed to reconcile: ${reconciled.status()}`)

  const list = await request.get(
    `/api/cycles?where[project][equals]=${projectId}&sort=number&limit=10&depth=0`,
  )
  return (await list.json()).docs as { id: string; name: string }[]
}

test.beforeAll(async ({ request }) => {
  refs = await seedProject(request, 'estimates')
})

test('a project with estimates off shows no estimate field on the ticket form', async ({
  page,
}) => {
  await page.goto(`/tickets/new?project=${refs.projectId}`)

  await expect(page.getByRole('heading', { name: 'New ticket' })).toBeVisible()
  await expect(page.getByLabel('Estimate')).toHaveCount(0)
})

test('the estimates tab turns them on and shows what the scale offers', async ({ page }) => {
  await page.goto(`/projects/${refs.projectId}?tab=estimates`)

  await page.getByRole('checkbox', { name: /Estimate tickets in this project/ }).check()

  await expect(page.getByLabel('Scale')).toBeVisible()
  await expect(page.getByLabel('Scale')).toContainText('Fibonacci')
  await expect(page.getByRole('heading', { name: 'What this scale offers' })).toBeVisible()

  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/projects/${refs.projectId}?depth=0`)
      return (await res.json()).estimates?.enabled
    }, { timeout: 15_000 })
    .toBe(true)
})

test('an estimate set on the ticket form is stored as points', async ({ page, request }) => {
  await enableEstimates(request, refs.projectId)

  await page.goto(`/tickets/new?project=${refs.projectId}`)
  await page.getByLabel('Title').fill('Estimated from the form')

  await page.getByLabel('Estimate').click()
  await page.getByRole('option', { name: '8', exact: true }).click()

  await page.getByRole('button', { name: 'Create ticket' }).click()
  await expect(page.getByRole('heading', { name: 'Estimated from the form' })).toBeVisible()

  const res = await request.get(
    `/api/tickets?where[title][equals]=${encodeURIComponent('Estimated from the form')}&limit=1&depth=0`,
  )
  const [ticket] = (await res.json()).docs
  expect(ticket.estimate).toBe(8)
})

test('a t-shirt scale stores the point value behind the size', async ({ request }) => {
  const scoped = await seedProject(request, 'estimates-tshirt')
  await enableEstimates(request, scoped.projectId, 'TSHIRT')

  const created = await (
    await createTicket(request, scoped, { title: 'Sized L', estimate: 5 })
  ).json()

  expect((await getTicket(request, created.doc.id)).estimate).toBe(5)
})

test('an estimate change is recorded in the activity trail', async ({ request }) => {
  const created = await (
    await createTicket(request, refs, { title: 'Re-estimated later', estimate: 2 })
  ).json()

  const patched = await request.patch(`/api/tickets/${created.doc.id}`, {
    data: { estimate: 8 },
  })
  expect(patched.ok()).toBeTruthy()

  await expect
    .poll(
      async () => {
        const res = await request.get(
          `/api/activity?where[ticket][equals]=${created.doc.id}&where[field][equals]=estimate&limit=10&depth=0`,
        )
        const body = await res.json()
        return body.docs.map((d: { from: string | null; to: string | null }) => `${d.from}>${d.to}`)
      },
      { timeout: 15_000 },
    )
    .toContain('2>8')
})

test('a nonsense estimate is refused rather than stored', async ({ request }) => {
  const created = await (
    await createTicket(request, refs, { title: 'Zero is not an estimate', estimate: 0 })
  ).json()

  expect((await getTicket(request, created.doc.id)).estimate).toBeNull()
})

test('the burndown reads the cycle in points and offers the same numbers as a table', async ({
  page,
  request,
}) => {
  const scoped = await seedProject(request, 'burndown')
  await enableEstimates(request, scoped.projectId)
  const cycles = await enableCycles(request, scoped.projectId)
  const active = cycles[0]

  await createTicket(request, scoped, { title: 'Done work', status: 'DONE', cycle: active.id, estimate: 3 })
  await createTicket(request, scoped, { title: 'Open work', status: 'TODO', cycle: active.id, estimate: 5 })

  await page.goto(`/cycles/${active.id}`)

  const burndown = page.getByRole('img', { name: /Burndown for/ })
  await expect(burndown).toBeVisible()
  await expect(burndown).toHaveAttribute('aria-label', /5 of 8 points remaining/)

  await expect(page.getByRole('table', { name: /day by day/ })).toBeHidden()
  await page.getByRole('button', { name: 'Show data' }).click()
  await expect(page.getByRole('table', { name: /day by day/ })).toBeVisible()

  const api = await request.get(`/api/cycles/${active.id}/burndown`)
  expect(api.ok()).toBeTruthy()
  const body = await api.json()
  expect(body.series.unit).toBe('points')
  expect(body.series.scope).toBe(8)
  expect(body.series.completed).toBe(3)
  expect(body.series.remaining).toBe(5)
  expect(body.frozen).toBe(false)
})

test('the burndown names its series so colour is never the only cue', async ({ page, request }) => {
  const scoped = await seedProject(request, 'burndown-legend')
  const cycles = await enableCycles(request, scoped.projectId)

  await page.goto(`/cycles/${cycles[0].id}`)

  for (const label of ['Remaining', 'Scope', 'Ideal']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
  }
})

test('a cycle keeps its chart after closing, and velocity appears', async ({ page, request }) => {
  const scoped = await seedProject(request, 'velocity')
  await enableEstimates(request, scoped.projectId)
  const cycles = await enableCycles(request, scoped.projectId)
  const active = cycles[0]

  const pinned = await request.patch(`/api/cycles/${active.id}`, {
    data: { startsAt: new Date().toISOString() },
  })
  expect(pinned.ok()).toBeTruthy()

  await createTicket(request, scoped, { title: 'Shipped', status: 'DONE', cycle: active.id, estimate: 5 })
  await createTicket(request, scoped, { title: 'Slipped', status: 'TODO', cycle: active.id, estimate: 3 })

  const closed = await request.post(`/api/cycles/${active.id}/close`)
  expect(closed.ok()).toBeTruthy()

  const frozen = await request.get(`/api/cycles/${active.id}/burndown`)
  const body = await frozen.json()
  expect(body.frozen).toBe(true)
  expect(body.series.committed).toBe(8)
  expect(body.series.completed).toBe(5)

  const velocity = await request.get(`/api/cycles/velocity?project=${scoped.projectId}`)
  const summary = await velocity.json()
  expect(summary.unit).toBe('points')
  expect(summary.entries).toHaveLength(1)
  expect(summary.entries[0].completed).toBe(5)
  expect(summary.average).toBe(5)
  expect(summary.deliveryRate).toBe(63)

  await page.goto(`/cycles?project=${scoped.projectId}`)
  await expect(page.getByRole('img', { name: /Velocity over the last/ })).toBeVisible()
})

test('the frozen chart does not move when its tickets change afterwards', async ({ request }) => {
  const scoped = await seedProject(request, 'frozen')
  await enableEstimates(request, scoped.projectId)
  const cycles = await enableCycles(request, scoped.projectId)
  const active = cycles[0]

  const ticket = await (
    await createTicket(request, scoped, {
      title: 'Edited after the cycle closed',
      status: 'DONE',
      cycle: active.id,
      estimate: 5,
    })
  ).json()

  await request.post(`/api/cycles/${active.id}/close`)

  const before = await (await request.get(`/api/cycles/${active.id}/burndown`)).json()
  expect(before.series.completed).toBe(5)

  await request.patch(`/api/tickets/${ticket.doc.id}`, { data: { estimate: 13 } })

  const after = await (await request.get(`/api/cycles/${active.id}/burndown`)).json()
  expect(after.series.completed).toBe(5)

  const live = await (await request.get(`/api/cycles/${active.id}/burndown?live=true`)).json()
  expect(live.frozen).toBe(false)
  expect(live.series.completed).toBe(13)
})
