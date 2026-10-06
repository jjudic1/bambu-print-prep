/**
 * Does the app give memory back when somebody moves on to the next file?
 *
 * Written for a report from the contact form (2026-10-06): a 77-piece kit from
 * Titan 3D, loaded one file at a time on an iPad with no laptop, and "the app
 * crashes shortly after uploading the 3rd file". Mobile Safari does not throw
 * when a tab runs out of memory -- it kills the page and reloads it, which
 * reads exactly like a crash -- and an iPad tab has a fraction of the room a
 * desktop has. So a desktop that never crashes proves nothing. What it *can*
 * show is growth: if the third file costs more than the first, the iPad runs
 * out on the third file however much room it started with.
 *
 * Three things are counted, from inside the page:
 *   - GPU buffer bytes still alive (WebGL wrapped before the app loads; the app
 *     is not touched, so the numbers are the app's own behaviour)
 *   - WebGL contexts made, and how many were ever released
 *   - the JavaScript heap, after a forced garbage collection
 *
 * The walk is Chris's: open a file, split it, make the file, start over --
 * then again with the next file. Plus a few taps on the plate, because every
 * tap and every drag redraws the parts.
 *
 *   npm run build --prefix web
 *   node web/memory-check.mjs                  # 4 files, 25 pieces each
 *   node web/memory-check.mjs --files 6 --pieces 40 --detail 6
 *
 * Exits 1 if the last file costs noticeably more than the first.
 */

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 ? Number(process.argv[at + 1]) : fallback
}
const FILES = arg('files', 4)
const PIECES = arg('pieces', 25)
const DETAIL = arg('detail', 5)        // icosphere subdivisions: 20 * 4^n triangles
const TAPS = arg('taps', 6)
const PORT = arg('port', 4179)

// --- a kit of loose pieces -------------------------------------------------

/** An icosphere, as a flat list of triangles (each three [x,y,z]). */
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9],
    [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6],
    [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
  const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l) }
  verts = verts.map(norm)
  for (let i = 0; i < level; i++) {
    const cache = new Map()
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (!cache.has(key)) {
        verts.push(norm(verts[a].map((c, k) => (c + verts[b][k]) / 2)))
        cache.set(key, verts.length - 1)
      }
      return cache.get(key)
    }
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
    })
  }
  return faces.map((f) => f.map((i) => verts[i]))
}

/** A binary STL of `pieces` separate spheres, laid on a grid. */
function kit(pieces, level) {
  const sphere = icosphere(level)
  const tris = sphere.length * pieces
  const out = Buffer.alloc(84 + tris * 50)
  out.write('memory-check kit', 0)
  out.writeUInt32LE(tris, 80)
  const side = Math.ceil(Math.sqrt(pieces))
  let at = 84
  for (let p = 0; p < pieces; p++) {
    const ox = (p % side) * 30, oy = Math.floor(p / side) * 30, r = 6 + (p % 5)
    for (const tri of sphere) {
      at += 12                                 // normal left zero; the reader recomputes it
      for (const [x, y, z] of tri) {
        out.writeFloatLE(ox + x * r, at); out.writeFloatLE(oy + y * r, at + 4)
        out.writeFloatLE(r + z * r, at + 8); at += 12
      }
      at += 2
    }
  }
  return out
}

// --- the counters, installed before any app code runs ----------------------

const COUNTERS = () => {
  const live = new Map()            // buffer -> bytes
  const stats = { contexts: 0, lost: 0, textures: 0 }
  window.__mem = { live, stats }
  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctx) continue
    const P = Ctx.prototype
    const create = P.createBuffer, del = P.deleteBuffer, data = P.bufferData
    const tex = P.createTexture, deltex = P.deleteTexture
    P.createBuffer = function () { const b = create.call(this); live.set(b, 0); return b }
    P.deleteBuffer = function (b) { live.delete(b); return del.call(this, b) }
    P.bufferData = function (target, src, ...rest) {
      const bound = this.getParameter(target === this.ELEMENT_ARRAY_BUFFER
        ? this.ELEMENT_ARRAY_BUFFER_BINDING : this.ARRAY_BUFFER_BINDING)
      if (bound) live.set(bound, typeof src === 'number' ? src : src?.byteLength ?? 0)
      return data.call(this, target, src, ...rest)
    }
    P.createTexture = function () { stats.textures++; return tex.call(this) }
    P.deleteTexture = function (t) { stats.textures--; return deltex.call(this, t) }
  }
  const getContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const ctx = getContext.call(this, kind, ...rest)
    if (ctx && /webgl/.test(kind) && !this.__counted) {
      this.__counted = true
      stats.contexts++
      this.addEventListener('webglcontextlost', () => { stats.lost++ })
    }
    return ctx
  }
}

