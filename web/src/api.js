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
