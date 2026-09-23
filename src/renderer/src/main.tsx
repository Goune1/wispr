import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { App } from './App'

// Les boutons de fenêtre sont à gauche sur macOS et à droite ailleurs : la barre de titre
// réserve sa marge du bon côté.
if (navigator.userAgent.includes('Mac OS X')) document.documentElement.dataset.platform = 'mac'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
