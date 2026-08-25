/**
 * Render the JavaScript handoff page, so Python can diff it against its own.
 *
 * Same shape as web3mf_compare.mjs: the inputs are dumped by the Python side
 * and handed here unchanged, so the diff is about the port and not about two
 * test fixtures disagreeing.
 *
 *   node spikes/handoff_compare.mjs <input.json> <out.html>
 */

import { readFileSync, writeFileSync } from 'node:fs'

const { renderHandoff } = await import('../web/src/local/handoff.js')

const [inputPath, out] = process.argv.slice(2)
const input = JSON.parse(readFileSync(inputPath, 'utf8'))

writeFileSync(out, renderHandoff(input), 'utf8')
