// Every call the app makes. Kept in one file so the shape of the server is
// visible in one place rather than scattered through components.

async function ok(response) {
  if (response.ok) return response.json()
  let detail = `${response.status}`
  try {
    const body = await response.json()
    if (body.detail) detail = body.detail
  } catch {
    // A non-JSON error body is still an error; the status carries the meaning.
  }
  throw new Error(detail)
}

export const listPrinters = () => fetch('/api/printers').then(ok)

export function uploadModel(file) {
  const form = new FormData()
  form.append('file', file)
  return fetch('/api/jobs', { method: 'POST', body: form }).then(ok)
}

export const jobStatus = (jobId) => fetch(`/api/jobs/${jobId}`).then(ok)

/**
 * Upload, then wait for the server to finish looking at the model.
 *
 * The upload answers 202 straight away and the examination runs behind it,
 * because it takes 19s for a moderately detailed model and holding a request
 * open that long is how you collect gateway timeouts (Vercel returned a 502
 * doing exactly that). So: poll.
 *
 * Backs off from a quick first check to a slower steady state. Small models
 * finish in under a second and should feel instant; a heavy one should not be
 * asked about thirty times a second for half a minute.
 */
export async function uploadAndWait(file, { onProgress } = {}) {
  const { job_id: jobId } = await uploadModel(file)
  let wait = 250

  for (;;) {
    const body = await jobStatus(jobId)
    if (body.state === 'ready') return body
    if (body.state === 'failed') throw new Error(body.error || 'That model could not be read.')

    onProgress?.(body)
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(wait * 1.4, 2000)
  }
}

export const meshUrl = (jobId) => `/api/jobs/${jobId}/mesh.glb`

export const fileUrl = (jobId, name) =>
  `/api/jobs/${jobId}/files/${encodeURIComponent(name)}`

export function prepare(jobId, body) {
  return fetch(`/api/jobs/${jobId}/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(ok)
}
