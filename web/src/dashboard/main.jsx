import React from 'react'
import { createRoot } from 'react-dom/client'
import Dashboard from './Dashboard.jsx'
import '../styles.css'

// No startCounting() here on purpose. This page is the owner looking at the
// numbers; counting it would put the one person who is definitely not a user
// into the visitor total, and on a small number that is not a rounding error.

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
)