// --- the walk ---------------------------------------------------------------

async function loadPlaywright() {
  try { return await import('playwright') } catch {
    const root = execSync('npm root -g').toString().trim()
    return import(join(root, 'playwright', 'index.mjs'))
  }
}

const MB = (n) => (n / 1048576).toFixed(1)

async function main() {
  const dir = join(tmpdir(), 'memory-check')
  mkdirSync(dir, { recursive: true })
  const files = []
  for (let i = 0; i < FILES; i++) {
    const path = join(dir, `kit-part-${i + 1}.stl`)
    const stl = kit(PIECES, DETAIL)
    writeFileSync(path, stl)
    files.push(path)
  }
  const tris = 20 * 4 ** DETAIL * PIECES
  console.log(`${FILES} files, ${PIECES} pieces each, ${tris.toLocaleString()} triangles, `
    + `${MB(84 + tris * 50)} MB each`)

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: HERE, stdio: 'ignore' })
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--js-flags=--expose-gc', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  })
  let failed = false
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: false })
    await page.addInitScript(COUNTERS)
    page.on('pageerror', (e) => console.log('  page error:', e.message))
    for (let tries = 0; ; tries++) {
      try { await page.goto(`http://localhost:${PORT}/`); break } catch (e) {
        if (tries > 40) throw e
        await new Promise((r) => setTimeout(r, 250))
      }
    }

    const sample = () => page.evaluate(() => {
      window.gc?.()
      const { live, stats } = window.__mem
      let gpu = 0
      for (const b of live.values()) gpu += b
      return { gpu, buffers: live.size, ...stats, heap: performance.memory?.usedJSHeapSize ?? 0 }
    })

    const rows = []
    const show = (label, s) => console.log(
      `${label.padEnd(26)} gpu ${MB(s.gpu).padStart(7)} MB  buffers ${String(s.buffers).padStart(5)}`
      + `  heap ${MB(s.heap).padStart(7)} MB  contexts ${s.contexts} (released ${s.lost})`
      + `  textures ${s.textures}`)
    show('landing', await sample())

    for (let i = 0; i < files.length; i++) {
      const n = i + 1
      await page.setInputFiles('input[type=file]', files[i])
      await page.getByText('Split into parts').waitFor({ timeout: 120000 })
      show(`file ${n}: opened`, await sample())

      await page.getByText('Split into parts').click()
      await page.getByText(/Split into \d+ parts/).waitFor({ timeout: 120000 })
      show(`file ${n}: split`, await sample())

      // Taps on the plate: each one selects or deselects, which redraws every part.
      const canvas = page.locator('.viewer canvas')
      const box = await canvas.boundingBox()
      for (let t = 0; t < TAPS; t++) {
        await page.mouse.click(box.x + box.width * (0.3 + 0.1 * (t % 5)),
                               box.y + box.height * (0.4 + 0.05 * (t % 3)))
      }
      show(`file ${n}: ${TAPS} taps`, await sample())

      await page.getByText('Make the file').click()
      await page.getByText('Save the file').first().waitFor({ timeout: 180000 })
      show(`file ${n}: made the file`, await sample())

      await page.getByText('Start over').click()
      await page.locator('input[type=file]').waitFor({ state: 'attached' })
      const after = await sample()
      show(`file ${n}: start over`, after)
      rows.push(after)
    }

    // Each file is the same size, so after "start over" the app should be back
    // where it was. Allow some slack for caches; a leak grows by a whole model.
    const first = rows[0], last = rows[rows.length - 1]
    const gpuGrowth = last.gpu - first.gpu
    const heapGrowth = last.heap - first.heap
    const openContexts = last.contexts - last.lost
    console.log(`\nfrom file 1 to file ${rows.length}: gpu +${MB(gpuGrowth)} MB, `
      + `heap +${MB(heapGrowth)} MB, contexts never released: ${openContexts}`)
    const problems = []
    if (gpuGrowth > 8 * 1048576) problems.push('GPU memory is not given back between files')
    if (heapGrowth > 32 * 1048576) problems.push('the JavaScript heap grows with every file')
    if (openContexts > 2) problems.push(`${openContexts} WebGL contexts left open (iOS caps these)`)
    if (problems.length) { failed = true; for (const p of problems) console.log('FAIL:', p) }
    else console.log('OK: memory comes back between files')
  } finally {
    await browser.close()
    server.kill()
  }
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
