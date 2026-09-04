import '@arco-design/web-react/dist/css/arco.css'
import 'virtual:uno.css'
import './styles/index.css'
import { installArcoReact19Compat } from './arcoReact19Compat'

installArcoReact19Compat()
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('root element missing in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
