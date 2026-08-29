/**
 * RETIRED -- the entry point of the hosted app, which is no longer deployed.
 *
 * No HTML file references this, so nothing here is built and nothing here
 * ships. It is kept, with App.jsx, Viewer.jsx and api.js, because the code is
 * fine -- what went away is the server it needed. The mesh work it called (the
 * repair ladder, the analysis, the orientation solver) needs real mesh
 * libraries and cannot run in a browser, so it lived on Cloud Run, and that
 * service was deleted when the on-device page turned out to do the job people
 * actually wanted.
 *
 * **None of the judgement half is lost.** `prep/` is untouched and still the
 * best thing in this project; it runs from the command line -- `Prepare for
 * printing.bat`, or `.venv\Scripts\prep.exe model.stl --size 80mm` -- and every
 * test of it still runs.
 *
 * To bring the hosted app back:
 *
 *   1. Deploy the API again -- one command, in docs/deploy.md.
 *   2. Put the /api/* rewrite back at the top of vercel.json's list, ahead of
 *      the catch-all. Ahead of it, or every API call returns a page of HTML
 *      with a 200 and the client fails parsing it as JSON.
 *   3. Give this file an HTML entry again and add it to vite.config.js.
 *
 * Deliberately not deleted: the argument for the on-device page is a strategic
 * one about cost, not a discovery that this code was wrong, and a strategic
 * argument is the kind that can be revisited.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { startCounting } from './metrics.js'
import './styles.css'

startCounting()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
