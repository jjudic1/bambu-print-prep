import React from 'react'
import { createRoot } from 'react-dom/client'
import LocalApp from './LocalApp.jsx'
import { startCounting } from '../metrics.js'
import '../styles.css'

startCounting()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LocalApp />
  </React.StrictMode>,
)
